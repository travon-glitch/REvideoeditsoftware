/*
 * MOVE CAMERA FRAMING — preview = export, for Show Entire Photo, Fill Screen and the backgrounds.
 *
 * A 16:9 exterior photo (a 16:9 crop of OpenCV's "building.jpg", Apache-2.0) goes into a 9:16
 * and a 16:9 video. For each case:
 *   1. the one-scene clip goes through the real render worker (FableCut → headless Chrome →
 *      FFmpeg) to an MP4;
 *   2. the browser preview is the app's own <PhotoLayer> component (the one Camera Studio and the
 *      video editor draw with), rendered in Chromium at 1080p and screenshotted;
 *   3. preview and MP4 are compared at the start, middle and end (SSIM);
 *   4. Show Entire Photo: where the photo should be in the MP4 frame, the whole photo is there
 *      (cropped out of the frame and compared with the photo itself) — nothing is cut off.
 * Side-by-side images (preview | export) are written to test-output/framing/.
 *
 * Run with: npm run test:render -w @lvs/web
 */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMovePreset, cameraKeyframes, defaultSpec, transformAt, type CameraSpec } from "@lvs/camera-presets";
import { DEFAULT_CHROME_WRAPPER, processJob, probe, type JobDeps } from "@lvs/render-worker";
import { decodeCover, frameAt, smallGray, ssim } from "@lvs/ai-motion";
import { PhotoLayer } from "@/components/video/photo-layer";
import { CANVAS_1080, composeDocument, planSchema, type Aspect, type EditPlan } from "@/lib/video/plan";
import { validateFableCutDocument } from "@/lib/video/validate-document";

const hasTools = spawnSync("ffmpeg", ["-version"]).status === 0 && existsSync("/usr/bin/google-chrome");
process.env.LVS_CHROME_BIN ??= process.env.LVS_TEST_CHROME ?? "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome";
const OUT = join(__dirname, "..", "..", "test-output", "framing");
const SOURCE = join(__dirname, "..", "fixtures", "opencv-building.jpg");
const PHOTO = join(OUT, "building-16x9.jpg");
const PW = 512, PH = 288, DURATION = 5;

const org = randomUUID(), listing = randomUUID(), project = randomUUID(), photoId = randomUUID();
const photoRow = { id: photoId, organization_id: org, listing_id: listing, project_id: null, kind: "photo", bucket: "listing-media", storage_path: `${org}/listings/${listing}/${photoId}.jpg` };
const photoInfo = [{ id: photoId, storage_path: photoRow.storage_path, file_name: "front.jpg", width: PW, height: PH }];

function deps(stored: Map<string, Uint8Array>): JobDeps {
  return {
    chrome: DEFAULT_CHROME_WRAPPER, timeoutMs: 10 * 60_000,
    async loadProject(id) { return id === project ? { id, organization_id: org, listing_id: listing, title: "Framing clip" } : null; },
    async loadAssets(ids) { return ids.includes(photoId) ? [photoRow] : []; },
    async download() { return new Uint8Array(readFileSync(PHOTO)); },
    async upload(bucket, path, bytes) { stored.set(`${bucket}/${path}`, bytes); },
    async recordOutput() { return randomUUID(); },
    async progress() {}, async finish() {},
  };
}

const plan = (spec: CameraSpec, aspect: Aspect): EditPlan => planSchema.parse({
  version: 1, aspect, transition: "none", texts: [], music: { assetId: null, volume: 0.8, fadeOut: false },
  scenes: [{ id: "s1", assetId: photoId, move: "still", duration: DURATION, camera: spec }],
});

/* The preview: PhotoLayer in Chromium at the canvas's own size. */
type Browser = { newPage: (o: object) => Promise<{ setContent: (h: string) => Promise<void>; waitForFunction: (f: string) => Promise<unknown>; screenshot: (o: object) => Promise<Buffer>; close: () => Promise<void> }>; close: () => Promise<void> };
let browser: Browser | null = null;
let photoDataUrl = "";
async function previewAt(spec: CameraSpec, aspect: Aspect, t: number): Promise<Buffer> {
  const canvas = CANVAS_1080[aspect];
  const r = cameraKeyframes(spec, DURATION, canvas, { width: PW, height: PH });
  const html = renderToStaticMarkup(createElement("div", { id: "f", style: { position: "relative", width: canvas.width, height: canvas.height, overflow: "hidden", background: "#000" } },
    createElement(PhotoLayer, { url: photoDataUrl, tr: transformAt(r.keyframes, t), canvas, fit: r.props.fit, background: r.background, drawn: r.framing })));
  const page = await browser!.newPage({ viewport: { width: canvas.width, height: canvas.height }, deviceScaleFactor: 1 });
  // Tailwind's few classes PhotoLayer uses, written out
  await page.setContent(`<style>*{margin:0}.absolute{position:absolute}.inset-0{inset:0}.size-full{width:100%;height:100%}.object-cover{object-fit:cover}.object-contain{object-fit:contain}.max-w-none{max-width:none}</style>${html}`);
  await page.waitForFunction("[...document.images].every((i) => i.complete && i.naturalWidth > 0)");
  const png = await page.screenshot({ type: "png" });
  await page.close();
  return png;
}
const rgb = (png: Buffer, w: number, h: number): Uint8Array => {
  const r = spawnSync("ffmpeg", ["-v", "error", "-i", "pipe:0", "-vf", `scale=${w}:${h}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { input: png, maxBuffer: w * h * 3 + 1024 });
  return new Uint8Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.length);
};
const gray = (data: Uint8Array, width: number, height: number) => smallGray({ width, height, data });

/** Crops the rectangle where the photo should be out of an MP4 frame and compares it with the photo. */
function photoRegionMatches(frame: Uint8Array, fw: number, fh: number, aspect: Aspect, spec: CameraSpec, t: number): number {
  const canvas = CANVAS_1080[aspect];
  const tr = transformAt(cameraKeyframes(spec, DURATION, canvas, { width: PW, height: PH }).keyframes, t);
  const f = Math.min(canvas.width / PW, canvas.height / PH) * tr.scale, k = fw / canvas.width;
  const w = PW * f * k, h = PH * f * k, x0 = fw / 2 + tr.x * k - w / 2, y0 = fh / 2 + tr.y * k - h / 2;
  expect(x0).toBeGreaterThanOrEqual(-1); expect(y0).toBeGreaterThanOrEqual(-1);
  expect(x0 + w).toBeLessThanOrEqual(fw + 1); expect(y0 + h).toBeLessThanOrEqual(fh + 1);
  const ow = 160, oh = 90, out = new Uint8Array(ow * oh * 3);
  for (let v = 0; v < oh; v++) for (let u = 0; u < ow; u++) {
    const x = Math.min(fw - 1, Math.max(0, Math.round(x0 + ((u + 0.5) / ow) * w))), y = Math.min(fh - 1, Math.max(0, Math.round(y0 + ((v + 0.5) / oh) * h)));
    out.set(frame.subarray((y * fw + x) * 3, (y * fw + x) * 3 + 3), (v * ow + u) * 3);
  }
  return ssim(gray(out, ow, oh), gray(decodeCover(PHOTO, ow, oh).data, ow, oh));
}

async function renderClip(spec: CameraSpec, aspect: Aspect, name: string): Promise<string> {
  const doc = composeDocument({ plan: plan(spec, aspect), title: name, photos: photoInfo, music: [], brand: null });
  expect(validateFableCutDocument(doc)).toEqual({ ok: true });
  const stored = new Map<string, Uint8Array>();
  const r = await processJob({ id: randomUUID(), organization_id: org, project_id: project, aspect, document: doc }, deps(stored));
  expect(r.error ?? "").toBe("");
  const file = join(OUT, `${name}.mp4`);
  writeFileSync(file, [...stored.values()][0]!);
  const info = probe(file);
  expect([info.width, info.height]).toEqual([CANVAS_1080[aspect].width, CANVAS_1080[aspect].height]);
  return file;
}

/** preview vs export at start / middle / end; writes preview|export side by side. */
async function compare(spec: CameraSpec, aspect: Aspect, file: string, name: string): Promise<number[]> {
  const { width, height } = CANVAS_1080[aspect];
  const sw = width / 4, sh = height / 4, sims: number[] = [];
  const tiles: string[] = [];
  for (const [i, t] of [0.1, DURATION / 2, DURATION - 0.1].entries()) {
    const png = await previewAt(spec, aspect, t);
    const p = rgb(png, sw, sh), e = frameAt(file, t, sw, sh);
    sims.push(ssim(gray(p, sw, sh), gray(e, sw, sh)));
    const pf = join(OUT, `${name}-${i}-preview.png`), ef = join(OUT, `${name}-${i}-export.png`);
    writeFileSync(pf, png);
    spawnSync("ffmpeg", ["-v", "error", "-y", "-ss", String(t), "-i", file, "-frames:v", "1", ef]);
    tiles.push(pf, ef);
  }
  const inputs = tiles.flatMap((f) => ["-i", f]);
  spawnSync("ffmpeg", ["-v", "error", "-y", ...inputs, "-filter_complex",
    `${tiles.map((_, i) => `[${i}]scale=${sw}:${sh}[s${i}]`).join(";")};${tiles.map((_, i) => `[s${i}]`).join("")}hstack=inputs=${tiles.length}`, join(OUT, `${name}-compare.png`)]);
  return sims;
}

describe.skipIf(!hasTools)("Move camera framing: preview = export", () => {
  beforeAll(async () => {
    mkdirSync(OUT, { recursive: true });
    // a 16:9 exterior photo
    spawnSync("ffmpeg", ["-v", "error", "-y", "-i", SOURCE, "-vf", `scale=${PW}:-2,crop=${PW}:${PH}`, "-q:v", "2", PHOTO]);
    photoDataUrl = `data:image/jpeg;base64,${readFileSync(PHOTO).toString("base64")}`;
    // Playwright is installed with the machine's browser, not as a project dependency
    const { chromium } = createRequire(import.meta.url)(process.env.LVS_PLAYWRIGHT ?? "playwright") as { chromium: { launch: () => Promise<unknown> } };
    browser = (await chromium.launch()) as unknown as Browser;
  }, 60_000);
  afterAll(async () => { await browser?.close(); });

  const contain = (patch: Partial<CameraSpec> = {}) => defaultSpec("push_in", { fit: "contain", ...patch });
  const cases: { name: string; aspect: Aspect; spec: CameraSpec; whole: boolean }[] = [
    { name: "fit-9x16-move-left", aspect: "9:16", spec: applyMovePreset(contain(), "move_left"), whole: true },
    { name: "fit-9x16-gentle-zoom", aspect: "9:16", spec: applyMovePreset(contain(), "gentle_zoom"), whole: true },
    { name: "fit-16x9-move-left", aspect: "16:9", spec: applyMovePreset(contain(), "move_left"), whole: true },
    { name: "fit-9x16-gradient", aspect: "9:16", spec: applyMovePreset(contain({ background: { kind: "gradient", color: "#1E3A8A", color2: "#F59E0B" } }), "move_up"), whole: true },
    { name: "fill-9x16-move-left", aspect: "9:16", spec: applyMovePreset(defaultSpec("push_in", { fit: "cover" }), "move_left"), whole: false },
    { name: "fit-9x16-gimbal", aspect: "9:16", spec: { ...applyMovePreset(contain(), "move_right"), gimbal: 0.9 }, whole: true },
    { name: "fill-16x9-gimbal", aspect: "16:9", spec: { ...applyMovePreset(defaultSpec("push_in", { fit: "cover" }), "move_right"), gimbal: 0.9 }, whole: false },
  ];

  for (const c of cases) {
    it(`${c.name}: the MP4 matches the preview at start, middle and end${c.whole ? ", with the whole photo in view" : ", edge to edge"}`, async () => {
      const file = await renderClip(c.spec, c.aspect, c.name);
      const sims = await compare(c.spec, c.aspect, file, c.name);
      for (const s of sims) expect(s, `${c.name} SSIM ${sims.map((x) => x.toFixed(3)).join(", ")}`).toBeGreaterThan(0.9);
      const { width, height } = CANVAS_1080[c.aspect];
      const fw = width / 2, fh = height / 2;
      for (const t of [0.1, DURATION / 2, DURATION - 0.1]) {
        const frame = frameAt(file, t, fw, fh);
        if (c.whole) {
          expect(photoRegionMatches(frame, fw, fh, c.aspect, c.spec, t), `${c.name} whole photo at ${t}s`).toBeGreaterThan(0.8);
        } else {
          // Fill Screen: no black border anywhere (each edge row/column has picture in it)
          const lum = (x: number, y: number) => { const i = (y * fw + x) * 3; return (frame[i]! + frame[i + 1]! + frame[i + 2]!) / 3; };
          const edge = (pts: [number, number][]) => pts.reduce((a, [x, y]) => a + lum(x, y), 0) / pts.length;
          const xs = Array.from({ length: 40 }, (_, i) => Math.floor((i + 0.5) * (fw / 40))), ys = Array.from({ length: 40 }, (_, i) => Math.floor((i + 0.5) * (fh / 40)));
          for (const side of [xs.map((x) => [x, 1] as [number, number]), xs.map((x) => [x, fh - 2] as [number, number]), ys.map((y) => [1, y] as [number, number]), ys.map((y) => [fw - 2, y] as [number, number])]) {
            expect(edge(side)).toBeGreaterThan(20);
          }
        }
      }
      console.log(`[framing] ${c.name}: SSIM preview vs export ${sims.map((x) => x.toFixed(3)).join(" / ")}`);
    }, 600_000);
  }
});
