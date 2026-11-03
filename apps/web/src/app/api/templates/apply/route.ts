import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { apiAuth, jsonError, readJson } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";
import { ASPECTS } from "@/lib/video/plan";
import { applyTemplate } from "@/lib/video/template-store";

const schema = z.object({
  listingId: z.string().uuid(),
  templateId: z.string().uuid(),
  aspect: z.enum(ASPECTS).optional(),
  render: z.boolean().default(true),
});

/** Apply a template to a listing: the listing's facts, photos, brand kit and agent fill it in; the render starts. */
export async function POST(request: NextRequest) {
  const auth = await apiAuth(request, "videos.create");
  if (!auth.ok) return auth.response;
  let body;
  try { body = schema.safeParse(await readJson(request)); } catch { return jsonError(400, "The request could not be read."); }
  if (!body.success) return jsonError(400, "Choose a listing and a template.");
  const r = await applyTemplate(await createClient(), auth.ctx, body.data);
  if (!r.ok) return jsonError(r.status, r.message);
  return NextResponse.json(r.value, { status: 201 });
}
