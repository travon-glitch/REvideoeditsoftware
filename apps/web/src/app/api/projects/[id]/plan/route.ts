import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { apiAuth, jsonError, readJson } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/storage";
import { planSchema } from "@/lib/video/plan";
import { currentPlan, loadProjectAssets } from "@/lib/video/editor-data";
import { savePlan } from "@/lib/video/project-store";

type Params = { params: Promise<{ id: string }> };

/** The project's edit plan (the editor's model) and its revision. */
export async function GET(request: NextRequest, { params }: Params) {
  const auth = await apiAuth(request, "videos.view");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isUuid(id)) return jsonError(404, "Video not found.");
  const db = await createClient();
  const { data: project } = await db.from("video_projects").select("*").eq("id", id).maybeSingle();
  if (!project) return jsonError(404, "Video not found.");
  const { data: listing } = project.listing_id
    ? await db.from("listings").select("*").eq("id", project.listing_id).maybeSingle() : { data: null };
  const assets = await loadProjectAssets(db, project);
  return NextResponse.json({ plan: currentPlan(project, listing, assets), revision: project.revision }, { headers: { "Cache-Control": "no-store" } });
}

const saveSchema = z.object({ baseRevision: z.number().int().nonnegative(), plan: planSchema });

/**
 * Autosave. The plan is checked, turned into a FableCut project document,
 * validated by FableCut, and saved only if nobody saved in between (409 otherwise).
 */
export async function PUT(request: NextRequest, { params }: Params) {
  const auth = await apiAuth(request, "videos.create");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isUuid(id)) return jsonError(404, "Video not found.");
  let body;
  try { body = saveSchema.safeParse(await readJson(request)); } catch { return jsonError(400, "The changes could not be read."); }
  if (!body.success) return jsonError(400, "Some changes aren't valid.", { issues: body.error.issues.slice(0, 5).map((i) => i.message) });
  const { baseRevision, plan } = body.data;

  const db = await createClient();
  const result = await savePlan(db, auth.ctx, id, plan, baseRevision);
  if (!result.ok) return jsonError(result.status, result.message, result.revision !== undefined ? { revision: result.revision } : {});
  return NextResponse.json(result.value, { headers: { "Cache-Control": "no-store" } });
}
