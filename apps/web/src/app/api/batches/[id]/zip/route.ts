import type { NextRequest } from "next/server";
import { apiAuth, jsonError } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";
import { BUCKETS, isUuid } from "@/lib/storage";
import { batchStatus } from "@/lib/video/batch-store";
import { zipName, zipStream, type ZipEntry } from "@/lib/zip";

type Params = { params: Promise<{ id: string }> };
export const maxDuration = 300;

/**
 * Download all finished videos of a batch as one ZIP. Each file is read as the
 * signed-in person (Storage checks project access and their download permission)
 * and streamed into the ZIP one at a time.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const auth = await apiAuth(request, "videos.view");
  if (!auth.ok) return auth.response;
  if (!auth.ctx.profile.can_download) return jsonError(403, "Downloads are turned off for your account.");
  const { id } = await params;
  if (!isUuid(id)) return jsonError(404, "Batch not found.");
  const db = await createClient();
  const status = await batchStatus(db, id);
  if (!status.ok) return jsonError(status.status, status.message);
  const done = status.value.videos.filter((v) => v.render?.status === "succeeded");
  if (done.length === 0) return jsonError(409, "No videos are finished yet.");
  const { data: renders } = await db.from("render_jobs").select("id,output_path").in("id", done.map((v) => v.render!.id));
  const pathOf = new Map((renders ?? []).map((r) => [r.id, r.output_path]));

  const used = new Set<string>();
  async function* files(): AsyncGenerator<ZipEntry> {
    for (const v of done) {
      const path = pathOf.get(v.render!.id);
      if (!path) continue;
      const { data, error } = await db.storage.from(BUCKETS.videoExports).download(path);
      if (error || !data) continue;
      yield { name: zipName(`${v.title}-${v.aspect.replace(":", "x")}`, "mp4", used), data: new Uint8Array(await data.arrayBuffer()) };
    }
  }
  const name = zipName(`${status.value.batch.address || "listing"}-videos`, "zip", new Set());
  return new Response(zipStream(files()), {
    headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" },
  });
}
