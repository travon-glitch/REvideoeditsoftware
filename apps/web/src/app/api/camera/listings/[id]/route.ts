import { NextResponse, type NextRequest } from "next/server";
import { apiAuth, jsonError } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/storage";
import { studioActivity } from "@/lib/video/camera-store";

type Params = { params: Promise<{ id: string }> };

/** AI jobs, AI clips and standard clip exports for a listing (RLS decides what's visible). */
export async function GET(request: NextRequest, { params }: Params) {
  const auth = await apiAuth(request, "videos.view");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isUuid(id)) return jsonError(404, "Listing not found.");
  const data = await studioActivity(await createClient(), auth.ctx, id);
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
