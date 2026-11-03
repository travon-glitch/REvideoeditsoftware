import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { apiAuth, jsonError, readJson } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";
import { BUCKETS, MAX_MUSIC_BYTES, MUSIC_MIME_TYPES, cleanFileName, isProjectMusicPathFor, isUuid } from "@/lib/storage";

type Params = { params: Promise<{ id: string }> };

const schema = z.object({
  path: z.string().max(300),
  file_name: z.string().max(260),
  mime_type: z.enum(MUSIC_MIME_TYPES),
  size_bytes: z.number().int().positive().max(MAX_MUSIC_BYTES),
  duration_seconds: z.number().positive().max(3600).nullable(),
  /** The person confirms they are authorised to use this music in advertising (Stage 12). */
  authorized: z.literal(true, { errorMap: () => ({ message: "Confirm that you're authorised to use this music." }) }),
  /** Narration you recorded yourself (shown in the voice track, not offered as music). */
  purpose: z.enum(["music", "narration"]).default("music"),
});

/** Registers a music file the browser uploaded to the project's private folder. */
export async function POST(request: NextRequest, { params }: Params) {
  const auth = await apiAuth(request, "videos.create");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isUuid(id)) return jsonError(404, "Video not found.");
  let body;
  try { body = schema.safeParse(await readJson(request)); } catch { return jsonError(400, "The upload details could not be read."); }
  if (!body.success) return jsonError(400, body.error.issues.some((i) => i.path[0] === "authorized") ? "Confirm that you're authorised to use this audio." : "That file isn't a supported audio file.");
  const f = body.data;
  const orgId = auth.ctx.organization.id;
  if (!isProjectMusicPathFor(f.path, orgId, id)) return jsonError(400, "Upload location was not valid.");

  const db = await createClient();
  const folder = `${orgId}/projects/${id}`;
  const { data: objects } = await db.storage.from(BUCKETS.projectMedia).list(folder, { limit: 1000 });
  if (!(objects ?? []).some((o) => `${folder}/${o.name}` === f.path)) return jsonError(400, "The music didn't finish uploading.");

  const { data, error } = await db.from("media_assets").insert({
    organization_id: orgId, project_id: id, uploaded_by: auth.ctx.userId, kind: "audio", bucket: BUCKETS.projectMedia,
    storage_path: f.path, file_name: cleanFileName(f.file_name), mime_type: f.mime_type, size_bytes: f.size_bytes,
    duration_seconds: f.duration_seconds,
  }).select("id,storage_path,file_name,duration_seconds").single();
  if (error || !data) {
    await db.storage.from(BUCKETS.projectMedia).remove([f.path]);
    return jsonError(403, "You can't add music to this video.");
  }
  await db.rpc("record_audio_authorization", { p_asset: data.id, p_purpose: f.purpose });
  const { data: link } = await db.storage.from(BUCKETS.projectMedia).createSignedUrl(f.path, 3600);
  return NextResponse.json({ music: { ...data, url: link?.signedUrl ?? null } }, { status: 201 });
}
