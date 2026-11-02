"use client";
import { createClient } from "@/lib/supabase/client";
import { BUCKETS, checkMusicFile, projectMusicPath } from "@/lib/storage";

export interface UploadedMusic { id: string; url: string | null; file_name: string; duration_seconds: number | null }

function audioLength(file: File): Promise<number | null> {
  return new Promise((ok) => {
    const a = new Audio();
    const u = URL.createObjectURL(file);
    a.onloadedmetadata = () => { URL.revokeObjectURL(u); ok(Number.isFinite(a.duration) ? a.duration : null); };
    a.onerror = () => { URL.revokeObjectURL(u); ok(null); };
    a.src = u;
  });
}

/** Uploads a music file to the project's private folder and registers it. Throws an Error with a friendly message. */
export async function uploadProjectMusic(orgId: string, projectId: string, file: File): Promise<UploadedMusic> {
  const check = checkMusicFile(file);
  if (!check.ok) throw new Error(check.reason);
  const duration = await audioLength(file);
  const path = projectMusicPath(orgId, projectId, crypto.randomUUID(), file.type);
  const { error } = await createClient().storage.from(BUCKETS.projectMedia).upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new Error("The music couldn't be uploaded. Please try again.");
  const res = await fetch(`/api/projects/${projectId}/music`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, file_name: file.name, mime_type: file.type, size_bytes: file.size, duration_seconds: duration }),
  }).catch(() => null);
  const body = await res?.json().catch(() => ({}));
  if (!res?.ok) throw new Error(body?.error ?? "The music couldn't be added.");
  return body.music as UploadedMusic;
}
