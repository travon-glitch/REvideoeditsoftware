import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { apiAuth, jsonError, readJson } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/storage";
import { NARRATION_TONES, checkNarration, draftNarration } from "@/lib/video/narration";

type Params = { params: Promise<{ id: string }> };
const schema = z.object({ tone: z.enum(NARRATION_TONES).default("warm"), check: z.string().max(4000).optional() });

/** A narration draft from the listing's verified details — or, with `check`, a fact check of an edited script. */
export async function POST(request: NextRequest, { params }: Params) {
  const auth = await apiAuth(request, "videos.create");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isUuid(id)) return jsonError(404, "Video not found.");
  let body;
  try { body = schema.safeParse(await readJson(request)); } catch { return jsonError(400, "The request could not be read."); }
  if (!body.success) return jsonError(400, "Choose a tone.");
  const db = await createClient();
  const { data: project } = await db.from("video_projects").select("listing_id").eq("id", id).maybeSingle();
  if (!project?.listing_id) return jsonError(400, "This video isn't linked to a listing, so there are no verified details to narrate.");
  const { data: listing } = await db.from("listings").select("*").eq("id", project.listing_id).maybeSingle();
  if (!listing) return jsonError(404, "Listing not found.");
  let agent: { name: string; brokerage: string | null } | null = null;
  if (listing.agent_profile_id) {
    const { data } = await db.from("agent_profiles").select("name,brokerage").eq("id", listing.agent_profile_id).maybeSingle();
    agent = data ?? null;
  }
  if (body.data.check != null) return NextResponse.json({ warnings: checkNarration(body.data.check, listing) });
  const script = draftNarration(listing, { tone: body.data.tone, agent });
  return NextResponse.json({ script, warnings: checkNarration(script, listing) });
}
