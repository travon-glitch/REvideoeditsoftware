import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { apiAuth, jsonError, readJson } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";
import { startBatch } from "@/lib/video/batch-store";

const schema = z.object({ listingId: z.string().uuid() });

/** "Generate 6 Videos": analyse the listing, build six storyboards and queue six renders. */
export async function POST(request: NextRequest) {
  const auth = await apiAuth(request, "videos.create");
  if (!auth.ok) return auth.response;
  let body;
  try { body = schema.safeParse(await readJson(request)); } catch { return jsonError(400, "The request could not be read."); }
  if (!body.success) return jsonError(400, "Choose a listing.");
  const r = await startBatch(await createClient(), auth.ctx, body.data.listingId);
  if (!r.ok) return jsonError(r.status, r.message);
  return NextResponse.json(r.value, { status: 201 });
}
