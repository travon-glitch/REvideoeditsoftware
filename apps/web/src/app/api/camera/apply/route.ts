import { NextResponse, type NextRequest } from "next/server";
import { apiAuth, jsonError, readJson } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";
import { applyToScene } from "@/lib/video/camera-store";
import { applySchema } from "../schemas";

/** Puts a camera move or an AI clip on one scene of a video (same save path as the editor). */
export async function POST(request: NextRequest) {
  const auth = await apiAuth(request, "videos.create");
  if (!auth.ok) return auth.response;
  let body;
  try { body = applySchema.safeParse(await readJson(request)); } catch { return jsonError(400, "The request could not be read."); }
  if (!body.success) return jsonError(400, "Some camera settings aren't valid.");
  const r = await applyToScene(await createClient(), auth.ctx, body.data);
  if (!r.ok) return jsonError(r.status, r.message);
  return NextResponse.json(r.value);
}
