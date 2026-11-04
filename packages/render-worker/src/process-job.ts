/*
 * One render job, start to finish. Storage and database access are passed in
 * (`deps`) so the same logic runs against Supabase in production and against
 * local stand-ins in tests.
 */
import { expectedKinds, sniffMedia } from "./sniff.ts";
import { readFile } from "node:fs/promises";
import { checkRenderDocument, type AllowedAsset } from "./sanitize.ts";
import { renderDocument, type RenderResult } from "./render.ts";

export interface RenderJob {
  id: string;
  organization_id: string;
  project_id: string;
  aspect: string;
  document: Record<string, unknown>;
}

export interface ProjectInfo {
  id: string;
  organization_id: string;
  listing_id: string | null;
  title: string;
}

export interface AssetRow {
  id: string;
  organization_id: string;
  listing_id: string | null;
  project_id: string | null;
  kind: string;
  bucket: string;
  storage_path: string;
}

export interface JobDeps {
  loadProject(projectId: string): Promise<ProjectInfo | null>;
  loadAssets(ids: string[]): Promise<AssetRow[]>;
  download(bucket: string, path: string): Promise<Uint8Array>;
  upload(bucket: string, path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  recordOutput(input: {
    job: RenderJob; project: ProjectInfo; path: string; fileName: string; result: RenderResult;
  }): Promise<string>;
  progress(jobId: string, progress: number): Promise<void>;
  finish(jobId: string, outcome:
    | { ok: true; assetId: string; path: string; result: RenderResult }
    | { ok: false; error: string }): Promise<void>;
  chrome?: string;
  timeoutMs?: number;
}

const KIND_FOR_ASSET: Record<string, AllowedAsset["kind"]> = { photo: "image", audio: "audio", video: "video", ai_clip: "video", logo: "image", headshot: "image" };

/**
 * Only files of this project's company that belong to this project's listing
 * (photos, and AI camera clips made from them), to the project itself (music), the company's
 * music library, or the company's brand logo may be rendered.
 */
export function allowedAssetsFor(project: ProjectInfo, rows: AssetRow[]): AllowedAsset[] {
  return rows
    .filter((a) => a.organization_id === project.organization_id)
    .filter((a) =>
      (a.bucket === "listing-media" && a.kind === "photo" && !!project.listing_id && a.listing_id === project.listing_id)
      || (a.bucket === "ai-clips" && a.kind === "ai_clip" && !!project.listing_id && a.listing_id === project.listing_id)
      // the company's own music library and brand logo
      || (a.bucket === "music-library" && a.kind === "audio")
      || (a.bucket === "brand-assets" && (a.kind === "logo" || a.kind === "headshot"))
      || (a.bucket === "project-media" && a.kind === "audio" && a.project_id === project.id))
    .map((a) => ({ id: a.id, bucket: a.bucket, storagePath: a.storage_path, kind: KIND_FOR_ASSET[a.kind]! }));
}

export function outputPathFor(job: RenderJob): string {
  return `${job.organization_id}/projects/${job.project_id}/${job.id}.mp4`;
}

function niceFileName(title: string, aspect: string): string {
  const slug = title.normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "listing-video";
  return `${slug}-${aspect.replace(":", "x")}.mp4`;
}

export async function processJob(job: RenderJob, deps: JobDeps): Promise<{ ok: boolean; error?: string }> {
  let result: RenderResult | null = null;
  try {
    const project = await deps.loadProject(job.project_id);
    if (!project || project.organization_id !== job.organization_id) throw new Error("Project not found for this job");

    const media = Array.isArray(job.document.media) ? (job.document.media as { assetId?: unknown }[]) : [];
    const ids = [...new Set(media.map((m) => String(m.assetId ?? "")))].filter(Boolean);
    const allowed = allowedAssetsFor(project, await deps.loadAssets(ids));
    const files = checkRenderDocument(job.document, allowed);

    const bytes = new Map<string, Uint8Array>();
    for (const f of files) {
      const data = await deps.download(f.bucket, f.storagePath);
      // the renderer (Chrome + FFmpeg) decides by content, so every file must really be what its name says
      const kinds = expectedKinds(f.fileName);
      const kind = sniffMedia(data);
      if (!kinds || !kind || !kinds.includes(kind)) {
        throw new Error(/\.hei[cf]$/i.test(f.fileName)
          ? "A photo in this video is in Apple's HEIC format, which videos can't use. Replace it with a JPG."
          : "A file in this video isn't a real photo, video clip or audio file. Replace it and try again.");
      }
      bytes.set(f.fileName, data);
    }

    result = await renderDocument({
      document: job.document,
      files: bytes,
      chrome: deps.chrome,
      timeoutMs: deps.timeoutMs,
      onProgress: (p) => { void deps.progress(job.id, Math.min(0.97, p * 0.95)); },
    });

    const path = outputPathFor(job);
    await deps.upload("video-exports", path, new Uint8Array(await readFile(result.mp4Path)), "video/mp4");
    const assetId = await deps.recordOutput({ job, project, path, fileName: niceFileName(project.title, job.aspect), result });
    await deps.finish(job.id, { ok: true, assetId, path, result });
    return { ok: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await deps.finish(job.id, { ok: false, error: error.slice(0, 1000) });
    return { ok: false, error };
  } finally {
    await result?.cleanup();
  }
}
