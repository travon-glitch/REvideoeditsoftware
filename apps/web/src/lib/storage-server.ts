import "server-only";
import { createClient } from "@/lib/supabase/server";
import { BUCKETS, type BucketName } from "@/lib/storage";
import { cameraSpecSchema, type CameraSpec } from "@/lib/video/camera";

/** Short-lived signed URLs for private files (RLS decides what the caller may read). */
export async function signedUrlMap(bucket: BucketName, paths: string[], expiresIn = 3600): Promise<Record<string, string>> {
  const unique = [...new Set(paths.filter(Boolean))];
  if (unique.length === 0) return {};
  const supabase = await createClient();
  const { data } = await supabase.storage.from(bucket).createSignedUrls(unique, expiresIn);
  const out: Record<string, string> = {};
  for (const item of data ?? []) if (item.path && item.signedUrl) out[item.path] = item.signedUrl;
  return out;
}

export interface SignedPhoto { id: string; url: string | null; thumb: string | null; file_name: string; camera?: CameraSpec | null }

/** Listing photos with short-lived links to the full photo and its small thumbnail. */
export async function signListingPhotos(
  rows: { id: string; storage_path: string; thumbnail_path: string | null; file_name: string; camera_spec?: unknown }[], expiresIn = 4 * 3600,
): Promise<SignedPhoto[]> {
  const urls = await signedUrlMap(BUCKETS.listingMedia, rows.flatMap((p) => [p.storage_path, p.thumbnail_path ?? ""]), expiresIn);
  return rows.map((p) => ({
    id: p.id, url: urls[p.storage_path] ?? null, thumb: (p.thumbnail_path && urls[p.thumbnail_path]) || null, file_name: p.file_name,
    ...(p.camera_spec ? { camera: parseCamera(p.camera_spec) } : {}),
  }));
}

/** A saved camera move, or null if it is missing / no longer valid. */
export function parseCamera(value: unknown): CameraSpec | null {
  const r = cameraSpecSchema.safeParse(value);
  return r.success ? r.data : null;
}
