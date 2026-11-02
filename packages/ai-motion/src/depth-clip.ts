/* One call: photo file + camera spec → MP4 clip made with the AI depth method, plus its accuracy review. */
import { statSync } from "node:fs";
import { normalizeSpec, type CameraSpec } from "@lvs/camera-presets";
import { DEPTH_MODEL, estimateDepth } from "./depth.ts";
import { DepthScene, OVERSCAN, fitGuard, renderDepthClip } from "./depth-render.ts";
import { Mp4Writer, decodeCover, decodeStretch, imageSize, probeVideo, type Rgb } from "./media.ts";
import { reviewClip, type AccuracyReview } from "./accuracy.ts";

export interface ClipResult {
  file: string;
  width: number;
  height: number;
  durationSeconds: number;
  sizeBytes: number;
  review: AccuracyReview;
  model: string;
}

const even = (n: number) => Math.round(n / 2) * 2;

/** The visible part of the photo when cover-fitted to w×h (fractions of the photo). */
function coverCrop(photo: { width: number; height: number }, w: number, h: number) {
  const f = Math.max(w / photo.width, h / photo.height);
  const cw = w / (photo.width * f), ch = h / (photo.height * f);
  return { x: (1 - cw) / 2, y: (1 - ch) / 2, w: cw, h: ch };
}

/** Centre crop of an RGB image (the photo as the clip's first frame should show it). */
function centreCrop(img: Rgb, w: number, h: number): Rgb {
  const x0 = Math.floor((img.width - w) / 2), y0 = Math.floor((img.height - h) / 2);
  const out = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) out.set(img.data.subarray(((y + y0) * img.width + x0) * 3, ((y + y0) * img.width + x0 + w) * 3), y * w * 3);
  return { width: w, height: h, data: out };
}

export async function makeDepthClip(input: {
  photo: string;
  spec: CameraSpec;
  duration: number;
  width: number;
  height: number;
  out: string;
  onProgress?: (p: number) => void;
}): Promise<ClipResult> {
  const spec = normalizeSpec(input.spec);
  const sw = even(input.width * OVERSCAN), sh = even(input.height * OVERSCAN);
  const source = decodeCover(input.photo, sw, sh);
  const size = imageSize(input.photo);
  const depth = await estimateDepth(decodeStretch(input.photo, DEPTH_MODEL.input, DEPTH_MODEL.input), sw, sh, coverCrop(size, sw, sh));
  const scene = new DepthScene(source, depth, { width: input.width, height: input.height }, spec);
  fitGuard(scene, spec, spec.speed);
  const writer = new Mp4Writer(input.out, input.width, input.height, 30);
  let stats;
  try {
    stats = await renderDepthClip(scene, { spec, duration: input.duration, width: input.width, height: input.height },
      (frame) => writer.write(frame), (p) => input.onProgress?.(p * 0.95));
    await writer.close();
  } catch (e) {
    writer.kill();
    throw e;
  }
  const info = probeVideo(input.out);
  const review = reviewClip({
    method: "depth", clip: input.out, duration: info.durationSeconds, photo: centreCrop(source, input.width, input.height),
    stretchedShare: stats.maxStretched, uncoveredShare: stats.maxUncovered,
  });
  input.onProgress?.(1);
  return {
    file: input.out, width: info.width, height: info.height, durationSeconds: info.durationSeconds,
    sizeBytes: statSync(input.out).size, review, model: `${DEPTH_MODEL.name} (${DEPTH_MODEL.license})`,
  };
}
