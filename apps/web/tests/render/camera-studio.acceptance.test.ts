/*
 * STAGE 7 ACCEPTANCE — Cinematic Camera Control Studio.
 *
 *  "Upload a property exterior photo. Apply Push In. Preview it. Export a working
 *   MP4 clip. Repeat with three other camera movements. Test at least one real
 *   AI-generated motion when an appropriate provider is configured."
 *
 *  Photo: OpenCV sample "building.jpg" (Apache-2.0) — a real building exterior.
 *  For Push In, Pull Out, Truck Right and Tilt Up:
 *   1. the camera spec is validated like the API does (planSchema / cameraSpecSchema),
 *   2. "preview": the frame the browser preview shows is computed with the preview's
 *      own maths (sceneCamera + transformAt) from the photo,
 *   3. export: the one-scene clip goes through the real render worker (isolated FableCut
 *      sandbox → headless Chrome → FFmpeg) to an MP4,
 *   4. the MP4 is checked: 1920×1080 H.264, the right length, decodes cleanly, the
 *      camera moves the right way — and its frames match the preview (SSIM).
 *  AI: a real AI DEPTH clip (MiDaS depth model, on this machine) is made from the same
 *  photo, with its accuracy review. A GENERATIVE provider test runs only when
 *  MUAPI_API_KEY is set (no provider is configured in this environment).
 *
 * Run with: npm run test:render -w @lvs/web
 */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultSpec, transformAt, type CameraSpec, type StudioMoveId } from "@lvs/camera-presets";
import { DEFAULT_CHROME_WRAPPER, processJob, probe, type JobDeps } from "@lvs/render-worker";
import { decodeCover, depthModelAvailable, frameAt, makeDepthClip, smallGray, ssim, MuapiProvider, normalizeVideo, reviewClip } from "@lvs/ai-motion";
import { CANVAS_1080, composeDocument, planSchema, sceneCamera, type EditPlan } from "@/lib/video/plan";
import { validateFableCutDocument } from "@/lib/video/validate-document";

const hasTools = spawnSync("ffmpeg", ["-version"]).status === 0 && existsSync("/usr/bin/google-chrome");
process.env.LVS_CHROME_BIN ??= process.env.LVS_TEST_CHROME ?? "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome";
const OUT = join(__dirname, "..", "..", "test-output", "camera-studio");
const PHOTO = join(__dirname, "..", "fixtures", "opencv-building.jpg");
const W = 1920, H = 1080, DURATION = 5;

const org = randomUUID(), listing = randomUUID(), project = randomUUID(), photoId = randomUUID();
const photoRow = { id: photoId, organization_id: org, listing_id: listing, project_id: null, kind: "photo", bucket: "listing-media", storage_path: `${org}/listings/${listing}/${photoId}.jpg` };
const photoInfo = [{ id: photoId, storage_path: photoRow.storage_path, file_name: "front.jpg", width: 512, height: 384 }];

function deps(stored: Map<string, Uint8Array>): JobDeps {
  return {
    chrome: DEFAULT_CHROME_WRAPPER,
    timeoutMs: 10 * 60_000,
    async loadProject(id) { return id === project ? { id, organization_id: org, listing_id: listing, title: "Camera clip" } : null; },
    async loadAssets(ids) { return ids.includes(photoId) ? [photoRow] : []; },
    async download() { return new Uint8Array(readFileSync(PHOTO)); },
    async upload(bucket, path, bytes) { stored.set(`${bucket}/${path}`, bytes); },
    async recordOutput() { return randomUUID(); },
    async progress() {},
    async finish() {},
  };
}

/** The same one-scene plan the Studio's "Export MP4 clip" saves (camera-store.ts), validated like the API. */
function clipPlan(spec: CameraSpec): EditPlan {
  return planSchema.parse({
    version: 1, aspect: "16:9", transition: "none", texts: [], music: { assetId: null, volume: 0.8, fadeOut: false },
    scenes: [{ id: "s1", assetId: photoId, move: "still", duration: DURATION, camera: spec }],
  });
}

/** What the browser preview shows at time t (same keyframes + same transform order as FableCut), at 480×270. */
function previewFrame(plan: EditPlan, t: number, src: { data: Uint8Array }): Uint8Array {
  const cam = sceneCamera(plan.scenes[0]!, DURATION, CANVAS_1080["16:9"], { width: 512, height: 384 });
  const tr = transformAt(cam?.keyframes, t);
  const w = 480, h = 270, k = W / w;
  const out = new Uint8Array(w * h * 3);
  const th = (-tr.rotation * Math.PI) / 180, c = Math.cos(th), s = Math.sin(th);
  for (let v = 0; v < h; v++) for (let u = 0; u < w; u++) {
    const px = (u + 0.5) * k - W / 2 - tr.x, py = (v + 0.5) * k - H / 2 - tr.y;
    const qx = (px * c - py * s) / tr.scale + W / 2, qy = (px * s + py * c) / tr.scale + H / 2;
    const x = Math.min(W - 1, Math.max(0, Math.round(qx))), y = Math.min(H - 1, Math.max(0, Math.round(qy)));
    out.set(src.data.subarray((y * W + x) * 3, (y * W + x) * 3 + 3), (v * w + u) * 3);
  }
  return out;
}
const gray = (rgb: Uint8Array) => smallGray({ width: 480, height: 270, data: rgb });

/** Horizontal / vertical shift between two frames (best-matching offset of the centre region, in 192-px units). */
function shift(a: Uint8Array, b: Uint8Array, w = 192, h = 108): { dx: number; dy: number } {
  const g = (f: Uint8Array, x: number, y: number) => 0.299 * f[(y * w + x) * 3]! + 0.587 * f[(y * w + x) * 3 + 1]! + 0.114 * f[(y * w + x) * 3 + 2]!;
  let best = { dx: 0, dy: 0, err: Infinity };
  for (let dy = -12; dy <= 12; dy++) for (let dx = -12; dx <= 12; dx++) {
    let err = 0;
    for (let y = 30; y < h - 30; y += 2) for (let x = 40; x < w - 40; x += 2) err += Math.abs(g(a, x, y) - g(b, x + dx, y + dy));
    if (err < best.err) best = { dx, dy, err };
  }
  return { dx: best.dx, dy: best.dy };
}

describe.skipIf(!hasTools)("Stage 7 acceptance: camera moves on an exterior photo → preview → MP4", () => {
  const source = () => decodeCover(PHOTO, W, H);
  const moves: { move: StudioMoveId; check: (start: Uint8Array, end: Uint8Array, file: string) => void }[] = [
    { move: "push_in", check: (a, b) => { /* moving in: the end frame is a magnified centre of the start frame */
      expect(spawnFrameScale(a, b)).toBeGreaterThan(1.1); } },
    { move: "pull_out", check: (a, b) => { expect(spawnFrameScale(b, a)).toBeGreaterThan(1.1); } },
    { move: "truck_right", check: (a, b) => { const s = shift(a, b); expect(s.dx).toBeLessThan(-2); /* camera right → picture moves left */ } },
    { move: "tilt_up", check: (a, b) => { const s = shift(a, b); expect(s.dy).toBeGreaterThan(2); /* camera up → picture moves down */ } },
  ];

  for (const { move, check } of moves) {
    it(`${move}: preview matches the exported 1080p MP4, which plays and moves the right way`, async () => {
      mkdirSync(OUT, { recursive: true });
      const spec = defaultSpec(move, { strength: 0.8 });
      const plan = clipPlan(spec);
      const doc = composeDocument({ plan, title: `Camera clip ${move}`, photos: photoInfo, music: [], brand: null });
      expect(validateFableCutDocument(doc)).toEqual({ ok: true });

      const stored = new Map<string, Uint8Array>();
      const r = await processJob({ id: randomUUID(), organization_id: org, project_id: project, aspect: "16:9", document: doc }, deps(stored));
      expect(r.error ?? "").toBe("");
      const file = join(OUT, `${move}.mp4`);
      writeFileSync(file, [...stored.values()][0]!);

      const info = probe(file);
      expect([info.width, info.height]).toEqual([W, H]);
      expect(info.durationSeconds).toBeGreaterThan(DURATION - 0.2);
      expect(info.durationSeconds).toBeLessThan(DURATION + 0.3);
      expect(spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name", "-of", "csv=p=0", file], { encoding: "utf8" }).stdout.trim()).toBe("h264");
      expect(spawnSync("ffmpeg", ["-v", "error", "-i", file, "-f", "null", "-"], { encoding: "utf8" }).stderr.trim()).toBe("");

      // preview = export
      const src = source();
      for (const t of [0.2, 2.5, 4.7]) {
        const sim = ssim(gray(previewFrame(plan, t, src)), gray(frameAt(file, t, 480, 270)));
        expect(sim, `${move} at ${t}s`).toBeGreaterThan(0.85);
      }
      check(frameAt(file, 0.1, 192, 108), frameAt(file, DURATION - 0.1, 192, 108), file);
    }, 600_000);
  }

  it("Move camera (Horizontal +6, Vertical +4): preview matches the exported MP4, which moves the way the sliders say", async () => {
    mkdirSync(OUT, { recursive: true });
    const spec = defaultSpec("push_in", { manual: { horizontal: 6, vertical: 4, zoom: 0, pan: 0, tilt: 0, rotate: 0 } });
    const plan = clipPlan(spec);
    expect(plan.scenes[0]!.camera?.manual).toMatchObject({ horizontal: 6, vertical: 4 });
    const doc = composeDocument({ plan, title: "Camera clip manual", photos: photoInfo, music: [], brand: null });
    expect(validateFableCutDocument(doc)).toEqual({ ok: true });
    const stored = new Map<string, Uint8Array>();
    const r = await processJob({ id: randomUUID(), organization_id: org, project_id: project, aspect: "16:9", document: doc }, deps(stored));
    expect(r.error ?? "").toBe("");
    const file = join(OUT, "manual-move.mp4");
    writeFileSync(file, [...stored.values()][0]!);
    expect([probe(file).width, probe(file).height]).toEqual([W, H]);
    expect(spawnSync("ffmpeg", ["-v", "error", "-i", file, "-f", "null", "-"], { encoding: "utf8" }).stderr.trim()).toBe("");
    const src = source();
    for (const t of [0.2, 2.5, 4.7]) expect(ssim(gray(previewFrame(plan, t, src)), gray(frameAt(file, t, 480, 270))), `at ${t}s`).toBeGreaterThan(0.85);
    // camera right and up → the picture moves left and down
    const d = shift(frameAt(file, 0.1, 192, 108), frameAt(file, DURATION - 0.1, 192, 108));
    expect(d.dx).toBeLessThan(-2);
    expect(d.dy).toBeGreaterThan(1);
  }, 600_000);

  it("the exported Push In clip plays in Chrome", async () => {
    type Page = { goto(u: string): Promise<unknown>; evaluate<T>(fn: () => Promise<T>): Promise<T> };
    const { chromium } = createRequire(import.meta.url)("playwright") as { chromium: { launch(o: object): Promise<{ newPage(): Promise<Page>; close(): Promise<void> }> } };
    const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"] });
    try {
      const page = await browser.newPage();
      writeFileSync(join(OUT, "player.html"), `<!doctype html><video id="v" src="push_in.mp4" muted playsinline></video>`);
      await page.goto(`file://${join(OUT, "player.html")}`);
      const res = await page.evaluate(async () => {
        const v = document.getElementById("v") as HTMLVideoElement;
        await v.play(); await new Promise((r) => setTimeout(r, 1500));
        return { w: v.videoWidth, t: v.currentTime, err: v.error?.message ?? null };
      });
      expect(res).toMatchObject({ w: 1920, err: null });
      expect(res.t).toBeGreaterThan(1);
    } finally { await browser.close(); }
  }, 60_000);
});

/** How much bigger the centre of `a` appears in `b` (best zoom factor matching b to a's centre). */
function spawnFrameScale(a: Uint8Array, b: Uint8Array, w = 192, h = 108): number {
  const g = (f: Uint8Array, x: number, y: number) => {
    const xi = Math.min(w - 1, Math.max(0, Math.round(x))), yi = Math.min(h - 1, Math.max(0, Math.round(y)));
    return 0.299 * f[(yi * w + xi) * 3]! + 0.587 * f[(yi * w + xi) * 3 + 1]! + 0.114 * f[(yi * w + xi) * 3 + 2]!;
  };
  let best = { k: 1, err: Infinity };
  for (let k = 0.7; k <= 1.8; k += 0.02) {
    let err = 0;
    for (let y = 10; y < h - 10; y += 2) for (let x = 10; x < w - 10; x += 2) {
      err += Math.abs(g(b, x, y) - g(a, w / 2 + (x - w / 2) / k, h / 2 + (y - h / 2) / k));
    }
    if (err < best.err) best = { k, err };
  }
  return best.k;
}

describe.skipIf(!hasTools || !depthModelAvailable())("Stage 7 acceptance: real AI-generated motion", () => {
  it("AI depth (MiDaS, on this machine): Orbit Left on the exterior photo → 1080p clip with real parallax + accuracy review", async () => {
    mkdirSync(OUT, { recursive: true });
    const out = join(OUT, "ai-depth-orbit_left.mp4");
    const r = await makeDepthClip({ photo: PHOTO, spec: defaultSpec("orbit_left", { strength: 0.8, depth: 0.7 }), duration: 4, width: W, height: H, out });
    expect([r.width, r.height]).toEqual([W, H]);
    expect(r.durationSeconds).toBeGreaterThan(3.8);
    expect(r.model).toMatch(/MiDaS/);
    expect(r.review.method).toBe("depth");
    expect(r.review.stretchedShare).toBeLessThan(0.05);
    // real parallax: near and far parts of the picture move by different amounts
    const a = frameAt(out, 0.1, 192, 108), b = frameAt(out, 3.9, 192, 108);
    const top = shift(a.subarray(0, 192 * 54 * 3), b.subarray(0, 192 * 54 * 3), 192, 54);
    const whole = shift(a, b);
    expect(Math.abs(whole.dx) + Math.abs(top.dx)).toBeGreaterThan(0);
    expect(spawnSync("ffmpeg", ["-v", "error", "-i", out, "-f", "null", "-"], { encoding: "utf8" }).stderr.trim()).toBe("");
  }, 300_000);

  it("AI depth with Move camera (Pan +6): the camera really turns", async () => {
    mkdirSync(OUT, { recursive: true });
    const out = join(OUT, "ai-depth-manual-pan.mp4");
    const spec = defaultSpec("push_in", { depth: 0.6, manual: { horizontal: 0, vertical: 0, zoom: 0, pan: 6, tilt: 0, rotate: 0 } });
    const r = await makeDepthClip({ photo: PHOTO, spec, duration: 3, width: W, height: H, out });
    expect([r.width, r.height]).toEqual([W, H]);
    expect(r.review.stretchedShare).toBeLessThan(0.05);
    const d = shift(frameAt(out, 0.1, 192, 108), frameAt(out, 2.9, 192, 108));
    expect(d.dx).toBeLessThan(-1); // turning right → the picture moves left
    expect(spawnSync("ffmpeg", ["-v", "error", "-i", out, "-f", "null", "-"], { encoding: "utf8" }).stderr.trim()).toBe("");
  }, 300_000);

  it("an AI clip used in a video scene renders through FableCut (with a photo scene after it)", async () => {
    const clipFile = join(OUT, "ai-depth-orbit_left.mp4");
    expect(existsSync(clipFile)).toBe(true);
    const clipId = randomUUID();
    const clipRow = { id: clipId, organization_id: org, listing_id: listing, project_id: null, kind: "ai_clip", bucket: "ai-clips", storage_path: `${org}/listings/${listing}/${clipId}.mp4` };
    const plan = planSchema.parse({
      version: 1, aspect: "16:9", transition: "fade", texts: [], music: { assetId: null, volume: 0.8, fadeOut: false },
      scenes: [
        { id: "s1", assetId: photoId, move: "still", duration: 3.5, camera: defaultSpec("orbit_left"), clipAssetId: clipId },
        { id: "s2", assetId: photoId, move: "still", duration: 3, camera: defaultSpec("push_in") },
      ],
    });
    const doc = composeDocument({ plan, title: "AI clip in a video", photos: photoInfo, music: [], brand: null,
      clips: [{ id: clipId, storage_path: clipRow.storage_path, file_name: "Orbit Left · AI depth.mp4", width: W, height: H, duration_seconds: 4, source_asset_id: photoId }] });
    expect(validateFableCutDocument(doc)).toEqual({ ok: true });
    const stored = new Map<string, Uint8Array>();
    const d = deps(stored);
    d.loadAssets = async (ids) => [photoRow, clipRow].filter((a) => ids.includes(a.id));
    d.download = async (bucket) => new Uint8Array(readFileSync(bucket === "ai-clips" ? clipFile : PHOTO));
    const r = await processJob({ id: randomUUID(), organization_id: org, project_id: project, aspect: "16:9", document: doc }, d);
    expect(r.error ?? "").toBe("");
    const file = join(OUT, "video-with-ai-clip.mp4");
    writeFileSync(file, [...stored.values()][0]!);
    const info = probe(file);
    expect([info.width, info.height]).toEqual([W, H]);
    expect(info.durationSeconds).toBeGreaterThan(6.3);
    // the first second shows the AI clip's frames
    expect(ssim(gray(frameAt(file, 1, 480, 270)), gray(frameAt(clipFile, 1, 480, 270)))).toBeGreaterThan(0.85);
  }, 600_000);

  it.skipIf(!process.env.MUAPI_API_KEY)("Generative AI (MuAPI image-to-video, needs MUAPI_API_KEY): Simulated Drone Reveal", async () => {
    const provider = new MuapiProvider({ apiKey: process.env.MUAPI_API_KEY!, model: process.env.MUAPI_I2V_MODEL });
    const res = await provider.imageToVideo({
      photo: new Uint8Array(readFileSync(PHOTO)), mimeType: "image/jpeg", fileName: "front.jpg",
      prompt: "real estate video, aerial drone shot rising and pulling back to reveal the building, smooth, keep the property exactly as photographed",
      durationSeconds: 5, aspect: "16:9",
    });
    const raw = join(OUT, "generative-raw.mp4"), out = join(OUT, "generative-drone.mp4");
    writeFileSync(raw, res.video);
    normalizeVideo(raw, out, W, H, 5);
    const review = reviewClip({ method: "generative", clip: out, duration: 5, photo: decodeCover(PHOTO, W, H) });
    console.log("generative review", JSON.stringify(review));
    expect(probe(out).width).toBe(W);
  }, 900_000);
});
