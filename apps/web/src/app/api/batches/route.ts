import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { apiAuth, jsonError, readJson } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";
import { ASPECTS } from "@/lib/video/plan";
import { startBatch } from "@/lib/video/batch-store";

const schema = z.object({
  listingId: z.string().uuid(),
  aspect: z.enum(ASPECTS).default("9:16"),
  planner: z.enum(["rules", "ai_director"]).default("rules"),
  confirmedCents: z.number().int().min(0).max(10_000_000).optional(),
});

/**
 * "Generate 6 Videos": six storyboards, six projects, six background renders.
 * The AI Director planner only runs when the expected cost was shown and confirmed.
 */
export async function POST(request: NextRequest) {
  const auth = await apiAuth(request, "videos.create");
  if (!auth.ok) return auth.response;
  let body;
  try { body = schema.safeParse(await readJson(request)); } catch { return jsonError(400, "The request could not be read."); }
  if (!body.success) return jsonError(400, "Choose a listing.");
  const r = await startBatch(await createClient(), auth.ctx, body.data);
  if (!r.ok) return jsonError(r.status, r.message);
  return NextResponse.json(r.value, { status: 201 });
}
