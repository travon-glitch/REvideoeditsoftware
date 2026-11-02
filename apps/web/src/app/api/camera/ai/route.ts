import { NextResponse, type NextRequest } from "next/server";
import { apiAuth, jsonError, readJson } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";
import { startAiClip } from "@/lib/video/camera-store";
import { aiRequestSchema } from "../schemas";

/** AI ENHANCED method: queue an AI depth or generative clip for the AI worker. */
export async function POST(request: NextRequest) {
  const auth = await apiAuth(request, "videos.create");
  if (!auth.ok) return auth.response;
  let body;
  try { body = aiRequestSchema.safeParse(await readJson(request)); } catch { return jsonError(400, "The request could not be read."); }
  if (!body.success) return jsonError(400, "Some camera settings aren't valid.");
  const r = await startAiClip(await createClient(), auth.ctx, body.data);
  if (!r.ok) return jsonError(r.status, r.message);
  return NextResponse.json({ job: r.value }, { status: 201 });
}
