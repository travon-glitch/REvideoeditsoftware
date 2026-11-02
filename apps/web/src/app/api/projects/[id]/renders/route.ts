import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { apiAuth, jsonError, readJson } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/storage";
import { ASPECTS } from "@/lib/video/plan";
import { currentPlan, loadProjectAssets } from "@/lib/video/editor-data";
import { RENDER_FIELDS, queueRenders } from "@/lib/video/project-store";

type Params = { params: Promise<{ id: string }> };

/** Renders of this project (only visible to people who can see the project). */
export async function GET(request: NextRequest, { params }: Params) {
  const auth = await apiAuth(request, "videos.view");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isUuid(id)) return jsonError(404, "Video not found.");
  const db = await createClient();
  const { data } = await db.from("render_jobs").select(RENDER_FIELDS).eq("project_id", id).order("created_at", { ascending: false }).limit(30);
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
  const { data: project } = await db.from("video_projects").select("*").eq("id", id).maybeSingle();
  if (!project) return jsonError(404, "Video not found.");
  const { data: listing } = project.listing_id ? await db.from("listings").select("*").eq("id", project.listing_id).maybeSingle() : { data: null };
  const plan = currentPlan(project, listing, await loadProjectAssets(db, project));
  const result = await queueRenders(db, auth.ctx, id, plan, body.data.aspects);
  if (!result.ok) return jsonError(result.status, result.message);
  return NextResponse.json({ renders: result.value }, { status: 201 });
}
