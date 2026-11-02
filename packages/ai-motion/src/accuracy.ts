/*
 * Property accuracy review for AI clips.
 *
 * Two automatic checks plus a person's eye:
 *  1. Depth clips: share of the picture that is stretched where the depth jumps
 *     (hidden surfaces a single photo can't show).
 *  2. Any clip: how closely the first frame matches the original photo (a
 *     structural similarity score on a small greyscale version), and how far
 *     the picture drifts from the photo's structure over the clip.
 * The original photo is always kept and shown next to the clip for comparison.
 */
import { frameAt } from "./media.ts";
import type { Rgb } from "./media.ts";

export type FlagCode = "stretched_edges" | "first_frame_differs" | "structure_changed" | "edge_fill";
export interface AccuracyFlag { code: FlagCode; message: string }
export interface AccuracyReview {
  method: "depth" | "generative";
  /** 0…1, higher = closer to the original photo. */
  firstFrameSimilarity: number;
  /** Lowest similarity of sampled frames to the photo (after the expected camera motion it will drop; used for generative clips). */
  minSimilarity: number;
  stretchedShare?: number;
  flags: AccuracyFlag[];
  checkedAt: string;
}

const W = 96, H = 54;

function gray(rgb: Uint8Array, n: number): Float32Array {
  const g = new Float32Array(n);
  for (let i = 0; i < n; i++) g[i] = 0.299 * rgb[i * 3]! + 0.587 * rgb[i * 3 + 1]! + 0.114 * rgb[i * 3 + 2]!;
  return g;
}

/** Global SSIM on two small greyscale images (0…1). */
export function ssim(a: Float32Array, b: Float32Array): number {
  const n = a.length;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]!; mb += b[i]!; }
  ma /= n; mb /= n;
  let va = 0, vb = 0, cov = 0;
  for (let i = 0; i < n; i++) { const da = a[i]! - ma, db = b[i]! - mb; va += da * da; vb += db * db; cov += da * db; }
  va /= n - 1; vb /= n - 1; cov /= n - 1;
  const c1 = (0.01 * 255) ** 2, c2 = (0.03 * 255) ** 2;
  return Math.max(0, ((2 * ma * mb + c1) * (2 * cov + c2)) / ((ma * ma + mb * mb + c1) * (va + vb + c2)));
}

/** Downscale an RGB image (box filter) to W×H grey. */
export function smallGray(img: Rgb): Float32Array {
  const out = new Float32Array(W * H);
  const sx = img.width / W, sy = img.height / H;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0, c = 0;
    for (let yy = Math.floor(y * sy); yy < Math.floor((y + 1) * sy); yy++) for (let xx = Math.floor(x * sx); xx < Math.floor((x + 1) * sx); xx++) {
      const i = (yy * img.width + xx) * 3; s += 0.299 * img.data[i]! + 0.587 * img.data[i + 1]! + 0.114 * img.data[i + 2]!; c++;
    }
    out[y * W + x] = c ? s / c : 0;
  }
  return out;
}

/**
 * Reviews a finished clip against the original photo (`photo` is the photo
 * prepared exactly like the clip's first frame should look).
 */
export function reviewClip(input: {
  method: "depth" | "generative";
  clip: string;
  duration: number;
  photo: Rgb;
  stretchedShare?: number;
  uncoveredShare?: number;
}): AccuracyReview {
  const ref = smallGray(input.photo);
  const at = (t: number) => gray(frameAt(input.clip, t, W, H), W * H);
  const first = ssim(ref, at(0.05));
  const sims = [0.25, 0.5, 0.75, 0.97].map((f) => ssim(ref, at(input.duration * f)));
  const minSimilarity = Math.min(first, ...sims);
  const flags: AccuracyFlag[] = [];
  if (input.stretchedShare != null && input.stretchedShare > 0.04) {
    flags.push({ code: "stretched_edges", message: `About ${Math.round(input.stretchedShare * 100)}% of the picture is stretched where near and far objects meet (e.g. trees, railings, door frames). Compare with the original before using.` });
  }
  if (input.uncoveredShare != null && input.uncoveredShare > 0.005) {
    flags.push({ code: "edge_fill", message: "The camera moved past the edge of the photo; some edge pixels were filled in." });
  }
  // Depth clips are made from the photo pixel-for-pixel (sideways moves start off-centre on purpose),
  // so only generative clips are judged on their first frame.
  if (input.method === "generative" && first < 0.6) {
    flags.push({ code: "first_frame_differs", message: "The first frame doesn't match the original photo closely. The AI may have changed the property." });
  }
  // generative models may change the scene over time; a big drop is worth a look
  if (input.method === "generative" && minSimilarity < 0.25) {
    flags.push({ code: "structure_changed", message: "Later frames differ a lot from the photo. Check walls, windows, roof lines and landscaping for AI changes." });
  }
  return {
    method: input.method, firstFrameSimilarity: round(first), minSimilarity: round(minSimilarity),
    ...(input.stretchedShare != null ? { stretchedShare: round(input.stretchedShare) } : {}),
    flags, checkedAt: new Date().toISOString(),
  };
}

const round = (n: number) => Math.round(n * 1000) / 1000;
