import "server-only";
/*
 * Generate 6 Videos on the server. Runs as the signed-in person (RLS + the
 * start_video_batch checks). Each video is an ordinary project with its own
 * render job in the background queue, so:
 *   - one video failing (or hitting a limit) never stops the others,
 *   - "Retry" re-queues only that video,
 *   - "Edit" opens the normal editor, "Regenerate" rebuilds just that storyboard.
 */
import type { createClient } from "@/lib/supabase/server";
import type { SessionContext } from "@/lib/auth/session";
import type { Json } from "@/lib/database.types";
import { BUCKETS } from "@/lib/storage";
import { parseCamera, signedUrlMap } from "@/lib/storage-server";
import { composeDocument, planSchema, totalDuration, type EditPlan } from "@/lib/video/plan";
import { validateFableCutDocument } from "@/lib/video/validate-document";
import {
  BATCH_TYPES, BATCH_TYPE_INFO, LEGACY_BATCH_TYPES, analyzeListing, buildBatchPlan,
  type AnyBatchType, type BatchPhoto, type BatchType, type ListingAnalysis,
} from "@/lib/video/batch";
import { ensureBuiltinMusic, ensureLogoAsset, pickTrack, verifiedTracks } from "@/lib/music";
import type { Aspect } from "@/lib/video/plan";
import { RENDER_FIELDS, queueRenders, savePlan, toEasyListing, type StoreResult } from "@/lib/video/project-store";
import { loadProjectAssets } from "@/lib/video/editor-data";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ListingRow } from "@/lib/database.types";
import {
  DEFAULT_DIRECTOR_MODEL, DirectorError, analysePhotos, costCents, emptyUsage, estimateBatchCents, isDirectorModel, planStoryboard,
  type CallClaude, type DirectorModel,
} from "@/lib/director/claude";
import { compileStoryboard } from "@/lib/director/compile";
import { verifiedFacts } from "@/lib/director/facts";
import { claudeForOrg, loadImages } from "@/lib/director/run";

type Db = Awaited<ReturnType<typeof createClient>>;

const isBatchType = (v: unknown): v is BatchType => (BATCH_TYPES as readonly string[]).includes(String(v));
const isAnyBatchType = (v: unknown): v is AnyBatchType => isBatchType(v) || (LEGACY_BATCH_TYPES as readonly string[]).includes(String(v));

/** Licensed music per video type (different tracks where the library allows) and the brand logo. */
async function brandingAndMusic(db: Db, ctx: SessionContext, types: readonly BatchType[]) {
  await ensureBuiltinMusic(ctx.organization.id).catch(() => undefined);
  const tracks = await verifiedTracks(db);
  const used = new Set<string>();
  const music: Partial<Record<BatchType, string | null>> = {};
  for (const type of types) {
    const t = pickTrack(tracks, BATCH_TYPE_INFO[type].mood, used);
    music[type] = t?.assetId ?? null;
    if (t) used.add(t.assetId);
  }
  const logo = await ensureLogoAsset(ctx.organization.id, ctx.brandKit?.logo_path).catch(() => null);
  return { music, logoAssetId: logo?.id ?? null, trackTitle: new Map(tracks.map((t) => [t.assetId, t.title])) };
}

function friendly(message: string): string {
  if (/Daily video limit/.test(message)) return message.replace(/^.*?(Daily video limit)/, "$1") + ".";
  if (/Monthly video limit/.test(message)) return "You've reached your monthly video limit.";
  if (/isn't switched on/.test(message)) return "Generate 6 Videos isn't switched on for your account. Ask your Super Admin.";
  if (/can't make videos/.test(message)) return "You can't make videos from this listing.";
  return "Something went wrong. Please try again.";
}

/** The music + logos a batch project may use (same rules as any project). */
async function loadAssetsFor(db: Db, listingId: string) {
  return loadProjectAssets(db, { id: "00000000-0000-0000-0000-000000000000", listing_id: listingId });
}

async function loadListingInputs(db: Db, listingId: string) {
  const [{ data: listing }, { data: photos }] = await Promise.all([
    db.from("listings").select("*").eq("id", listingId).maybeSingle(),
    db.from("media_assets").select("id,storage_path,thumbnail_path,file_name,width,height,camera_spec").eq("listing_id", listingId).eq("kind", "photo").order("sort_order"),
  ]);
  return { listing, photos: photos ?? [] };
}

export interface BatchStartResult { batchId: string; created: { type: BatchType; projectId: string }[]; problems: { type: BatchType; message: string }[] }

export interface BatchStartInput {
  listingId: string;
  aspect?: Aspect;
  /** "rules" (no AI cost) or "ai_director" (Claude plans each storyboard; needs a confirmed estimate). */
  planner?: "rules" | "ai_director";
  /** The estimate (cents) the person saw and confirmed. */
  confirmedCents?: number;
}

/** What the AI Director would cost for this listing (shown before anything runs). */
export async function batchAiEstimate(db: Db, listingId: string): Promise<{ model: DirectorModel; cents: number; photos: number } | null> {
  const { data: allowance } = await db.rpc("my_generation_allowance");
  const a = (allowance ?? {}) as { director_available?: boolean; claude_model?: string };
  if (!a.director_available) return null;
  const { count } = await db.from("media_assets").select("id", { count: "exact", head: true }).eq("listing_id", listingId).eq("kind", "photo");
  const model = isDirectorModel(a.claude_model) ? a.claude_model : DEFAULT_DIRECTOR_MODEL;
  const photos = Math.min(30, count ?? 0);
  return { model, photos, cents: estimateBatchCents(model, photos, BATCH_TYPES.length) };
}

const usd = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

/** Storyboards written by the AI Director (one shared photo analysis, one storyboard per video). */
async function directorPlans(db: Db, input: {
  listing: ListingRow; types: readonly BatchType[]; aspect: Aspect; call: CallClaude; music: Partial<Record<BatchType, string | null>>; logoAssetId: string | null;
}): Promise<{ plans: Partial<Record<BatchType, EditPlan>>; problems: { type: BatchType; message: string }[] }> {
  const { images, refs } = await loadImages(db, input.listing.id, input.listing.cover_asset_id);
  const { data: run, error } = await db.rpc("start_director_run", { p_listing_id: input.listing.id, p_style: "batch", p_photo_count: images.length });
  if (error || !run) throw new DirectorError(/limit|spending/.test(error?.message ?? "") ? `AI Director: ${error!.message}.` : "The AI Director couldn't start.");
  const model = isDirectorModel(run.model) ? run.model : DEFAULT_DIRECTOR_MODEL;
  const facts = verifiedFacts(input.listing);
  const usage = emptyUsage();
  const admin = createAdminClient();
  const plans: Partial<Record<BatchType, EditPlan>> = {};
  const problems: { type: BatchType; message: string }[] = [];
  const saved: Record<string, unknown> = {};
  const address = input.listing.address_line.trim();
  const price = input.listing.price != null ? usd(input.listing.price) : "";
  try {
    const analysis = await analysePhotos(input.call, model, images, usage);
    await Promise.all(input.types.map(async (type, i) => {
      const info = BATCH_TYPE_INFO[type];
      try {
        const seconds: [number, number] = type === "social-reel" ? [10, 15] : type === "just-listed-reel" ? [14, 18] : type === "cinematic-tour" ? [40, 55] : [20, 36];
        const sb = await planStoryboard(input.call, model, {
          style: "listing_tour", facts, analysis, photoCount: images.length,
          override: {
            label: info.title, aspect: input.aspect, seconds,
            brief: `${info.purpose} Emphasis: ${info.emphasis}. This is video ${i + 1} of ${input.types.length} made from the same photos, so give it its own opening photo and pacing. Always show the address${price ? ` and the price (${price})` : ""} as on-screen text.`,
          },
        }, usage);
        const compiled = compileStoryboard({ storyboard: sb, analysis, photos: refs, facts, style: "listing_tour", aspect: input.aspect });
        const texts = [...compiled.plan.texts];
        const joined = texts.map((t) => t.text).join(" ");
        // address and price overlays are required on every video
        if (address && !joined.includes(address)) texts.push({ id: "t_address", text: address, sceneId: "@first", style: "title", position: "bottom", duration: null });
        if (price && !joined.includes(price)) texts.push({ id: "t_price", text: price, sceneId: compiled.plan.scenes[Math.min(1, compiled.plan.scenes.length - 1)]!.id, style: "banner", position: "top", duration: null });
        plans[type] = planSchema.parse({
          ...compiled.plan, texts: texts.slice(-20), music: { assetId: input.music[type] ?? null, volume: 0.6, fadeOut: true },
          ...(input.logoAssetId ? { logoAssetId: input.logoAssetId } : {}),
        });
        saved[type] = { storyboard: sb, warnings: compiled.warnings };
      } catch (e) {
        problems.push({ type, message: `The AI Director couldn't plan this one (${e instanceof Error ? e.message : "error"}); the standard storyboard was used.` });
      }
    }));
    await admin.from("director_runs").update({
      status: "succeeded", finished_at: new Date().toISOString(), cost_cents: costCents(model, usage), usage: usage as unknown as Json,
      analysis: analysis as unknown as Json, storyboard: { batch: saved, refs } as unknown as Json,
    }).eq("id", run.id);
  } catch (e) {
    await admin.from("director_runs").update({
      status: "failed", finished_at: new Date().toISOString(), cost_cents: costCents(model, usage), usage: usage as unknown as Json,
      error_message: e instanceof Error ? e.message : "failed",
    }).eq("id", run.id);
    for (const type of input.types) problems.push({ type, message: "The AI Director couldn't finish; the standard storyboard was used." });
  }
  return { plans, problems };
}

/** "Generate 6 Videos": analyse, build the storyboards, create the projects and queue the renders. */
export async function startBatch(db: Db, ctx: SessionContext, input: BatchStartInput, opts: { call?: CallClaude } = {}): Promise<StoreResult<BatchStartResult>> {
  const listingId = input.listingId;
  const aspect = input.aspect ?? "9:16";
  const planner = input.planner ?? "rules";
  const { listing, photos } = await loadListingInputs(db, listingId);
  if (!listing) return { ok: false, status: 404, message: "We couldn't find that listing." };
  if (photos.length < 5) return { ok: false, status: 400, message: `Add at least 5 photos first — this listing has ${photos.length}.` };
  if (!listing.address_line.trim()) return { ok: false, status: 400, message: "Add the property address to the listing first." };

  const easy = toEasyListing(listing);
  const batchPhotos: BatchPhoto[] = photos.map((p) => ({ id: p.id, width: p.width, height: p.height, camera: parseCamera(p.camera_spec) }));
  const analysis = analyzeListing(easy, batchPhotos);
  // Paid AI only after the person saw and confirmed the expected cost (checked again here).
  let call: CallClaude | null = null;
  if (planner === "ai_director") {
    const est = await batchAiEstimate(db, listingId);
    if (!est) return { ok: false, status: 403, message: "The AI Director isn't available for your account." };
    if (!(Number(input.confirmedCents) >= est.cents)) return { ok: false, status: 409, message: `Please confirm the expected AI cost (about $${(est.cents / 100).toFixed(2)}) first.` };
    call = opts.call ?? await claudeForOrg(ctx.organization.id);
    if (!call) return { ok: false, status: 400, message: "Claude isn't connected yet. Ask your Super Admin to add the Claude API key." };
  }
  const { data: batch, error } = await db.rpc("start_video_batch", { p_listing_id: listingId, p_size: BATCH_TYPES.length, p_analysis: analysis as unknown as Json, p_aspect: aspect, p_planner: planner });
  if (error || !batch) return { ok: false, status: 403, message: friendly(error?.message ?? "") };

  const brand = ctx.brandKit ? { company_name: ctx.brandKit.company_name, outro_text: ctx.brandKit.outro_text } : null;
  const result: BatchStartResult = { batchId: batch.id, created: [], problems: [] };
  const types = BATCH_TYPES.slice(0, batch.size);
  const extras = await brandingAndMusic(db, ctx, types);
  const assets = await loadAssetsFor(db, listing.id);
  let aiPlans: Partial<Record<BatchType, EditPlan>> = {};
  if (call) {
    try {
      const r = await directorPlans(db, { listing, types, aspect, call, music: extras.music, logoAssetId: extras.logoAssetId });
      aiPlans = r.plans;
      result.problems.push(...r.problems);
    } catch (e) {
      const message = e instanceof Error ? e.message : "The AI Director couldn't start; the standard storyboards were used.";
      result.problems.push(...types.map((type) => ({ type, message })));
    }
  }
  for (const type of types) {
    try {
      const plan = aiPlans[type] ?? buildBatchPlan({ type, listing: easy, photos: batchPhotos, brand, aspect, musicAssetId: extras.music[type] ?? null, logoAssetId: extras.logoAssetId });
      const title = `${BATCH_TYPE_INFO[type].title} — ${listing.address_line.trim()}`;
      const doc = composeDocument({ plan, title, photos, music: assets.music, logo: (assets.logos ?? []).find((l) => l.id === plan.logoAssetId) ?? null, brand: ctx.brandKit });
      if (!validateFableCutDocument(doc).ok) throw new Error("invalid document");
      const { data: template } = await db.from("video_templates").select("id").is("organization_id", null).eq("slug", BATCH_TYPE_INFO[type].template).maybeSingle();
      const { data: project, error: pe } = await db.from("video_projects").insert({
        organization_id: ctx.organization.id, listing_id: listing.id, created_by: ctx.userId, template_id: template?.id ?? null,
        brand_kit_id: ctx.brandKit?.id ?? null, title, status: "draft", aspect_ratios: [plan.aspect],
        settings: { kind: "batch", batchType: type } as Json, edit_plan: plan as unknown as Json, document: doc as Json, revision: 1,
        batch_id: batch.id, batch_type: type, batch_variation: 0,
      }).select("id").single();
      if (pe || !project) throw new Error(pe?.message ?? "not saved");
      await db.from("project_revisions").insert({ project_id: project.id, revision: 1, organization_id: ctx.organization.id, document: doc as Json, author_id: ctx.userId, note: "Generate 6 Videos" });
      const queued = await queueRenders(db, ctx, project.id, plan, [plan.aspect], BATCH_TYPE_INFO[type].title);
      if (!queued.ok) result.problems.push({ type, message: queued.message });
      result.created.push({ type, projectId: project.id });
    } catch (e) {
      result.problems.push({ type, message: friendly(e instanceof Error ? e.message : "") });
    }
  }
  return { ok: true, value: result };
}

export interface BatchVideo {
  projectId: string | null;
  type: AnyBatchType;
  /** Licensed music used (title), if any. */
  music: string | null;
  title: string;
  purpose: string;
  aspect: string;
  plannedSeconds: number | null;
  thumbnail: string | null;
  render: { id: string; status: string; progress: number; error_message: string | null; duration_seconds: number | null; width: number | null; height: number | null; created_at: string } | null;
  inLibrary: boolean;
}

/** Everything the batch dashboard shows. */
export async function batchStatus(db: Db, batchId: string): Promise<StoreResult<{ batch: { id: string; listing_id: string | null; size: number; created_at: string; analysis: ListingAnalysis | null; address: string; aspect: string; planner: string }; videos: BatchVideo[] }>> {
  const { data: batch } = await db.from("video_batches").select("*").eq("id", batchId).maybeSingle();
  if (!batch) return { ok: false, status: 404, message: "We couldn't find that batch." };
  const { data: projects } = await db.from("video_projects").select("id,batch_type,edit_plan,listing_id").eq("batch_id", batchId);
  const ids = (projects ?? []).map((p) => p.id);
  const [{ data: renders }, { data: library }, { data: listing }] = await Promise.all([
    ids.length ? db.from("render_jobs").select(`project_id,${RENDER_FIELDS}`).in("project_id", ids).order("created_at", { ascending: false }) : Promise.resolve({ data: [] }),
    db.from("library_videos").select("render_job_id"),
    batch.listing_id ? db.from("listings").select("address_line").eq("id", batch.listing_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const latest = new Map<string, NonNullable<BatchVideo["render"]>>();
  for (const r of (renders ?? []) as unknown as (NonNullable<BatchVideo["render"]> & { project_id: string })[]) if (!latest.has(r.project_id)) latest.set(r.project_id, r);
  const saved = new Set((library ?? []).map((l) => l.render_job_id));

  // thumbnail = the first scene's photo
  const plans = new Map((projects ?? []).map((p) => [p.id, planSchema.safeParse(p.edit_plan)]));
  const firstIds = [...plans.values()].flatMap((p) => (p.success ? [p.data.scenes[0]!.assetId] : []));
  const { data: assets } = firstIds.length ? await db.from("media_assets").select("id,storage_path,thumbnail_path").in("id", firstIds) : { data: [] };
  const urls = await signedUrlMap(BUCKETS.listingMedia, (assets ?? []).map((a) => a.thumbnail_path ?? a.storage_path), 3600);
  const thumbOf = new Map((assets ?? []).map((a) => [a.id, urls[a.thumbnail_path ?? a.storage_path] ?? null]));

  const musicIds = [...plans.values()].flatMap((p) => (p.success && p.data.music.assetId ? [p.data.music.assetId] : []));
  const { data: tracks } = musicIds.length ? await db.from("music_tracks").select("asset_id,title").in("asset_id", musicIds) : { data: [] };
  const trackTitle = new Map((tracks ?? []).map((t) => [t.asset_id, t.title]));
  const byType = new Map((projects ?? []).filter((p) => isAnyBatchType(p.batch_type)).map((p) => [p.batch_type as AnyBatchType, p]));
  // this batch's types: the current six, or (older batches) whatever was made
  const legacy = [...byType.keys()].some((t) => !isBatchType(t));
  const order: AnyBatchType[] = legacy
    ? ["cinematic-tour", "just-listed-reel", "highlights", "luxury", "open-house", "agent-ad"].filter((t) => byType.has(t as AnyBatchType)) as AnyBatchType[]
    : BATCH_TYPES.slice(0, batch.size);
  const videos: BatchVideo[] = order.map((type) => {
    const p = byType.get(type);
    const plan = p ? plans.get(p.id) : undefined;
    const render = p ? latest.get(p.id) ?? null : null;
    return {
      projectId: p?.id ?? null, type, title: BATCH_TYPE_INFO[type].title, purpose: BATCH_TYPE_INFO[type].purpose,
      aspect: plan?.success ? plan.data.aspect : batch.aspect,
      music: plan?.success && plan.data.music.assetId ? trackTitle.get(plan.data.music.assetId) ?? null : null,
      plannedSeconds: plan?.success ? totalDuration(plan.data) : null,
      thumbnail: plan?.success ? thumbOf.get(plan.data.scenes[0]!.assetId) ?? null : null,
      render, inLibrary: !!render && saved.has(render.id),
    };
  });
  return {
    ok: true,
    value: {
      batch: { id: batch.id, listing_id: batch.listing_id, size: batch.size, created_at: batch.created_at, analysis: (batch.analysis as unknown as ListingAnalysis) ?? null, address: listing?.address_line ?? "", aspect: batch.aspect, planner: batch.planner },
      videos,
    },
  };
}

async function loadBatchProject(db: Db, projectId: string) {
  const { data: project } = await db.from("video_projects").select("*").eq("id", projectId).maybeSingle();
  if (!project || !project.batch_id || !isAnyBatchType(project.batch_type)) return null;
  return project;
}

/** Re-queues only this video, and only if its last render failed. */
export async function retryFailed(db: Db, ctx: SessionContext, projectId: string): Promise<StoreResult<unknown[]>> {
  const project = await loadBatchProject(db, projectId);
  if (!project) return { ok: false, status: 404, message: "We couldn't find that video." };
  const { data: last } = await db.from("render_jobs").select("status").eq("project_id", projectId).order("created_at", { ascending: false }).limit(1);
  if (last?.[0] && last[0].status !== "failed" && last[0].status !== "cancelled") return { ok: false, status: 409, message: "Only a video that failed can be retried." };
  const plan = planSchema.safeParse(project.edit_plan);
  if (!plan.success) return { ok: false, status: 400, message: "This video's storyboard can't be read. Use Regenerate." };
  return queueRenders(db, ctx, projectId, plan.data, [plan.data.aspect], BATCH_TYPE_INFO[project.batch_type as AnyBatchType].title);
}

/** Builds a fresh storyboard for this one video (different photos and camera order) and renders it. */
export async function regenerate(db: Db, ctx: SessionContext, projectId: string): Promise<StoreResult<unknown[]>> {
  const project = await loadBatchProject(db, projectId);
  if (!project || !project.listing_id) return { ok: false, status: 404, message: "We couldn't find that video." };
  // older (Stage 8) types are regenerated as their closest current type
  const raw = project.batch_type as AnyBatchType;
  const type: BatchType = isBatchType(raw) ? raw : "luxury-highlights";
  const { listing, photos } = await loadListingInputs(db, project.listing_id);
  const current = planSchema.safeParse(project.edit_plan);
  if (!listing) return { ok: false, status: 404, message: "The listing is gone." };
  const variation = project.batch_variation + 1;
  let plan: EditPlan;
  try {
    plan = buildBatchPlan({
      type, listing: toEasyListing(listing), variation,
      photos: photos.map((p) => ({ id: p.id, width: p.width, height: p.height, camera: parseCamera(p.camera_spec) })),
      brand: ctx.brandKit ? { company_name: ctx.brandKit.company_name, outro_text: ctx.brandKit.outro_text } : null,
      // keep the video's shape, music and logo
      aspect: current.success ? current.data.aspect : "9:16",
      musicAssetId: current.success ? current.data.music.assetId : null,
      logoAssetId: current.success ? current.data.logoAssetId ?? null : null,
    });
  } catch {
    return { ok: false, status: 400, message: "This listing needs photos first." };
  }
  const saved = await savePlan(db, ctx, projectId, plan, project.revision);
  if (!saved.ok) return saved;
  await db.from("video_projects").update({ batch_variation: variation }).eq("id", projectId);
  return queueRenders(db, ctx, projectId, plan, [plan.aspect], BATCH_TYPE_INFO[type].title);
}

/** Saves finished renders to the company library (everyone in the company can watch them). */
export async function saveToLibrary(db: Db, ctx: SessionContext, renderIds: string[]): Promise<StoreResult<{ saved: number }>> {
  const { data: renders } = await db.from("render_jobs").select("id,project_id,status,output_path,aspect,duration_seconds,label").in("id", renderIds);
  const done = (renders ?? []).filter((r) => r.status === "succeeded" && r.output_path);
  if (done.length === 0) return { ok: false, status: 400, message: "Only finished videos can be saved to the library." };
  const { data: projects } = await db.from("video_projects").select("id,title").in("id", done.map((r) => r.project_id));
  const titleOf = new Map((projects ?? []).map((p) => [p.id, p.title]));
  const { data: existing } = await db.from("library_videos").select("render_job_id").in("render_job_id", done.map((r) => r.id));
  const already = new Set((existing ?? []).map((e) => e.render_job_id));
  const rows = done.filter((r) => !already.has(r.id)).map((r) => ({
    organization_id: ctx.organization.id, render_job_id: r.id, project_id: r.project_id, title: (titleOf.get(r.project_id) ?? r.label ?? "Video").slice(0, 200),
    aspect: r.aspect, duration_seconds: r.duration_seconds, output_path: r.output_path!, saved_by: ctx.userId,
  }));
  if (rows.length) {
    const { error } = await db.from("library_videos").insert(rows);
    if (error) return { ok: false, status: 403, message: "You can't save these videos to the library." };
  }
  return { ok: true, value: { saved: rows.length + already.size } };
}
