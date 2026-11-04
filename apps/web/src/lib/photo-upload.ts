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

/** Longest side kept for uploaded photos: videos are at most 1920 px wide, so this leaves room for 2× camera zoom. */
export const MAX_PHOTO_SIDE = 4096;

/**
 * Very large photos (phone cameras are 12–48 megapixels) are scaled down to MAX_PHOTO_SIDE in the browser
 * before upload: faster uploads, less storage, faster renders, no visible difference in a 1080p video.
 * The photo's orientation is applied. Anything that can't be read is uploaded unchanged.
 */
export async function prepareListingPhoto(file: File): Promise<File> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const longest = Math.max(bmp.width, bmp.height);
    if (longest <= MAX_PHOTO_SIDE) { bmp.close(); return file; }
    const scale = MAX_PHOTO_SIDE / longest;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", 0.92));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.[a-z0-9]+$/i, "") + ".jpg", { type: "image/jpeg", lastModified: file.lastModified });
  } catch {
    return file;
  }
}

/** Uploads one photo (and its thumbnail) straight to the listing's private folder. RLS checks the folder. */
export async function uploadListingPhoto(orgId: string, listingId: string, original: File): Promise<UploadedPhoto> {
  const file = await prepareListingPhoto(original);
  const supabase = createClient();
  const id = crypto.randomUUID();
  const path = listingPhotoPath(orgId, listingId, id, file.type);
  const { error } = await supabase.storage.from(BUCKETS.listingMedia).upload(path, file, { contentType: file.type, upsert: false, cacheControl: "3600" });
  if (error) throw new Error(file.name);
  let thumb_path: string | null = null;
  // 960 px: sharp in photo grids and good enough for the editor preview on phones
  const thumb = await makeThumbnail(file, 960);
  if (thumb) {
    const tp = listingThumbPath(orgId, listingId, id);
    const { error: te } = await supabase.storage.from(BUCKETS.listingMedia).upload(tp, thumb, { contentType: "image/jpeg", upsert: false, cacheControl: "3600" });
    if (!te) thumb_path = tp;
  }
  return { path, thumb_path, file_name: file.name, mime_type: file.type, size_bytes: file.size, ...(await imageSize(file)) };
}
