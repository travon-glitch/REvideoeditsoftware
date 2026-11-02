import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { apiAuth, jsonError, readJson } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";
import { saveToLibrary } from "@/lib/video/batch-store";

const schema = z.object({ renderIds: z.array(z.string().uuid()).min(1).max(24) });

/** Save finished videos to the company library. */
export async function POST(request: NextRequest) {
  const auth = await apiAuth(request, "videos.create");
  if (!auth.ok) return auth.response;
  let body;
  try { body = schema.safeParse(await readJson(request)); } catch { return jsonError(400, "The request could not be read."); }
  if (!body.success) return jsonError(400, "Choose at least one finished video.");
  const r = await saveToLibrary(await createClient(), auth.ctx, body.data.renderIds);
  if (!r.ok) return jsonError(r.status, r.message);
  return NextResponse.json(r.value);
}
