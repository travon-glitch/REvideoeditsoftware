/*
 * One AI camera job: photo → AI clip (depth on our server, or a generative
 * provider) → accuracy review → private storage → media asset.
 *
 * Security: the job only names an asset id. The worker loads that asset and
 * refuses unless it is a photo of the job's own company AND listing. The
 * photo is copied into a fresh temp folder; nothing else on disk is touched.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildMotionPrompt, getStudioMove, isManualZero, normalizeSpec, type CameraSpec, type StudioMoveId } from "@lvs/camera-presets";
import { makeDepthClip } from "./depth-clip.ts";
import { decodeCover, normalizeVideo, probeVideo } from "./media.ts";
import { reviewClip, type AccuracyReview } from "./accuracy.ts";
import type { GenerativeProvider } from "./providers/types.ts";
import { FIDELITY } from "./prompt.ts";

export const LOCAL_DEPTH_PROVIDER = "local-depth";
export const ASPECT_SIZE = { "16:9": [1920, 1080], "9:16": [1080, 1920], "1:1": [1080, 1080], "4:5": [1080, 1350] } as const;
type Aspect = keyof typeof ASPECT_SIZE;

export interface GenerationJob {
  id: string;
  organization_id: string;
  listing_id: string | null;
  source_asset_id: string | null;
  provider: string;
  model: string;
  input: unknown;
}

export interface SourceAsset { id: string; organization_id: string; listing_id: string | null; kind: string; bucket: string; storage_path: string; mime_type: string; file_name: string }

export interface ClipOutput { path: string; width: number; height: number; durationSeconds: number; sizeBytes: number }

export interface GenerationDeps {
  loadAsset(id: string): Promise<SourceAsset | null>;
  download(bucket: string, path: string): Promise<Uint8Array>;
  upload(bucket: string, path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  recordClip(job: GenerationJob, out: ClipOutput, review: AccuracyReview, label: string): Promise<string>;
  providerJob?(jobId: string, providerJobId: string): Promise<void>;
  progress?(jobId: string, p: number): Promise<void>;
  finish(jobId: string, outcome: { ok: true; assetId: string; review: AccuracyReview } | { ok: false; error: string }): Promise<void>;
  /** Generative providers that are configured on this worker, by id. */
  providers: Record<string, GenerativeProvider>;
}

export interface JobInput { spec: CameraSpec; duration: number; aspect: Aspect }

/** Validates the job's input (it came from the web app, but the worker checks again). */
export function parseJobInput(raw: unknown): JobInput {
  const r = raw as { spec?: CameraSpec; duration?: number; aspect?: string } | null;
  if (!r || typeof r !== "object" || !r.spec || !getStudioMove(String(r.spec.move))) throw new Error("This AI job has no valid camera move");
  const duration = Number(r.duration);
  if (!(duration >= 2 && duration <= 10)) throw new Error("AI clips are 2 to 10 seconds long");
  if (!(r.aspect! in ASPECT_SIZE)) throw new Error("Unknown video shape");
  return { spec: normalizeSpec(r.spec), duration, aspect: r.aspect as Aspect };
}

export function clipPathFor(job: GenerationJob): string {
  return `${job.organization_id}/listings/${job.listing_id}/${job.id}.mp4`;
}

/** Prompt for generative providers: the move in words + the guardrail that the property must not change. */
export function generativePrompt(move: StudioMoveId): string {
  const legacy: Partial<Record<StudioMoveId, string>> = {
    push_in: "push_in", dolly_in: "push_in", pull_out: "pull_out", dolly_out: "pull_out", truck_left: "pan_left", truck_right: "pan_right",
    orbit_left: "orbit", orbit_right: "orbit", arc_left: "orbit", arc_right: "orbit", crane_up: "crane_up", drone_reveal: "drone_reveal",
  };
  const id = legacy[move];
  const name = getStudioMove(move)?.name.toLowerCase() ?? move;
  const base = id ? buildMotionPrompt(id) : `real estate video, smooth ${name} camera movement, steady, natural light, true-to-life colors, ${FIDELITY}`;
  return base;
}

export async function processGenerationJob(job: GenerationJob, deps: GenerationDeps): Promise<{ ok: boolean; error?: string }> {
  const dir = mkdtempSync(join(tmpdir(), "lvs-ai-"));
  try {
    const input = parseJobInput(job.input);
    if (!job.source_asset_id || !job.listing_id) throw new Error("This AI job has no source photo");
    const asset = await deps.loadAsset(job.source_asset_id);
    if (!asset || asset.organization_id !== job.organization_id || asset.listing_id !== job.listing_id
        || asset.kind !== "photo" || asset.bucket !== "listing-media") {
      throw new Error("The source photo isn't part of this listing");
    }
    const ext = (asset.storage_path.split(".").pop() ?? "jpg").replace(/[^a-z0-9]/gi, "").slice(0, 5) || "jpg";
    const photo = join(dir, `source.${ext}`);
    const photoBytes = await deps.download(asset.bucket, asset.storage_path);
    // FFmpeg decides by content: only real JPEG, PNG or WebP photos are decoded
    if (!isRealPhoto(photoBytes)) throw new Error("This photo isn't a JPG, PNG or WebP image. Replace it and try again.");
    writeFileSync(photo, photoBytes);
    const [width, height] = ASPECT_SIZE[input.aspect];
    const out = join(dir, "clip.mp4");
    const move = getStudioMove(input.spec.move)!;
    let review: AccuracyReview;
    let label: string;

    if (job.provider === LOCAL_DEPTH_PROVIDER) {
      const r = await makeDepthClip({
        photo, spec: input.spec, duration: input.duration, width, height, out,
        onProgress: (p) => void deps.progress?.(job.id, p * 0.9),
      });
      review = r.review;
      label = `${input.spec.manual && !isManualZero(input.spec.manual) ? "Custom movement" : move.name} · AI depth`;
    } else {
      const provider = deps.providers[job.provider];
      if (!provider) throw new Error("This AI provider isn't set up on the server. Ask an administrator.");
      const res = await provider.imageToVideo({
        photo: readFileSync(photo), mimeType: asset.mime_type, fileName: asset.file_name, prompt: generativePrompt(move.id),
        durationSeconds: input.duration <= 5 ? 5 : 10, aspect: input.aspect,
        onProviderJob: (id) => deps.providerJob?.(job.id, id),
      });
      const raw = join(dir, "provider.mp4");
      writeFileSync(raw, res.video);
      normalizeVideo(raw, out, width, height, input.duration);
      const info = probeVideo(out);
      review = reviewClip({ method: "generative", clip: out, duration: info.durationSeconds, photo: decodeCover(photo, width, height) });
      label = `${move.name} · Generative AI (${res.model})`;
    }

    const info = probeVideo(out);
    const bytes = readFileSync(out);
    const path = clipPathFor(job);
    await deps.upload("ai-clips", path, bytes, "video/mp4");
    const assetId = await deps.recordClip(job, { path, width: info.width, height: info.height, durationSeconds: info.durationSeconds, sizeBytes: bytes.length }, review, label);
    await deps.finish(job.id, { ok: true, assetId, review });
    return { ok: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : "The AI clip couldn't be made";
    await deps.finish(job.id, { ok: false, error: error.slice(0, 500) }).catch(() => undefined);
    return { ok: false, error };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** JPEG, PNG or WebP by its first bytes (never by name or declared type). */
export function isRealPhoto(b: Uint8Array): boolean {
  if (b.length < 12) return false;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return true;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return true;
  const s = (i: number, t: string) => [...t].every((c, k) => b[i + k] === c.charCodeAt(0));
  return s(0, "RIFF") && s(8, "WEBP");
}
