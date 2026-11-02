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
import { BATCH_TYPES, BATCH_TYPE_INFO, analyzeListing, buildBatchPlan, type BatchPhoto, type BatchType, type ListingAnalysis } from "@/lib/video/batch";
import { RENDER_FIELDS, queueRenders, savePlan, toEasyListing, type StoreResult } from "@/lib/video/project-store";

type Db = Awaited<ReturnType<typeof createClient>>;

const isBatchType = (v: unknown): v is BatchType => (BATCH_TYPES as readonly string[]).includes(String(v));

function friendly(message: string): string {
  if (/Daily video limit/.test(message)) return message.replace(/^.*?(Daily video limit)/, "$1") + ".";
  if (/Monthly video limit/.test(message)) return "You've reached your monthly video limit.";
  if (/isn't switched on/.test(message)) return "Generate 6 Videos isn't switched on for your account. Ask your Super Admin.";
  if (/can't make videos/.test(message)) return "You can't make videos from this listing.";
  return "Something went wrong. Please try again.";
}

async function loadListingInputs(db: Db, listingId: string) {
  const [{ data: listing }, { data: photos }] = await Promise.all([
    db.from("listings").select("*").eq("id", listingId).maybeSingle(),
    db.from("media_assets").select("id,storage_path,thumbnail_path,file_name,width,height,camera_spec").eq("listing_id", listingId).eq("kind", "photo").order("sort_order"),
  ]);
  return { listing, photos: photos ?? [] };
}

export interface BatchStartResult { batchId: string; created: { type: BatchType; projectId: string }[]; problems: { type: BatchType; message: string }[] }

/** "Generate 6 Videos": analyse, build the storyboards, create the projects and queue the renders. */
export async function startBatch(db: Db, ctx: SessionContext, listingId: string): Promise<StoreResult<BatchStartResult>> {
  const { listing, photos } = await loadListingInputs(db, listingId);
  if (!listing) return { ok: false, status: 404, message: "We couldn't find that listing." };
  if (photos.length < 5) return { ok: false, status: 400, message: `Add at least 5 photos first — this listing has ${photos.length}.` };
  if (!listing.address_line.trim()) return { ok: false, status: 400, message: "Add the property address to the listing first." };

  const easy = toEasyListing(listing);
  const batchPhotos: BatchPhoto[] = photos.map((p) => ({ id: p.id, width: p.width, height: p.height, camera: parseCamera(p.camera_spec) }));
  const analysis = analyzeListing(easy, batchPhotos);
  const { data: batch, error } = await db.rpc("start_video_batch", { p_listing_id: listingId, p_size: BATCH_TYPES.length, p_analysis: analysis as unknown as Json });
  if (error || !batch) return { ok: false, status: 403, message: friendly(error?.message ?? "") };

  const brand = ctx.brandKit ? { company_name: ctx.brandKit.company_name, outro_text: ctx.brandKit.outro_text } : null;
  const result: BatchStartResult = { batchId: batch.id, created: [], problems: [] };
  for (const type of BATCH_TYPES.slice(0, batch.size)) {
    try {
      const plan = buildBatchPlan({ type, listing: easy, photos: batchPhotos, brand });
      const title = `${BATCH_TYPE_INFO[type].title} — ${listing.address_line.trim()}`;
      const doc = composeDocument({ plan, title, photos, music: [], brand: ctx.brandKit });
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
  type: BatchType;
  title: string;
  purpose: string;
  aspect: string;
  plannedSeconds: number | null;
  thumbnail: string | null;
  render: { id: string; status: string; progress: number; error_message: string | null; duration_seconds: number | null; width: number | null; height: number | null; created_at: string } | null;
  inLibrary: boolean;
}

/** Everything the batch dashboard shows. */
export async function batchStatus(db: Db, batchId: string): Promise<StoreResult<{ batch: { id: string; listing_id: string | null; size: number; created_at: string; analysis: ListingAnalysis | null; address: string }; videos: BatchVideo[] }>> {
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

  const byType = new Map((projects ?? []).filter((p) => isBatchType(p.batch_type)).map((p) => [p.batch_type as BatchType, p]));
  const videos: BatchVideo[] = BATCH_TYPES.slice(0, batch.size).map((type) => {
    const p = byType.get(type);
    const plan = p ? plans.get(p.id) : undefined;
    const render = p ? latest.get(p.id) ?? null : null;
    return {
      projectId: p?.id ?? null, type, title: BATCH_TYPE_INFO[type].title, purpose: BATCH_TYPE_INFO[type].purpose, aspect: BATCH_TYPE_INFO[type].aspect,
      plannedSeconds: plan?.success ? totalDuration(plan.data) : null,
      thumbnail: plan?.success ? thumbOf.get(plan.data.scenes[0]!.assetId) ?? null : null,
      render, inLibrary: !!render && saved.has(render.id),
    };
  });
  return {
    ok: true,
    value: {
      batch: { id: batch.id, listing_id: batch.listing_id, size: batch.size, created_at: batch.created_at, analysis: (batch.analysis as unknown as ListingAnalysis) ?? null, address: listing?.address_line ?? "" },
      videos,
    },
  };
}

async function loadBatchProject(db: Db, projectId: string) {
  const { data: project } = await db.from("video_projects").select("*").eq("id", projectId).maybeSingle();
  if (!project || !project.batch_id || !isBatchType(project.batch_type)) return null;
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
  return queueRenders(db, ctx, projectId, plan.data, [plan.data.aspect], BATCH_TYPE_INFO[project.batch_type as BatchType].title);
}

/** Builds a fresh storyboard for this one video (different photos and camera order) and renders it. */
export async function regenerate(db: Db, ctx: SessionContext, projectId: string): Promise<StoreResult<unknown[]>> {
  const project = await loadBatchProject(db, projectId);
  if (!project || !project.listing_id) return { ok: false, status: 404, message: "We couldn't find that video." };
  const type = project.batch_type as BatchType;
  const { listing, photos } = await loadListingInputs(db, project.listing_id);
  if (!listing) return { ok: false, status: 404, message: "The listing is gone." };
  const variation = project.batch_variation + 1;
  let plan: EditPlan;
  try {
    plan = buildBatchPlan({
      type, listing: toEasyListing(listing), variation,
      photos: photos.map((p) => ({ id: p.id, width: p.width, height: p.height, camera: parseCamera(p.camera_spec) })),
      brand: ctx.brandKit ? { company_name: ctx.brandKit.company_name, outro_text: ctx.brandKit.outro_text } : null,
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
