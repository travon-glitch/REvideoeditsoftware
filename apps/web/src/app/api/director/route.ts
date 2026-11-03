import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { apiAuth, jsonError, readJson } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";
import { DIRECTOR_STYLES } from "@/lib/director/schema";
import { createVideoAutomatically } from "@/lib/director/run";

export const maxDuration = 300;
const schema = z.object({ listingId: z.string().uuid(), style: z.enum(DIRECTOR_STYLES) });

/** "Create My Video Automatically": Claude analyses the photos and plans the storyboard; the real render is queued. */
export async function POST(request: NextRequest) {
  const auth = await apiAuth(request, "videos.create");
  if (!auth.ok) return auth.response;
  let body;
  try { body = schema.safeParse(await readJson(request)); } catch { return jsonError(400, "The request could not be read."); }
  if (!body.success) return jsonError(400, "Choose a listing and a style.");
  const r = await createVideoAutomatically(await createClient(), auth.ctx, body.data);
  if (!r.ok) return jsonError(r.status, r.message);
  return NextResponse.json(r.value, { status: 201 });
}
