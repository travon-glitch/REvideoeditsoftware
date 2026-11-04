import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiAuth, jsonError, readJson } from "@/lib/api";
import { isUuid } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import { allow } from "@/lib/rate-limit";
import { voiceModelsAvailable } from "@lvs/voice";
import { isVoice, previewVoice } from "@/lib/video/voice-store";

export const runtime = "nodejs";
export const maxDuration = 120;
type Params = { params: Promise<{ id: string }> };
const schema = z.object({ script: z.string().trim().max(4000).default(""), voice: z.string().refine(isVoice), speed: z.number().min(0.7).max(1.3).default(1) });

/** A short spoken sample (WAV) of the first sentences with this voice and speed; nothing is stored. */
export async function POST(request: NextRequest, { params }: Params) {
  const auth = await apiAuth(request, "videos.create");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isUuid(id)) return jsonError(404, "Video not found.");
  if (!voiceModelsAvailable().tts) return jsonError(503, "The voice engine isn't installed on this server yet.");
  // same rules as making the narration: the company's switch, the person's AI access, edit access to this video
  const db = await createClient();
  const [{ data: features }, { data: access }] = await Promise.all([db.rpc("my_ai_features"), db.rpc("project_access", { p_project: id })]);
  const f = (features ?? {}) as { can_use_ai?: boolean; voiceover?: boolean };
  if (!f.voiceover) return jsonError(403, "AI narration is switched off for your company. An administrator can turn it on.");
  if (!f.can_use_ai) return jsonError(403, "AI isn't switched on for your account. Ask an administrator.");
  if (access !== "edit") return jsonError(403, "You can't change this video.");
  if (!allow(`voice-preview:${auth.ctx.userId}`, 20, 60_000)) return jsonError(429, "Too many previews in a row. Wait a minute and try again.");
  let body;
  try { body = schema.safeParse(await readJson(request)); } catch { return jsonError(400, "The request could not be read."); }
  if (!body.success) return jsonError(400, "Choose a voice.");
  const { wav, seconds } = previewVoice(body.data as { script: string; voice: Parameters<typeof previewVoice>[0]["voice"]; speed: number });
  return new Response(Buffer.from(wav), { headers: { "Content-Type": "audio/wav", "Cache-Control": "no-store", "X-Seconds": String(seconds) } });
}
