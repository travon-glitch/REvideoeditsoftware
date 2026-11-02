import { NextResponse, type NextRequest } from "next/server";
import { apiAuth, jsonError, readJson } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";
import { exportClip } from "@/lib/video/camera-store";
import { clipRequestSchema } from "../schemas";

/** STANDARD method: render one photo with one camera move to a 1080p MP4 (FableCut, background worker). */
export async function POST(request: NextRequest) {
  const auth = await apiAuth(request, "videos.create");
  if (!auth.ok) return auth.response;
  let body;
  try { body = clipRequestSchema.safeParse(await readJson(request)); } catch { return jsonError(400, "The request could not be read."); }
  if (!body.success) return jsonError(400, "Some camera settings aren't valid.");
  const r = await exportClip(await createClient(), auth.ctx, body.data);
  if (!r.ok) return jsonError(r.status, r.message);
  return NextResponse.json({ renders: r.value }, { status: 201 });
}
