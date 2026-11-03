import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { apiAuth, jsonError, readJson } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/storage";
import { transcribeProjectAudio } from "@/lib/video/voice-store";

export const runtime = "nodejs";
export const maxDuration = 300;
type Params = { params: Promise<{ id: string }> };
const schema = z.object({ assetId: z.string().uuid(), script: z.string().max(4000).optional() });

/** Automatic transcription of a project audio file → timed caption lines. */
export async function POST(request: NextRequest, { params }: Params) {
  const auth = await apiAuth(request, "videos.create");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isUuid(id)) return jsonError(404, "Video not found.");
  let body;
  try { body = schema.safeParse(await readJson(request)); } catch { return jsonError(400, "The request could not be read."); }
  if (!body.success) return jsonError(400, "Choose the audio to transcribe.");
  const r = await transcribeProjectAudio(await createClient(), id, body.data.assetId, body.data.script);
  if (!r.ok) return jsonError(r.status, r.message);
  return NextResponse.json(r.value);
}
