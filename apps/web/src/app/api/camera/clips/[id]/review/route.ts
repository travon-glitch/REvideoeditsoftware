import { NextResponse, type NextRequest } from "next/server";
import { apiAuth, jsonError, readJson } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/storage";
import { reviewSchema } from "../../../schemas";

type Params = { params: Promise<{ id: string }> };

/** Approve an AI clip, or report a problem with it (e.g. a bent window frame). Audited. */
export async function POST(request: NextRequest, { params }: Params) {
  const auth = await apiAuth(request, "videos.create");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isUuid(id)) return jsonError(404, "Clip not found.");
  let body;
  try { body = reviewSchema.safeParse(await readJson(request)); } catch { return jsonError(400, "The request could not be read."); }
  if (!body.success) return jsonError(400, "Choose approve or report a problem.");
  const db = await createClient();
  const { data, error } = await db.rpc("review_ai_clip", { p_asset: id, p_decision: body.data.decision, p_note: body.data.note ?? null });
  if (error) return jsonError(403, "You can't review this clip.");
  return NextResponse.json({ decision: data });
}
