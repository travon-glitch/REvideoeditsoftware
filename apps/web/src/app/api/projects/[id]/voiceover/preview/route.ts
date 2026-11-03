import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiAuth, jsonError, readJson } from "@/lib/api";
import { isUuid } from "@/lib/storage";
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
  let body;
  try { body = schema.safeParse(await readJson(request)); } catch { return jsonError(400, "The request could not be read."); }
  if (!body.success) return jsonError(400, "Choose a voice.");
  const { wav, seconds } = previewVoice(body.data as { script: string; voice: Parameters<typeof previewVoice>[0]["voice"]; speed: number });
  return new Response(Buffer.from(wav), { headers: { "Content-Type": "audio/wav", "Cache-Control": "no-store", "X-Seconds": String(seconds) } });
}
