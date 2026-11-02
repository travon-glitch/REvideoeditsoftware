import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { BucketName } from "@/lib/storage";

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
