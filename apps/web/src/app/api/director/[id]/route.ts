import { NextResponse, type NextRequest } from "next/server";
import { apiAuth, jsonError } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/storage";
import { directorRunView } from "@/lib/director/run";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const auth = await apiAuth(request, "videos.view");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isUuid(id)) return jsonError(404, "Not found.");
  const view = await directorRunView(await createClient(), id);
  if (!view) return jsonError(404, "Not found.");
  return NextResponse.json({ status: view.run.status, render: view.render }, { headers: { "Cache-Control": "no-store" } });
}
