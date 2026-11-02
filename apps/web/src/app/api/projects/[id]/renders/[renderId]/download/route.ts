import { NextResponse, type NextRequest } from "next/server";
import { apiAuth, jsonError } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";
import { BUCKETS, isUuid } from "@/lib/storage";

type Params = { params: Promise<{ id: string; renderId: string }> };

/**
 * Download a finished MP4. The signed link is created as the signed-in person,
 * so Storage itself checks project access AND their download permission.
 * The link is valid for 2 minutes and only for this file.
 * With ?play=1 the link opens the video in the browser (for the built-in player) instead of saving it.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const auth = await apiAuth(request, "videos.view");
  if (!auth.ok) return auth.response;
  const { id, renderId } = await params;
  if (!isUuid(id) || !isUuid(renderId)) return jsonError(404, "Video not found.");
  if (!auth.ctx.profile.can_download) return jsonError(403, "Downloads are turned off for your account. Ask an administrator.");

  const play = request.nextUrl.searchParams.get("play") === "1";
  const db = await createClient();
  const { data: render } = await db.from("render_jobs").select("id,project_id,status,output_path,aspect")
    .eq("id", renderId).eq("project_id", id).maybeSingle();
  if (!render || render.status !== "succeeded" || !render.output_path) return jsonError(404, "This video isn't ready yet.");
  const { data: project } = await db.from("video_projects").select("title").eq("id", id).maybeSingle();
  const name = `${(project?.title ?? "listing-video").normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "listing-video"}-${render.aspect.replace(":", "x")}.mp4`;

  const { data: link, error } = await db.storage.from(BUCKETS.videoExports).createSignedUrl(render.output_path, play ? 900 : 120, play ? undefined : { download: name });
  if (error || !link) return jsonError(403, "You don't have permission to download this video.");
  return NextResponse.redirect(link.signedUrl, { status: 303, headers: { "Cache-Control": "no-store" } });
}
