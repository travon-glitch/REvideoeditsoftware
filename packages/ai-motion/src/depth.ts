/// <reference path="./onnxruntime.d.ts" />
/*
 * Depth estimation with MiDaS v2.1 small (Intel ISL, MIT licence), run locally
 * with ONNX Runtime. Nothing leaves the server.
 *
 * Output: relative "nearness" per pixel, 0 = far … 1 = near (MiDaS predicts
 * relative inverse depth; it is normalised with robust percentiles).
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Rgb } from "./media.ts";

export const DEPTH_MODEL = {
  name: "MiDaS v2.1 small",
  license: "MIT",
  source: "https://github.com/isl-org/MiDaS",
  file: "midas-v21-small-256.onnx",
  input: 256,
} as const;

export interface DepthMap { width: number; height: number; data: Float32Array }

type Session = { inputNames: readonly string[]; outputNames: readonly string[]; run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array; dims: readonly number[] }>> };
let session: Promise<Session> | null = null;

export function depthModelPath(): string {
  return process.env.LVS_DEPTH_MODEL ?? join(dirname(fileURLToPath(import.meta.url)), "..", "models", DEPTH_MODEL.file);
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

/** Runs the network on a 256×256 RGB image and returns the raw 256×256 prediction. */
async function predict(small: Rgb): Promise<Float32Array> {
  const N = DEPTH_MODEL.input;
  if (small.width !== N || small.height !== N) throw new Error("Depth input must be 256×256");
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
 * Depth for a photo: `small` is the whole photo at 256×256 (network input), the
 * map is returned at width×height and cover-cropped the same way as the frame
 * (`crop` = the visible part of the squashed image, in 0…1 units).
 */
export async function estimateDepth(small: Rgb, width: number, height: number, crop = { x: 0, y: 0, w: 1, h: 1 }): Promise<DepthMap> {
  const N = DEPTH_MODEL.input;
  const raw = await predict(small);
  // crop the 256 map to the visible region, then upsample
  const cx0 = crop.x * N, cy0 = crop.y * N, cw = crop.w * N, ch = crop.h * N;
  const M = 256;
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
