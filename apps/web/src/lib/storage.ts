/*
 * Storage layout. Every object lives under "<organization_id>/..." and the
 * storage RLS policies only allow access to the caller's own organization folder.
 */
export const BUCKETS = {
  listingMedia: "listing-media",
  brandAssets: "brand-assets",
  videoExports: "video-exports",
} as const;
export type BucketName = (typeof BUCKETS)[keyof typeof BUCKETS];

export const PHOTO_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"] as const;
export const LOGO_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const MAX_PHOTO_BYTES = 50 * 1024 * 1024;
export const MAX_LOGO_BYTES = 10 * 1024 * 1024;
export const MAX_PHOTOS_PER_UPLOAD = 30;

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function extensionForMime(mime: string): string | null {
  return EXT_BY_MIME[mime] ?? null;
}

export type FileCheck = { ok: true } | { ok: false; reason: string };

export function checkPhotoFile(file: { type: string; size: number }): FileCheck {
  if (!(PHOTO_MIME_TYPES as readonly string[]).includes(file.type)) {
    return { ok: false, reason: "Please use JPG, PNG, WebP or HEIC photos." };
  }
  if (file.size <= 0) return { ok: false, reason: "This file is empty." };
  if (file.size > MAX_PHOTO_BYTES) return { ok: false, reason: "Photos must be 50 MB or smaller." };
  return { ok: true };
}

export function checkLogoFile(file: { type: string; size: number }): FileCheck {
  if (!(LOGO_MIME_TYPES as readonly string[]).includes(file.type)) {
    return { ok: false, reason: "Please use a PNG, JPG or WebP logo." };
  }
  if (file.size <= 0) return { ok: false, reason: "This file is empty." };
  if (file.size > MAX_LOGO_BYTES) return { ok: false, reason: "Logos must be 10 MB or smaller." };
  return { ok: true };
}

/** "<org>/listings/<listing>/<random>.<ext>" — random names, never the user's file name. */
export function listingPhotoPath(orgId: string, listingId: string, objectId: string, mime: string): string {
  const ext = extensionForMime(mime);
  if (!isUuid(orgId) || !isUuid(listingId) || !isUuid(objectId) || !ext) {
    throw new Error("Invalid storage path parts");
  }
  return `${orgId}/listings/${listingId}/${objectId}.${ext}`;
}

export function brandLogoPath(orgId: string, objectId: string, mime: string): string {
  const ext = extensionForMime(mime);
  if (!isUuid(orgId) || !isUuid(objectId) || !ext) throw new Error("Invalid storage path parts");
  return `${orgId}/brand/${objectId}.${ext}`;
}

/** Server-side check for paths sent back by the browser after an upload. */
export function isListingPhotoPathFor(path: string, orgId: string, listingId: string): boolean {
  const m = /^([0-9a-f-]{36})\/listings\/([0-9a-f-]{36})\/([0-9a-f-]{36})\.(jpg|png|webp|heic|heif)$/i.exec(path);
  return !!m && m[1] === orgId && m[2] === listingId && isUuid(m[3]);
}

export function isBrandLogoPathFor(path: string, orgId: string): boolean {
  const m = /^([0-9a-f-]{36})\/brand\/([0-9a-f-]{36})\.(jpg|png|webp)$/i.exec(path);
  return !!m && m[1] === orgId && isUuid(m[2]);
}

/** Display-safe original file name (kept only as metadata). */
export function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const cleaned = base.replace(/[^\w.\- ()]+/g, "_").slice(0, 200).trim();
  return cleaned || "file";
}
