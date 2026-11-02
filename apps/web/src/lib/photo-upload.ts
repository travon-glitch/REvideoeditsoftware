"use client";
import { createClient } from "@/lib/supabase/client";
import { BUCKETS, listingPhotoPath, listingThumbPath } from "@/lib/storage";
import { makeThumbnail } from "@/lib/thumbnail";

export interface UploadedPhoto {
  path: string; thumb_path: string | null; file_name: string; mime_type: string; size_bytes: number;
  width: number | null; height: number | null;
}

async function imageSize(file: File): Promise<{ width: number | null; height: number | null }> {
  try {
    const bmp = await createImageBitmap(file);
    const size = { width: bmp.width, height: bmp.height };
    bmp.close();
    return size;
  } catch {
    return { width: null, height: null };
  }
}

/** Uploads one photo (and its thumbnail) straight to the listing's private folder. RLS checks the folder. */
export async function uploadListingPhoto(orgId: string, listingId: string, file: File): Promise<UploadedPhoto> {
  const supabase = createClient();
  const id = crypto.randomUUID();
  const path = listingPhotoPath(orgId, listingId, id, file.type);
  const { error } = await supabase.storage.from(BUCKETS.listingMedia).upload(path, file, { contentType: file.type, upsert: false, cacheControl: "3600" });
  if (error) throw new Error(file.name);
  let thumb_path: string | null = null;
  const thumb = await makeThumbnail(file);
  if (thumb) {
    const tp = listingThumbPath(orgId, listingId, id);
    const { error: te } = await supabase.storage.from(BUCKETS.listingMedia).upload(tp, thumb, { contentType: "image/jpeg", upsert: false, cacheControl: "3600" });
    if (!te) thumb_path = tp;
  }
  return { path, thumb_path, file_name: file.name, mime_type: file.type, size_bytes: file.size, ...(await imageSize(file)) };
}
