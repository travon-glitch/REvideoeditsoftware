import "server-only";
/*
 * Templates on the server (Stage 11):
 *  - each company gets its own approved copies of the fifteen built-in templates (service role, once);
 *  - applying a template to a listing builds the plan from the listing, the photos, the brand kit and
 *    the assigned agent, saves it as an ordinary video project and (optionally) queues the render.
 */
import type { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SessionContext } from "@/lib/auth/session";
import type { Json, ListingRow, ListingStatus, VideoTemplateRow } from "@/lib/database.types";
import { ensureBuiltinMusic, pickTrack, verifiedTracks } from "@/lib/music";
import { agentForListing, brandFacts, loadBrandContext } from "@/lib/brand";
import { parseCamera } from "@/lib/storage-server";
import { composeDocument, type Aspect } from "@/lib/video/plan";
import { loadProjectAssets } from "@/lib/video/editor-data";
import { validateFableCutDocument } from "@/lib/video/validate-document";
import { queueRenders, type StoreResult } from "@/lib/video/project-store";
import {
  applyBrandRules, builtinTemplateRows, buildTemplatePlan, recommendTemplate, templateListing, templateSpecSchema,
  type Recommendation, type TemplateKey, type TemplateSpec, type TemplateWarning,
} from "@/lib/video/templates";

type Db = Awaited<ReturnType<typeof createClient>>;

export interface TemplateView {
  id: string; key: string; recipe: TemplateKey; name: string; usage: string; description: string; status: VideoTemplateRow["status"];
  builtin: boolean; defaultFor: ListingStatus[]; spec: TemplateSpec; approvedAt: string | null; updatedAt: string;
}

/** Adds the company's copies of the built-in templates the first time (approved, ready to use). */
export async function ensureOrgTemplates(orgId: string): Promise<void> {
  const admin = createAdminClient();
  const { data: have } = await admin.from("video_templates").select("builtin_key").eq("organization_id", orgId).not("builtin_key", "is", null);
  const existing = new Set((have ?? []).map((r) => r.builtin_key));
  const rows = builtinTemplateRows(orgId, existing).map((r) => ({ ...r, style: r.style as unknown as Json }));
  if (rows.length) await admin.from("video_templates").insert(rows);
}

export function toView(row: VideoTemplateRow): TemplateView | null {
  const parsed = templateSpecSchema.safeParse(row.style);
  if (!parsed.success) return null;
  return {
    id: row.id, key: row.builtin_key ?? row.slug, recipe: parsed.data.recipe, name: row.name, usage: row.usage || parsed.data.usage,
    description: row.description || parsed.data.description, status: row.status, builtin: !!row.builtin_key, defaultFor: row.default_for ?? [],
    spec: { ...parsed.data, name: row.name }, approvedAt: row.approved_at, updatedAt: row.updated_at,
  };
}

/** Templates the person may see (people who make videos: approved only — enforced by RLS). */
export async function listTemplates(db: Db, ctx: SessionContext): Promise<TemplateView[]> {
  await ensureOrgTemplates(ctx.organization.id);
  const { data } = await db.from("video_templates").select("*").eq("organization_id", ctx.organization.id).order("sort_order").order("created_at");
  return (data ?? []).flatMap((r) => { const v = toView(r); return v ? [v] : []; });
}

/** The recommended approved template for a listing (company defaults first). */
export function recommendFor(listing: ListingRow, templates: TemplateView[]): (Recommendation & { template: TemplateView }) | null {
  const approved = templates.filter((t) => t.status === "approved");
  if (!approved.length) return null;
  const defaults: Partial<Record<string, TemplateKey>> = {};
  const byRecipe = new Map<string, TemplateView>();
  for (const t of approved) {
    for (const s of t.defaultFor) defaults[s] = t.id as TemplateKey;
    if (!byRecipe.has(t.recipe) || t.builtin) byRecipe.set(t.recipe, t);
  }
  const assigned = defaults[listing.status];
  if (assigned) {
    const t = approved.find((x) => x.id === assigned)!;
    return { key: t.recipe, template: t, reason: "Your company's default template for this kind of listing." };
  }
  const rec = recommendTemplate(templateListing(listing), { available: [...byRecipe.keys()] });
  const t = byRecipe.get(rec.key);
  return t ? { ...rec, template: t } : null;
}

export interface ApplyResult { projectId: string; warnings: TemplateWarning[]; changes: string[]; renderQueued: boolean; renderError: string | null }

/** Template + listing → a saved video project (and its render, if asked). */
export async function applyTemplate(db: Db, ctx: SessionContext, input: { listingId: string; templateId: string; aspect?: Aspect; render?: boolean }): Promise<StoreResult<ApplyResult>> {
  const [{ data: listing }, { data: row }, { data: access }] = await Promise.all([
    db.from("listings").select("*").eq("id", input.listingId).maybeSingle(),
    db.from("video_templates").select("*").eq("id", input.templateId).maybeSingle(),
    db.rpc("listing_access", { p_listing: input.listingId }),
  ]);
  if (!listing || access === "none") return { ok: false, status: 404, message: "We couldn't find that listing." };
  if (access !== "edit") return { ok: false, status: 403, message: "You can view this listing but not make videos from it." };
  if (!row || row.organization_id !== ctx.organization.id) return { ok: false, status: 404, message: "We couldn't find that template." };
  if (row.status !== "approved") return { ok: false, status: 403, message: "This template isn't approved for use yet." };
  const view = toView(row);
  if (!view) return { ok: false, status: 400, message: "This template needs fixing by an administrator." };
  if (!listing.address_line.trim()) return { ok: false, status: 400, message: "Add the property address to the listing first." };

  const { data: photoRows } = await db.from("media_assets").select("id,width,height,camera_spec").eq("listing_id", listing.id).eq("kind", "photo").order("sort_order");
  if (!photoRows?.length) return { ok: false, status: 400, message: "Add photos to the listing first." };

  const bc = await loadBrandContext(db, ctx);
  const { agent } = await agentForListing(db, listing, bc.kit);
  // licensed music: the brand kit's default track, or a verified track that suits the template
  await ensureBuiltinMusic(ctx.organization.id).catch(() => undefined);
  const tracks = await verifiedTracks(db);
  const kitTrack = bc.kit?.music_asset_id ? tracks.find((t) => t.assetId === bc.kit!.music_asset_id) ?? null : null;
  const music = bc.kit && !bc.kit.music_follow_template && kitTrack ? kitTrack : pickTrack(tracks, view.spec.music) ?? kitTrack;

  let built;
  try {
    built = buildTemplatePlan({
      spec: view.spec, listing: templateListing(listing), brand: bc.template, agent, rules: bc.rules, aspect: input.aspect, musicAssetId: music?.assetId ?? null,
      photos: photoRows.map((p) => ({ id: p.id, width: p.width, height: p.height, camera: parseCamera(p.camera_spec) })),
    });
  } catch (e) {
    return { ok: false, status: 400, message: e instanceof Error ? e.message : "The template couldn't be applied." };
  }
  if (bc.kit?.music_volume != null) built.plan.music.volume = Number(bc.kit.music_volume);
  const enforced = applyBrandRules(built.plan, bc.rules, brandFacts(bc, agent));
  const plan = enforced.plan;

  const title = `${view.name} — ${listing.address_line.trim()}`.slice(0, 160);
  const { data: project, error } = await db.from("video_projects").insert({
    organization_id: ctx.organization.id, listing_id: listing.id, template_id: row.id, created_by: ctx.userId, brand_kit_id: bc.kit?.id ?? null,
    title, status: "draft", aspect_ratios: [plan.aspect], edit_plan: plan as unknown as Json, revision: 1,
    settings: { kind: "template", template: view.key, recipe: view.recipe, warnings: built.warnings } as unknown as Json,
  }).select("*").single();
  if (error || !project) {
    return { ok: false, status: 403, message: /Monthly video limit|Daily video limit/.test(error?.message ?? "") ? "You've reached your video limit." : "The video couldn't be created." };
  }
  const assets = await loadProjectAssets(db, project);
  const document = composeDocument({
    plan, title, photos: assets.photos, music: assets.music, clips: assets.clips, brand: ctx.brandKit,
    logo: (assets.logos ?? []).find((l) => l.id === plan.logoAssetId) ?? null, brandImages: assets.logos ?? [],
  });
  const check = validateFableCutDocument(document);
  if (!check.ok) {
    await db.from("video_projects").delete().eq("id", project.id);
    return { ok: false, status: 400, message: "The template couldn't be turned into a video." };
  }
  await db.from("video_projects").update({ document: document as Json }).eq("id", project.id);
  await db.from("project_revisions").insert({ project_id: project.id, revision: 1, organization_id: ctx.organization.id, document: document as Json, author_id: ctx.userId, note: `Template: ${view.name}` });

  let renderQueued = false, renderError: string | null = null;
  if (input.render) {
    const q = await queueRenders(db, ctx, project.id, plan, [plan.aspect], view.name);
    renderQueued = q.ok;
    if (!q.ok) renderError = q.message;
  }
  return { ok: true, value: { projectId: project.id, warnings: built.warnings, changes: enforced.changes, renderQueued, renderError } };
}
