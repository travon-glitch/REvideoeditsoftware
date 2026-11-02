import { NextResponse, type NextRequest } from "next/server";
import { apiAuth, jsonError, readJson } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/storage";
import { savePhotoCamera } from "@/lib/video/camera-store";
import { photoCameraSchema } from "../../schemas";

type Params = { params: Promise<{ id: string }> };

/** Saves (or clears with null) a photo's own camera move. */
export async function PUT(request: NextRequest, { params }: Params) {
  const auth = await apiAuth(request, "videos.create");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isUuid(id)) return jsonError(404, "Photo not found.");
  let body;
  try { body = photoCameraSchema.safeParse(await readJson(request)); } catch { return jsonError(400, "The request could not be read."); }
  if (!body.success) return jsonError(400, "Some camera settings aren't valid.");
  const r = await savePhotoCamera(await createClient(), id, body.data.camera);
  if (!r.ok) return jsonError(r.status, r.message);
  return NextResponse.json({ ok: true });
}
