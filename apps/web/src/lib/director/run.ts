import "server-only";
/*
 * "Create My Video Automatically" on the server:
 *   start_director_run() (permission, limits, spending) → photos to Claude →
 *   storyboard → compile + fact-check → video project → real render queued.
 * Usage and cost are recorded on the run by the server (service role).
 */
import Anthropic from "@anthropic-ai/sdk";
import type { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SessionContext } from "@/lib/auth/session";
import type { Json } from "@/lib/database.types";
import { BUCKETS } from "@/lib/storage";
import { signedUrlMap } from "@/lib/storage-server";
import { decryptSecret } from "@/lib/secrets";
import { orderForVideo } from "@/lib/listings";
import { composeDocument } from "@/lib/video/plan";
import { validateFableCutDocument } from "@/lib/video/validate-document";
import { RENDER_FIELDS, queueRenders, type StoreResult } from "@/lib/video/project-store";
import { DirectorError, claudeCaller, costCents, isDirectorModel, runDirector, DEFAULT_DIRECTOR_MODEL, type CallClaude, type DirectorImage } from "./claude";
import { compileStoryboard, photoRefs, type CompileWarning } from "./compile";
import { verifiedFacts } from "./facts";
import { DIRECTOR_STYLE_INFO, type DirectorStyle } from "./schema";

type Db = Awaited<ReturnType<typeof createClient>>;
const MAX_IMAGE_BYTES = 4_500_000;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;

/** The company's Claude client: the encrypted key from System settings, else the server's ANTHROPIC_API_KEY. */
export async function claudeForOrg(orgId: string): Promise<CallClaude | null> {
  const { data } = await createAdminClient().from("organization_secrets").select("ciphertext").eq("organization_id", orgId).eq("name", "anthropic_api_key").maybeSingle();
  let apiKey: string | undefined;
  if (data?.ciphertext) apiKey = decryptSecret(data.ciphertext);
  apiKey ??= process.env.ANTHROPIC_API_KEY || undefined;
  if (!apiKey) return null;
  return claudeCaller(new Anthropic({ apiKey, timeout: 10 * 60_000, maxRetries: 2 }));
}

function friendly(message: string): string {
  if (/isn't switched on for your company/.test(message)) return "The AI Director isn't switched on for your company. Ask your Super Admin.";
  if (/AI isn't switched on for your account/.test(message)) return "AI isn't switched on for your account. Ask an administrator.";
  if (/limit is reached|spending limit/.test(message)) return message.replace(/^.*?(The company|Your daily|Monthly)/, "$1") + ".";
  if (/can't make videos/.test(message)) return "You can't make videos from this listing.";
  return "The AI Director couldn't start. Please try again.";
}

/** The listing's photos as images for Claude (thumbnail when there is one, otherwise the photo if it's small enough). */
export async function loadImages(db: Db, listingId: string, coverId: string | null) {
  const { data: rows } = await db.from("media_assets").select("id,storage_path,thumbnail_path,mime_type,size_bytes").eq("listing_id", listingId).eq("kind", "photo").order("sort_order").limit(30);
  const ordered = orderForVideo(rows ?? [], coverId);
  const images: DirectorImage[] = [];
  const used: string[] = [];
  const skipped: CompileWarning[] = [];
  for (const p of ordered) {
    const useThumb = !!p.thumbnail_path;
    const path = useThumb ? p.thumbnail_path! : p.storage_path;
    const type = useThumb ? "image/jpeg" : p.mime_type;
    if (!useThumb && (!(IMAGE_TYPES as readonly string[]).includes(type) || p.size_bytes > MAX_IMAGE_BYTES)) {
      skipped.push({ kind: "unknown_photo", message: "A photo without a preview image (e.g. HEIC or very large) wasn't sent to Claude." });
      continue;
    }
    const { data } = await db.storage.from(BUCKETS.listingMedia).download(path);
    if (!data) continue;
    used.push(p.id);
    images.push({ ref: "", mediaType: type as DirectorImage["mediaType"], base64: Buffer.from(await data.arrayBuffer()).toString("base64") });
  }
  const refs = photoRefs(used);
  refs.forEach((r, i) => { images[i]!.ref = r.ref; });
  return { images, refs, skipped };
}

export interface DirectorStart { runId: string; projectId: string }

export async function createVideoAutomatically(db: Db, ctx: SessionContext, input: { listingId: string; style: DirectorStyle }, opts: { call?: CallClaude } = {}): Promise<StoreResult<DirectorStart>> {
  const { data: listing } = await db.from("listings").select("*").eq("id", input.listingId).maybeSingle();
  if (!listing) return { ok: false, status: 404, message: "We couldn't find that listing." };
  if (!listing.address_line.trim()) return { ok: false, status: 400, message: "Add the property address to the listing first." };
  const { images, refs, skipped } = await loadImages(db, listing.id, listing.cover_asset_id);
  if (images.length < 5) return { ok: false, status: 400, message: `Add at least 5 photos first — the AI Director can use ${images.length}.` };

  const call = opts.call ?? await claudeForOrg(ctx.organization.id);
  if (!call) return { ok: false, status: 400, message: "Claude isn't connected yet. Ask your Super Admin to add the Claude API key in System settings." };

  const { data: run, error } = await db.rpc("start_director_run", { p_listing_id: listing.id, p_style: input.style, p_photo_count: images.length });
  if (error || !run) return { ok: false, status: 403, message: friendly(error?.message ?? "") };
  const admin = createAdminClient();
  const model = isDirectorModel(run.model) ? run.model : DEFAULT_DIRECTOR_MODEL;
  const facts = verifiedFacts(listing);

  try {
    const result = await runDirector(call, { model, style: input.style, facts, images });
    const cost = costCents(model, result.usage);
    const compiled = compileStoryboard({ storyboard: result.storyboard, analysis: result.analysis, photos: refs, facts, style: input.style });
    const warnings = [...skipped, ...compiled.warnings];
    const { data: photos } = await db.from("media_assets").select("id,storage_path,file_name,width,height").in("id", refs.map((r) => r.assetId));
    const title = `${DIRECTOR_STYLE_INFO[input.style].label} — ${listing.address_line.trim()}`;
    const doc = composeDocument({ plan: compiled.plan, title, photos: photos ?? [], music: [], brand: ctx.brandKit });
    if (!validateFableCutDocument(doc).ok) throw new DirectorError("The storyboard couldn't be turned into a video.");
    const { data: project, error: pe } = await db.from("video_projects").insert({
      organization_id: ctx.organization.id, listing_id: listing.id, created_by: ctx.userId, brand_kit_id: ctx.brandKit?.id ?? null,
      title, status: "draft", aspect_ratios: [compiled.plan.aspect], edit_plan: compiled.plan as unknown as Json, document: doc as Json, revision: 1,
      settings: { kind: "director", runId: run.id, style: input.style } as Json,
    }).select("id").single();
    if (pe || !project) throw new DirectorError(/Monthly video limit|Daily video limit/.test(pe?.message ?? "") ? "You've reached your video limit." : "The video couldn't be saved.");
    await db.from("project_revisions").insert({ project_id: project.id, revision: 1, organization_id: ctx.organization.id, document: doc as Json, author_id: ctx.userId, note: "AI Director storyboard" });
    await admin.from("director_runs").update({
      status: "succeeded", finished_at: new Date().toISOString(), project_id: project.id, cost_cents: cost,
      analysis: result.analysis as unknown as Json, warnings: warnings as unknown as Json,
      storyboard: { raw: result.storyboard, refs, director: compiled.director, servedBy: result.servedBy } as unknown as Json,
      usage: result.usage as unknown as Json,
    }).eq("id", run.id);
    const queued = await queueRenders(db, ctx, project.id, compiled.plan, [compiled.plan.aspect], "AI Director");
    if (!queued.ok) await admin.from("director_runs").update({ error_message: `Render not started: ${queued.message}` }).eq("id", run.id);
    return { ok: true, value: { runId: run.id, projectId: project.id } };
  } catch (e) {
    const message = e instanceof DirectorError ? e.message
      : e instanceof Anthropic.AuthenticationError ? "Claude rejected the API key. Ask your Super Admin to check it."
      : e instanceof Anthropic.RateLimitError ? "Claude is busy right now. Please try again in a minute."
      : e instanceof Anthropic.APIError ? `Claude couldn't be reached (${e.status ?? "network"}). Please try again.`
      : "The AI Director couldn't finish. Please try again.";
    await admin.from("director_runs").update({ status: "failed", finished_at: new Date().toISOString(), error_message: message }).eq("id", run.id);
    return { ok: false, status: 502, message };
  }
}

/** Everything the review page shows. */
export async function directorRunView(db: Db, runId: string) {
  const { data: run } = await db.from("director_runs").select("*").eq("id", runId).maybeSingle();
  if (!run) return null;
  const sb = (run.storyboard ?? null) as { refs?: { ref: string; assetId: string }[]; director?: unknown; raw?: unknown } | null;
  const refs = sb?.refs ?? [];
  const { data: photos } = refs.length ? await db.from("media_assets").select("id,storage_path,thumbnail_path").in("id", refs.map((r) => r.assetId)) : { data: [] };
  const urls = await signedUrlMap(BUCKETS.listingMedia, (photos ?? []).map((p) => p.thumbnail_path ?? p.storage_path), 3600);
  const thumbs = Object.fromEntries(refs.map((r) => {
    const p = (photos ?? []).find((x) => x.id === r.assetId);
    return [r.ref, p ? urls[p.thumbnail_path ?? p.storage_path] ?? null : null];
  }));
  const { data: renders } = run.project_id
    ? await db.from("render_jobs").select(RENDER_FIELDS).eq("project_id", run.project_id).order("created_at", { ascending: false }).limit(1)
    : { data: [] };
  return { run, thumbs, render: (renders?.[0] ?? null) as unknown as { id: string; status: string; progress: number; error_message: string | null; duration_seconds: number | null; width: number | null; height: number | null } | null };
}
