import { NextResponse, type NextRequest } from "next/server";
import { apiAuth, jsonError } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/storage";
import { batchStatus } from "@/lib/video/batch-store";

type Params = { params: Promise<{ id: string }> };

/** Batch dashboard data: each video's storyboard, render progress and thumbnail. */
export async function GET(request: NextRequest, { params }: Params) {
  const auth = await apiAuth(request, "videos.view");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isUuid(id)) return jsonError(404, "Batch not found.");
  const r = await batchStatus(await createClient(), id);
  if (!r.ok) return jsonError(r.status, r.message);
  return NextResponse.json(r.value, { headers: { "Cache-Control": "no-store" } });
}
