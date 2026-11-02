import { NextResponse, type NextRequest } from "next/server";
import { apiAuth, jsonError } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/storage";
import { retryFailed } from "@/lib/video/batch-store";

type Params = { params: Promise<{ projectId: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const auth = await apiAuth(request, "videos.create");
  if (!auth.ok) return auth.response;
  const { projectId } = await params;
  if (!isUuid(projectId)) return jsonError(404, "Video not found.");
  const r = await retryFailed(await createClient(), auth.ctx, projectId);
  if (!r.ok) return jsonError(r.status, r.message);
  return NextResponse.json({ renders: r.value }, { status: 201 });
}
