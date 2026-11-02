import { NextResponse, type NextRequest } from "next/server";
import { apiAuth, jsonError } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/storage";

type Params = { params: Promise<{ id: string }> };

/** Remove a video from the library (the person who saved it, or an admin). The video itself stays. */
export async function DELETE(request: NextRequest, { params }: Params) {
  const auth = await apiAuth(request, "videos.create");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isUuid(id)) return jsonError(404, "Not found.");
  const { data } = await (await createClient()).from("library_videos").delete().eq("id", id).select("id");
  if (!data?.length) return jsonError(403, "You can't remove this video from the library.");
  return NextResponse.json({ ok: true });
}
