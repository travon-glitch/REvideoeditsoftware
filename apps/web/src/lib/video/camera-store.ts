import "server-only";
/*
 * Camera Studio on the server. Everything runs as the signed-in person (RLS).
 *  - exportClip: renders one photo with one camera move to a 1080p MP4 through
 *    the normal FableCut render worker (STANDARD method). Clips live in one
 *    "Camera Studio" project per listing, so they appear in My Videos too.
 *  - startAiClip: queues an AI camera job (AI DEPTH on our server, or a
 *    GENERATIVE provider when the company has switched AI on).
 *  - savePhotoCamera / applyToScene: keep a move on a photo, or put a move or
 *    AI clip on one scene of a video.
 */
import type { createClient } from "@/lib/supabase/server";
import type { SessionContext } from "@/lib/auth/session";
import type { Json } from "@/lib/database.types";
import { BUCKETS } from "@/lib/storage";
import { signedUrlMap } from "@/lib/storage-server";
import { describeSpec, getStudioMove, isManualZero, type CameraSpec } from "@lvs/camera-presets";
import { composeDocument, type Aspect, type EditPlan } from "@/lib/video/plan";
import { validateFableCutDocument } from "@/lib/video/validate-document";
import { currentPlan, loadProjectAssets } from "@/lib/video/editor-data";
import { RENDER_FIELDS, queueRenders, savePlan, type StoreResult } from "@/lib/video/project-store";

type Db = Awaited<ReturnType<typeof createClient>>;

export const CLIP_PROJECT_KIND = "camera_clip";
export const LOCAL_DEPTH = "local-depth";

/** The generative provider the AI worker has (set LVS_GENERATIVE_PROVIDER=muapi on the web app when the worker has a key). */
export function generativeProvider(): { id: string; model: string } | null {
  const id = process.env.LVS_GENERATIVE_PROVIDER?.trim();
  if (!id) return null;
  return { id, model: process.env.LVS_GENERATIVE_MODEL?.trim() || (id === "muapi" ? "kling-v2.1-standard-i2v" : "default") };
}

interface PhotoRow { id: string; listing_id: string | null; storage_path: string; file_name: string; width: number | null; height: number | null; kind: string; bucket: string }

async function loadPhoto(db: Db, assetId: string): Promise<StoreResult<PhotoRow & { listing_id: string }>> {
  const { data } = await db.from("media_assets").select("id,listing_id,storage_path,file_name,width,height,kind,bucket").eq("id", assetId).maybeSingle();
  if (!data || data.kind !== "photo" || data.bucket !== BUCKETS.listingMedia || !data.listing_id) return { ok: false, status: 404, message: "We couldn't find that photo." };
  const { data: access } = await db.rpc("listing_access", { p_listing: data.listing_id });
  if (access !== "edit") return { ok: false, status: 403, message: "You can view this photo but not make videos from it." };
  return { ok: true, value: data as PhotoRow & { listing_id: string } };
}

function clipPlan(assetId: string, camera: CameraSpec, duration: number, aspect: Aspect): EditPlan {
  return {
    version: 1, aspect, transition: "none", texts: [], music: { assetId: null, volume: 0.8, fadeOut: false },
    scenes: [{ id: "s1", assetId, move: "still", duration, camera }],
  };
}

/** STANDARD method: queue a 1080p MP4 of one photo with this camera move. */
export async function exportClip(db: Db, ctx: SessionContext, input: { assetId: string; camera: CameraSpec; duration: number; aspect: Aspect }): Promise<StoreResult<unknown[]>> {
  const photo = await loadPhoto(db, input.assetId);
  if (!photo.ok) return photo;
  const listingId = photo.value.listing_id;
  const plan = clipPlan(input.assetId, input.camera, input.duration, input.aspect);
  const label = `${describeSpec(input.camera, input.duration)} · ${input.aspect}`;

  // one Camera Studio project per listing (and person), created on first export
  const { data: existing } = await db.from("video_projects").select("id,revision")
    .eq("listing_id", listingId).eq("created_by", ctx.userId).contains("settings", { kind: CLIP_PROJECT_KIND })
    .order("created_at").limit(1);
  let projectId = existing?.[0]?.id ?? null;
  let revision = existing?.[0]?.revision ?? 0;
  if (!projectId) {
    const { data: listing } = await db.from("listings").select("address_line").eq("id", listingId).maybeSingle();
    const title = `Camera Studio clips — ${listing?.address_line?.trim() || "listing"}`;
    const doc = composeDocument({ plan, title, photos: [photo.value], music: [], brand: ctx.brandKit });
    if (!validateFableCutDocument(doc).ok) return { ok: false, status: 400, message: "This camera move can't be rendered. Try a gentler setting." };
    const { data: created, error } = await db.from("video_projects").insert({
      organization_id: ctx.organization.id, listing_id: listingId, created_by: ctx.userId, brand_kit_id: ctx.brandKit?.id ?? null,
      title, status: "draft", aspect_ratios: [input.aspect], settings: { kind: CLIP_PROJECT_KIND } as Json,
      edit_plan: plan as unknown as Json, document: doc as Json, revision: 1,
    }).select("id,revision").single();
    if (error && /Monthly video limit/.test(error.message)) return { ok: false, status: 403, message: "You've reached your monthly video limit." };
    if (error || !created) return { ok: false, status: 500, message: "We couldn't start the export. Please try again." };
    projectId = created.id; revision = created.revision;
  } else {
    const saved = await savePlan(db, ctx, projectId, plan, revision);
    if (!saved.ok) return saved;
  }
  return queueRenders(db, ctx, projectId, plan, [input.aspect], label);
}

/** AI method: queue a depth or generative AI clip for the worker. */
export async function startAiClip(db: Db, ctx: SessionContext, input: {
  assetId: string; camera: CameraSpec; duration: number; aspect: Aspect; method: "depth" | "generative";
}): Promise<StoreResult<{ id: string }>> {
  if (!ctx.profile.can_use_ai) return { ok: false, status: 403, message: "AI isn't switched on for your account. Ask an administrator." };
  const move = getStudioMove(input.camera.move);
  if (!move) return { ok: false, status: 400, message: "Unknown camera move." };
  const manual = !isManualZero(input.camera.manual);
  if (input.method === "depth" && !manual && !move.ai.includes("depth")) return { ok: false, status: 400, message: `${move.name} doesn't need AI depth — use the Standard method.` };
  let provider = LOCAL_DEPTH, model = "midas-v21-small";
  if (input.method === "generative") {
    const g = generativeProvider();
    if (!g) return { ok: false, status: 400, message: "No generative AI video service is connected yet. Ask an administrator." };
    provider = g.id; model = g.model;
  }
  const photo = await loadPhoto(db, input.assetId);
  if (!photo.ok) return photo;
  const { data, error } = await db.from("generation_jobs").insert({
    organization_id: ctx.organization.id, listing_id: photo.value.listing_id, source_asset_id: input.assetId, requested_by: ctx.userId,
    kind: "image_to_video", provider, model, camera_move: input.camera.move,
    input: { spec: input.camera, duration: input.duration, aspect: input.aspect } as unknown as Json,
  }).select("id").single();
  if (error && /Monthly AI limit/.test(error.message)) return { ok: false, status: 403, message: "You've reached your monthly AI limit." };
  if (error || !data) {
    return { ok: false, status: 403, message: input.method === "generative" ? "Generative AI isn't switched on for your company. An administrator can turn it on." : "You can't make AI clips for this photo." };
  }
  return { ok: true, value: { id: data.id } };
}

/** Saves (or clears) the photo's own camera move — new and Easy Mode videos of the listing use it. */
export async function savePhotoCamera(db: Db, assetId: string, camera: CameraSpec | null): Promise<StoreResult<null>> {
  const photo = await loadPhoto(db, assetId);
  if (!photo.ok) return photo;
  const { data, error } = await db.from("media_assets").update({ camera_spec: camera as unknown as Json }).eq("id", assetId).select("id");
  if (error || !data?.length) return { ok: false, status: 403, message: "You can't change this photo." };
  return { ok: true, value: null };
}

/** Puts a camera move (or an AI clip) on one scene of a video. */
export async function applyToScene(db: Db, ctx: SessionContext, input: {
  projectId: string; sceneId: string; camera: CameraSpec | null; clipAssetId: string | null;
}): Promise<StoreResult<{ revision: number }>> {
  const { data: project } = await db.from("video_projects").select("*").eq("id", input.projectId).maybeSingle();
  if (!project) return { ok: false, status: 404, message: "We couldn't find this video." };
  const { data: listing } = project.listing_id ? await db.from("listings").select("*").eq("id", project.listing_id).maybeSingle() : { data: null };
  const assets = await loadProjectAssets(db, project);
  const plan = currentPlan(project, listing, assets);
  const scene = plan.scenes.find((s) => s.id === input.sceneId);
  if (!scene) return { ok: false, status: 404, message: "That scene isn't in the video any more." };
  if (input.clipAssetId) {
    const clip = assets.clips.find((c) => c.id === input.clipAssetId);
    if (!clip || clip.source_asset_id !== scene.assetId) return { ok: false, status: 400, message: "That AI clip wasn't made from this scene's photo." };
    scene.clipAssetId = clip.id;
    if (clip.duration_seconds) scene.duration = Math.max(1.5, Math.min(10, Math.floor(Number(clip.duration_seconds) * 10) / 10));
  } else {
    delete scene.clipAssetId;
  }
  if (input.camera) scene.camera = input.camera; else if (!input.clipAssetId) delete scene.camera;
  if (plan.easy) plan.easy = { ...plan.easy, customized: true };
  const r = await savePlan(db, ctx, project.id, plan, project.revision);
  return r.ok ? { ok: true, value: { revision: r.value.revision } } : r;
}

export interface StudioClip {
  id: string; label: string; sourceAssetId: string | null; url: string | null; durationSeconds: number | null;
  review: unknown; decision: unknown; createdAt: string;
}

/** Everything the studio shows for a listing: AI jobs, AI clips (with links) and standard clip exports. */
export async function studioActivity(db: Db, ctx: SessionContext, listingId: string) {
  const [{ data: jobs }, { data: clips }, { data: projects }] = await Promise.all([
    db.from("generation_jobs").select("id,source_asset_id,provider,model,camera_move,status,progress,error_message,created_at,output_asset_id,review")
      .eq("listing_id", listingId).order("created_at", { ascending: false }).limit(20),
    db.from("media_assets").select("id,file_name,source_asset_id,storage_path,duration_seconds,ai_review,ai_decision,created_at")
      .eq("listing_id", listingId).eq("kind", "ai_clip").order("created_at", { ascending: false }).limit(30),
    db.from("video_projects").select("id").eq("listing_id", listingId).eq("created_by", ctx.userId).contains("settings", { kind: CLIP_PROJECT_KIND }).limit(1),
  ]);
  const clipProject = projects?.[0]?.id ?? null;
  const { data: renders } = clipProject
    ? await db.from("render_jobs").select(RENDER_FIELDS).eq("project_id", clipProject).order("created_at", { ascending: false }).limit(20)
    : { data: [] };
  const urls = await signedUrlMap(BUCKETS.aiClips, (clips ?? []).map((c) => c.storage_path), 3600);
  return {
    clipProject,
    renders: renders ?? [],
    jobs: jobs ?? [],
    clips: (clips ?? []).map((c): StudioClip => ({
      id: c.id, label: c.file_name.replace(/\.mp4$/, ""), sourceAssetId: c.source_asset_id, url: urls[c.storage_path] ?? null,
      durationSeconds: c.duration_seconds == null ? null : Number(c.duration_seconds), review: c.ai_review, decision: c.ai_decision, createdAt: c.created_at,
    })),
  };
}
