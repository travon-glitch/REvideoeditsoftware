import { NextResponse, type NextRequest } from "next/server";
import { apiAuth, jsonError, readJson } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";
import { interpretCameraPrompt } from "@/lib/camera/ai-camera-store";
import { interpretSchema } from "../schemas";

/** AI Camera Control: "describe your camera movement" → validated camera settings (nothing is saved). */
export async function POST(request: NextRequest) {
  const auth = await apiAuth(request, "videos.create");
  if (!auth.ok) return auth.response;
  let body;
  try { body = interpretSchema.safeParse(await readJson(request)); } catch { return jsonError(400, "The request could not be read."); }
  if (!body.success) return jsonError(400, "Please describe the movement in up to 1,000 characters.");
  const r = await interpretCameraPrompt(await createClient(), auth.ctx, body.data);
  if (!r.ok) return jsonError(r.status, r.message);
  return NextResponse.json(r.value);
}
