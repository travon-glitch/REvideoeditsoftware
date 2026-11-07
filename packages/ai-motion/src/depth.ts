/// <reference path="./onnxruntime.d.ts" />
/*
 * Depth estimation, run locally with ONNX Runtime. Nothing leaves the server.
 *  - Depth Anything V2 Small (Apache-2.0) — preferred: sharp edges at door frames,
 *    windows and furniture, so straight lines stay straight when the camera moves.
 *  - MiDaS v2.1 small (MIT) — the older, smaller model; used when V2 isn't installed.
 * `npm run fetch-model -w @lvs/ai-motion` downloads both (checksummed).
 *
 * Output: relative "nearness" per pixel, 0 = far … 1 = near (both predict
 * relative inverse depth; it is normalised with robust percentiles).
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Rgb } from "./media.ts";

export interface DepthModelSpec { id: "depth-anything-v2-small" | "midas-v21-small"; name: string; license: string; source: string; file: string; input: number }
export const DEPTH_MODELS: readonly DepthModelSpec[] = [
  { id: "depth-anything-v2-small", name: "Depth Anything V2 Small", license: "Apache-2.0", source: "https://github.com/DepthAnything/Depth-Anything-V2", file: "depth-anything-v2-small-518.onnx", input: 518 },
  { id: "midas-v21-small", name: "MiDaS v2.1 small", license: "MIT", source: "https://github.com/isl-org/MiDaS", file: "midas-v21-small-256.onnx", input: 256 },
];
const modelsDir = () => join(dirname(fileURLToPath(import.meta.url)), "..", "models");

/** The model in use: LVS_DEPTH_MODEL (a file path) if set, else the best one installed. */
export function activeDepthModel(): DepthModelSpec & { path: string } {
  const forced = process.env.LVS_DEPTH_MODEL;
  if (forced) {
    const spec = DEPTH_MODELS.find((m) => forced.endsWith(m.file)) ?? DEPTH_MODELS[1]!;
    return { ...spec, path: forced };
  }
  for (const m of DEPTH_MODELS) {
    const path = join(modelsDir(), m.file);
    if (existsSync(path)) return { ...m, path };
  }
  return { ...DEPTH_MODELS[0]!, path: join(modelsDir(), DEPTH_MODELS[0]!.file) };
}
/** @deprecated use activeDepthModel() — kept for callers that only read the name. */
export const DEPTH_MODEL = DEPTH_MODELS[1]!;

export interface DepthMap { width: number; height: number; data: Float32Array }

type Session = { inputNames: readonly string[]; outputNames: readonly string[]; run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array; dims: readonly number[] }>> };
let session: Promise<Session> | null = null;

export function depthModelPath(): string {
  return activeDepthModel().path;
}
export function depthModelAvailable(): boolean { return existsSync(depthModelPath()); }

async function getSession(): Promise<Session> {
  if (!session) {
    session = (async () => {
      const path = depthModelPath();
      if (!existsSync(path)) throw new Error("The depth model isn't installed. Run: npm run fetch-model -w @lvs/ai-motion");
      const ort = await import("onnxruntime-node");
      return (await ort.InferenceSession.create(path, { intraOpNumThreads: 2 })) as unknown as Session;
    })();
    session.catch(() => { session = null; });
  }
  return session;
}

/** Runs the network on an N×N RGB image (the model's input size) and returns the raw N×N prediction. */
async function predict(small: Rgb): Promise<Float32Array> {
  const N = activeDepthModel().input;
  if (small.width !== N || small.height !== N) throw new Error(`Depth input must be ${N}×${N}`);
  const mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
  const input = new Float32Array(3 * N * N);
  for (let i = 0; i < N * N; i++) {
    for (let c = 0; c < 3; c++) input[c * N * N + i] = (small.data[i * 3 + c]! / 255 - mean[c]!) / std[c]!;
  }
  const s = await getSession();
  const ort = await import("onnxruntime-node");
  const out = await s.run({ [s.inputNames[0]!]: new ort.Tensor("float32", input, [1, 3, N, N]) });
  return out[s.outputNames[0]!]!.data;
}

/** Bilinear upsample of an n×n map to width×height. */
function upsample(src: Float32Array, n: number, width: number, height: number): Float32Array {
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const fy = Math.min(n - 1, Math.max(0, ((y + 0.5) * n) / height - 0.5));
    const y0 = Math.floor(fy), y1 = Math.min(n - 1, y0 + 1), wy = fy - y0;
    for (let x = 0; x < width; x++) {
      const fx = Math.min(n - 1, Math.max(0, ((x + 0.5) * n) / width - 0.5));
      const x0 = Math.floor(fx), x1 = Math.min(n - 1, x0 + 1), wx = fx - x0;
      const a = src[y0 * n + x0]!, b = src[y0 * n + x1]!, c = src[y1 * n + x0]!, d = src[y1 * n + x1]!;
      out[y * width + x] = (a * (1 - wx) + b * wx) * (1 - wy) + (c * (1 - wx) + d * wx) * wy;
    }
  }
  return out;
}

function percentile(values: Float32Array, p: number): number {
  const step = Math.max(1, Math.floor(values.length / 20000));
  const sample: number[] = [];
  for (let i = 0; i < values.length; i += step) sample.push(values[i]!);
  sample.sort((a, b) => a - b);
  return sample[Math.min(sample.length - 1, Math.floor(p * sample.length))]!;
}

/**
 * Depth for a photo: `small` is the whole photo at the model's input size (N×N), the
 * map is returned at width×height and cover-cropped the same way as the frame
 * (`crop` = the visible part of the squashed image, in 0…1 units).
 */
export async function estimateDepth(small: Rgb, width: number, height: number, crop = { x: 0, y: 0, w: 1, h: 1 }): Promise<DepthMap> {
  const N = activeDepthModel().input;
  const raw = await predict(small);
  // crop the N×N map to the visible region, then upsample (keeping the model's detail)
  const cx0 = crop.x * N, cy0 = crop.y * N, cw = crop.w * N, ch = crop.h * N;
  const M = N;
  const cropped = new Float32Array(M * M);
  for (let y = 0; y < M; y++) {
    const sy = Math.min(N - 1, cy0 + (y / (M - 1)) * (ch - 1));
    const y0 = Math.floor(sy), y1 = Math.min(N - 1, y0 + 1), wy = sy - y0;
    for (let x = 0; x < M; x++) {
      const sx = Math.min(N - 1, cx0 + (x / (M - 1)) * (cw - 1));
      const x0 = Math.floor(sx), x1 = Math.min(N - 1, x0 + 1), wx = sx - x0;
      cropped[y * M + x] = (raw[y0 * N + x0]! * (1 - wx) + raw[y0 * N + x1]! * wx) * (1 - wy) + (raw[y1 * N + x0]! * (1 - wx) + raw[y1 * N + x1]! * wx) * wy;
    }
  }
  const full = upsample(cropped, M, width, height);
  const lo = percentile(full, 0.02), hi = percentile(full, 0.98);
  const span = Math.max(1e-6, hi - lo);
  for (let i = 0; i < full.length; i++) full[i] = Math.min(1, Math.max(0, (full[i]! - lo) / span));
  return { width, height, data: full };
}
