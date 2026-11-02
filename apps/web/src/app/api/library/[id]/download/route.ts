import { NextResponse, type NextRequest } from "next/server";
import { apiAuth, jsonError } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";
import { BUCKETS, isUuid } from "@/lib/storage";
import { zipName } from "@/lib/zip";

type Params = { params: Promise<{ id: string }> };

/** Watch (?play=1) or download a library video. Storage checks the person's download permission. */
export async function GET(request: NextRequest, { params }: Params) {
  const auth = await apiAuth(request, "videos.view");
  if (!auth.ok) return auth.response;
  if (!auth.ctx.profile.can_download) return jsonError(403, "Downloads are turned off for your account.");
  const { id } = await params;
  if (!isUuid(id)) return jsonError(404, "Video not found.");
  const db = await createClient();
  const { data: item } = await db.from("library_videos").select("title,aspect,output_path").eq("id", id).maybeSingle();
  if (!item) return jsonError(404, "Video not found.");
  const play = request.nextUrl.searchParams.get("play") === "1";
  const { data: link, error } = await db.storage.from(BUCKETS.videoExports)
    .createSignedUrl(item.output_path, play ? 900 : 120, play ? undefined : { download: zipName(`${item.title}-${item.aspect.replace(":", "x")}`, "mp4", new Set()) });
  if (error || !link) return jsonError(403, "You don't have permission to download this video.");
  return NextResponse.redirect(link.signedUrl, { status: 303, headers: { "Cache-Control": "no-store" } });
}
