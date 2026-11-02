import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { apiAuth, jsonError, readJson } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/storage";
import { composeDocument, planSchema, totalDuration } from "@/lib/video/plan";
import { currentPlan, loadProjectAssets, planUsesOnly } from "@/lib/video/editor-data";
import { validateFableCutDocument } from "@/lib/video/validate-document";
import type { Json } from "@/lib/database.types";

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
  const { data: access } = await db.rpc("project_access", { p_project: id });
  if (access !== "edit") return jsonError(access === "read" ? 403 : 404, access === "read" ? "You can view this video but not edit it." : "Video not found.");
  const { data: project } = await db.from("video_projects").select("id,title,listing_id,revision,organization_id").eq("id", id).maybeSingle();
  if (!project) return jsonError(404, "Video not found.");
  if (project.revision !== baseRevision) {
    return jsonError(409, "This video was changed somewhere else. Reload to see the latest version.", { revision: project.revision });
  }

  const assets = await loadProjectAssets(db, project);
  const misuse = planUsesOnly(plan, assets);
  if (misuse) return jsonError(400, misuse);
  const document = composeDocument({ plan, title: project.title, photos: assets.photos, music: assets.music, brand: auth.ctx.brandKit });
  const check = validateFableCutDocument(document);
  if (!check.ok) return jsonError(400, "This edit can't be saved.", { detail: check.error });

  const next = baseRevision + 1;
  document.revision = next;
  const { data: saved, error } = await db.from("video_projects")
    .update({ edit_plan: plan as unknown as Json, document: document as Json, revision: next, aspect_ratios: [plan.aspect] })
    .eq("id", id).eq("revision", baseRevision).select("revision");
  if (error) return jsonError(500, "The changes could not be saved. Please try again.");
  if (!saved || saved.length === 0) {
    const { data: now } = await db.from("video_projects").select("revision").eq("id", id).maybeSingle();
    return jsonError(409, "This video was changed somewhere else. Reload to see the latest version.", { revision: now?.revision ?? null });
  }
  await db.from("project_revisions").insert({
    project_id: id, revision: next, organization_id: project.organization_id, document: document as Json, author_id: auth.ctx.userId,
  });
  return NextResponse.json({ revision: next, duration: totalDuration(plan) }, { headers: { "Cache-Control": "no-store" } });
}
