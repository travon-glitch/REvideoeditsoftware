/*
 * Checks a FableCut document before it is rendered. Only files that the job is
 * allowed to use may be referenced, every media path must be a plain
 * "/media/<uuid>.<ext>" name inside the job folder, and nothing may point at
 * other server files (no "..", no absolute paths, no URLs, no library files).
 */
export interface AllowedAsset {
  id: string;
  bucket: string;
  storagePath: string;
  kind: "image" | "audio" | "video";
}

export interface RenderFile {
  assetId: string;
  bucket: string;
  storagePath: string;
  fileName: string;
}

const SAFE_FILE = /^[0-9a-f-]{36}\.(jpg|jpeg|png|webp|heic|heif|mp3|m4a|aac|wav|mp4)$/i;
const KIND_OF: Record<string, AllowedAsset["kind"]> = { image: "image", audio: "audio", video: "video" };
/** "shape" = vector shape layers (drawn by FableCut, no files). */
const ALLOWED_CLIP_KINDS = new Set(["image", "audio", "video", "text", "shape"]);
const NO_MEDIA_KINDS = new Set(["text", "shape"]);

export class RenderDocumentError extends Error {}

export function fileNameOf(storagePath: string): string {
  const base = storagePath.split("/").pop() ?? "";
  if (!SAFE_FILE.test(base)) throw new RenderDocumentError(`Unsafe media file name: ${base}`);
  return base;
}

/** Returns the files to place in the job's media folder, or throws. */
export function checkRenderDocument(doc: unknown, allowed: AllowedAsset[]): RenderFile[] {
  if (!doc || typeof doc !== "object") throw new RenderDocumentError("Document is not an object");
  const d = doc as { width?: unknown; height?: unknown; fps?: unknown; media?: unknown; clips?: unknown; comps?: unknown; sequences?: unknown };
  const dims = [d.width, d.height];
  if (!dims.every((n) => typeof n === "number" && Number.isInteger(n) && n >= 16 && n <= 4096 && n % 2 === 0)) {
    throw new RenderDocumentError("Canvas size must be even whole numbers up to 4096");
  }
  if (typeof d.fps !== "number" || d.fps < 1 || d.fps > 60) throw new RenderDocumentError("Frame rate must be 1–60");
  if (d.comps != null || d.sequences != null) throw new RenderDocumentError("Nested compositions and extra sequences are not rendered by the worker");
  if (!Array.isArray(d.media) || !Array.isArray(d.clips)) throw new RenderDocumentError("Document needs media and clips lists");
  if (d.media.length > 64 || d.clips.length > 400) throw new RenderDocumentError("Document is too large");

  const byId = new Map(allowed.map((a) => [a.id, a]));
  const files: RenderFile[] = [];
  const mediaIds = new Set<string>();
  for (const m of d.media as Record<string, unknown>[]) {
    const assetId = String(m.assetId ?? "");
    const asset = byId.get(assetId);
    if (!asset) throw new RenderDocumentError(`Media ${String(m.id)} is not an allowed file for this project`);
    const fileName = fileNameOf(asset.storagePath);
    if (m.src !== `/media/${fileName}`) throw new RenderDocumentError(`Media ${String(m.id)} has an unexpected path`);
    if (KIND_OF[String(m.kind)] !== asset.kind) throw new RenderDocumentError(`Media ${String(m.id)} has the wrong type`);
    mediaIds.add(String(m.id));
    if (!files.some((f) => f.assetId === assetId)) files.push({ assetId, bucket: asset.bucket, storagePath: asset.storagePath, fileName });
  }
  let end = 0;
  for (const c of d.clips as Record<string, unknown>[]) {
    if (!ALLOWED_CLIP_KINDS.has(String(c.kind))) throw new RenderDocumentError(`Clip kind ${String(c.kind)} is not rendered by the worker`);
    if (NO_MEDIA_KINDS.has(String(c.kind))) {
      if (c.mediaId != null) throw new RenderDocumentError(`Clip ${String(c.id)} can't use media`);
    } else if (!mediaIds.has(String(c.mediaId))) throw new RenderDocumentError(`Clip ${String(c.id)} uses unknown media`);
    const start = Number(c.start), duration = Number(c.duration);
    if (!(start >= 0) || !(duration > 0)) throw new RenderDocumentError(`Clip ${String(c.id)} has a bad time`);
    end = Math.max(end, start + duration);
  }
  if (end <= 0 || end > 600) throw new RenderDocumentError("Videos must be between 0 and 10 minutes long");
  return files;
}
