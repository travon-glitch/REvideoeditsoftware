import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { apiAuth, jsonError, readJson } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/storage";
import { ASPECTS, composeDocument } from "@/lib/video/plan";
import { currentPlan, loadProjectAssets } from "@/lib/video/editor-data";
import { validateFableCutDocument } from "@/lib/video/validate-document";
import type { Json } from "@/lib/database.types";

type Params = { params: Promise<{ id: string }> };
const FIELDS = "id,aspect,status,progress,error_message,created_at,started_at,finished_at,duration_seconds,width,height,size_bytes,output_asset_id";

/** Renders of this project (only visible to people who can see the project). */
export async function GET(request: NextRequest, { params }: Params) {
  const auth = await apiAuth(request, "videos.view");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isUuid(id)) return jsonError(404, "Video not found.");
  const db = await createClient();
  const { data } = await db.from("render_jobs").select(FIELDS).eq("project_id", id).order("created_at", { ascending: false }).limit(30);
  return NextResponse.json({ renders: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
}

const exportSchema = z.object({ aspects: z.array(z.enum(ASPECTS)).min(1).max(3) });

/** Export: queues one render per format, from the saved plan, for the background worker. */
export async function POST(request: NextRequest, { params }: Params) {
  const auth = await apiAuth(request, "videos.create");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isUuid(id)) return jsonError(404, "Video not found.");
  let body;
  try { body = exportSchema.safeParse(await readJson(request)); } catch { return jsonError(400, "The request could not be read."); }
  if (!body.success) return jsonError(400, "Choose at least one format.");

  const db = await createClient();
  const { data: access } = await db.rpc("project_access", { p_project: id });
  if (access !== "edit") return jsonError(access === "read" ? 403 : 404, access === "read" ? "Only people who can edit this video can export it." : "Video not found.");
  const { data: project } = await db.from("video_projects").select("*").eq("id", id).maybeSingle();
  if (!project) return jsonError(404, "Video not found.");
  const { data: busy } = await db.from("render_jobs").select("id").eq("project_id", id).in("status", ["queued", "running"]).limit(1);
  if (busy && busy.length > 0) return jsonError(409, "This video is already being made. Please wait for it to finish.");

  const { data: listing } = project.listing_id ? await db.from("listings").select("*").eq("id", project.listing_id).maybeSingle() : { data: null };
  const assets = await loadProjectAssets(db, project);
  const plan = currentPlan(project, listing, assets);
  const rows = [];
  for (const aspect of [...new Set(body.data.aspects)]) {
    const document = composeDocument({ plan, aspect, title: project.title, photos: assets.photos, music: assets.music, brand: auth.ctx.brandKit });
    const check = validateFableCutDocument(document);
    if (!check.ok) return jsonError(400, "This video can't be exported yet.", { detail: check.error });
    rows.push({
      organization_id: project.organization_id, project_id: id, revision: project.revision, preset: "master-1080p",
      aspect, document: document as Json, requested_by: auth.ctx.userId,
    });
  }
  const { data, error } = await db.from("render_jobs").insert(rows).select(FIELDS);
  if (error) return jsonError(403, "You can't export this video.");
  await db.from("video_projects").update({ status: "rendering" }).eq("id", id);
  return NextResponse.json({ renders: data }, { status: 201 });
}
