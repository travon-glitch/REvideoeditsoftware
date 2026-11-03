import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { apiAuth, jsonError, readJson } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/storage";
import { generateVoiceover, isVoice } from "@/lib/video/voice-store";

export const runtime = "nodejs";
export const maxDuration = 300;
type Params = { params: Promise<{ id: string }> };
const schema = z.object({
  script: z.string().trim().min(1).max(4000), voice: z.string().refine(isVoice), speed: z.number().min(0.7).max(1.3).default(1),
  start: z.number().min(0).max(600).default(0.5), volume: z.number().min(0).max(2).default(1),
});

/** Speak the script with the chosen voice and save it to the video (with word-timed captions). */
export async function POST(request: NextRequest, { params }: Params) {
  const auth = await apiAuth(request, "videos.create");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isUuid(id)) return jsonError(404, "Video not found.");
  let body;
  try { body = schema.safeParse(await readJson(request)); } catch { return jsonError(400, "The request could not be read."); }
  if (!body.success) return jsonError(400, "Check the script, voice and speed.");
  const d = body.data as z.infer<typeof schema> & { voice: Parameters<typeof generateVoiceover>[3]["voice"] };
  const r = await generateVoiceover(await createClient(), auth.ctx, id, d);
  if (!r.ok) return jsonError(r.status, r.message);
  return NextResponse.json(r.value, { status: 201 });
}
