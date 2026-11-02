/*
 * STAGE 5 ACCEPTANCE — real render through the vendored FableCut engine.
 *
 *  1. One listing with 15 photographs (distinct colors, labeled "Room 1…15") + a music file.
 *  2. The automatic first timeline is built from the photos (≈30 s).
 *  3. Edits: last photo moved to the front, scene 3 set to a still shot, a text banner
 *     added on the first scene, music added.
 *  4. The document goes through the render worker exactly as in production:
 *     asset checks → isolated FableCut sandbox → headless Chrome compositor → FFmpeg.
 *  5. The stored MP4 is "downloaded" and checked: 1080p, 30 s, H.264 + AAC, audible music,
 *     scene order, still vs. moving camera, the banner — and it plays in Chrome.
 *  6. 9:16 and 1:1 renders produce 1080×1920 and 1080×1080 MP4s.
 *
 *  7. STAGE 6: "Auto Create with AI" (the rule-based storyboard maker) and an Easy Mode
 *     style choice each produce a real, playable MP4 — no camera or render settings touched.
 *
 * Run with: npm run test:render -w @lvs/web   (needs ffmpeg + Chrome; ~3–4 minutes)
 */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_CHROME_WRAPPER, processJob, probe, type AssetRow, type JobDeps, type RenderJob } from "@lvs/render-worker";
import { composeDocument, initialPlan, totalDuration, type EditPlan } from "@/lib/video/plan";
import { validateFableCutDocument } from "@/lib/video/validate-document";
import { autoDirector, buildEasyPlan, defaultSettings, type EasyListing } from "@/lib/video/easy";

const hasTools = spawnSync("ffmpeg", ["-version"]).status === 0 && existsSync("/usr/bin/google-chrome");
const OUT = join(__dirname, "..", "..", "test-output");
const FIX = join(tmpdir(), `lvs-render-fixtures-${process.pid}`);
// FableCut launches Chrome through the worker's wrapper (adds --no-sandbox when running as root).
process.env.LVS_CHROME_BIN ??= process.env.LVS_TEST_CHROME ?? "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome";
const CHROME = DEFAULT_CHROME_WRAPPER;

const org = randomUUID();
const listing = randomUUID();
const project = randomUUID();
const otherListing = randomUUID();

/** 15 clearly different colors (hue wheel). */
function colorFor(i: number): [number, number, number] {
  const h = (i * 24) % 360, s = 0.85, v = 0.9;
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}
const hex = ([r, g, b]: number[]) => r!.toString(16).padStart(2, "0") + g!.toString(16).padStart(2, "0") + b!.toString(16).padStart(2, "0");

interface Fixture { row: AssetRow; file: string; color: [number, number, number] }
const photos: Fixture[] = [];
let music: Fixture;

function ffmpeg(args: string[]) {
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
}

/** One frame as raw RGB at 192×(scaled) for pixel checks. */
function frameAt(file: string, t: number, w: number, h: number): Buffer {
  const r = spawnSync("ffmpeg", ["-v", "error", "-ss", String(t), "-i", file, "-frames:v", "1", "-s", `${w}x${h}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 1 << 24 });
  if (r.status !== 0) throw new Error(String(r.stderr));
  return r.stdout;
}
function avg(buf: Buffer, w: number, x0: number, y0: number, size: number): [number, number, number] {
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = y0; y < y0 + size; y++) for (let x = x0; x < x0 + size; x++) {
    const i = (y * w + x) * 3; r += buf[i]!; g += buf[i + 1]!; b += buf[i + 2]!; n++;
  }
  return [r / n, g / n, b / n];
}
const dist = (a: number[], b: number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
const nearest = (c: number[]) => photos.reduce((best, p, i) => (dist(c, p.color) < dist(c, photos[best]!.color) ? i : best), 0);
const frameDiff = (a: Buffer, b: Buffer) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i]! - b[i]!); return s / a.length; };

/** In-memory stand-ins for Supabase: storage = local files, DB rows = arrays. */
function localDeps(extra: AssetRow[] = []) {
  const stored = new Map<string, Uint8Array>();
  const outcome: { value?: Parameters<JobDeps["finish"]>[1] } = {};
  const progress: number[] = [];
  const all = [...photos, music].map((f) => f.row).concat(extra);
  const files = new Map([...photos, music].map((f) => [f.row.storage_path, f.file]));
  const deps: JobDeps = {
    chrome: CHROME,
    timeoutMs: 10 * 60_000,
    async loadProject(id) { return id === project ? { id, organization_id: org, listing_id: listing, title: "742 Evergreen Terrace" } : null; },
    async loadAssets(ids) { return all.filter((a) => ids.includes(a.id)); },
    async download(_bucket, path) { return new Uint8Array(readFileSync(files.get(path)!)); },
    async upload(bucket, path, bytes) { stored.set(`${bucket}/${path}`, bytes); },
    async recordOutput() { return randomUUID(); },
    async progress(_id, p) { progress.push(p); },
    async finish(_id, o) { outcome.value = o; },
  };
  return { deps, stored, outcome, progress };
}

let plan: EditPlan;
const BRAND = { primary_color: "#FF00FF", heading_font: "Montserrat", body_font: "Inter" };

beforeAll(() => {
  if (!hasTools) return;
  mkdirSync(FIX, { recursive: true });
  mkdirSync(OUT, { recursive: true });
  for (let i = 0; i < 15; i++) {
    const id = randomUUID();
    const color = colorFor(i);
    const file = join(FIX, `${id}.jpg`);
    ffmpeg(["-f", "lavfi", "-i", `color=c=0x${hex(color)}:s=1600x1200`, "-frames:v", "1",
      "-vf", `drawgrid=w=200:h=200:t=6:c=white@0.6,drawtext=text='Room ${i + 1}':fontsize=150:fontcolor=white:x=60:y=60`, "-q:v", "3", file]);
    photos.push({ file, color, row: { id, organization_id: org, listing_id: listing, project_id: null, kind: "photo", bucket: "listing-media", storage_path: `${org}/listings/${listing}/${id}.jpg` } });
  }
  const mid = randomUUID();
  const mfile = join(FIX, `${mid}.m4a`);
  ffmpeg(["-f", "lavfi", "-i", "sine=frequency=440:duration=35", "-c:a", "aac", "-b:a", "128k", mfile]);
  music = { file: mfile, color: [0, 0, 0], row: { id: mid, organization_id: org, listing_id: null, project_id: project, kind: "audio", bucket: "project-media", storage_path: `${org}/projects/${project}/${mid}.m4a` } };
});

afterAll(() => { rmSync(FIX, { recursive: true, force: true }); });

const photoInfo = () => photos.map((p) => ({ id: p.row.id, storage_path: p.row.storage_path, file_name: `${p.row.id}.jpg`, width: 1600, height: 1200 }));
const musicInfo = () => [{ id: music.row.id, storage_path: music.row.storage_path, file_name: "music.m4a", duration_seconds: 35 }];

describe.skipIf(!hasTools)("Stage 5 acceptance: a real 30-second listing video", () => {
  let mp4 = "";

  it("builds the automatic timeline from 15 photos", () => {
    plan = initialPlan({
      photos: photos.map((p) => ({ id: p.row.id })), coverId: photos[0]!.row.id, aspect: "16:9",
      address: "742 Evergreen Terrace", cityState: "Springfield, OR", priceLine: "$525,000", specsLine: "4 bd · 2.5 ba",
      openHouse: null, agentLine: "Alice Test · Acme Realty", contactLine: "555-0100",
    });
    expect(plan.scenes).toHaveLength(15);
    expect(totalDuration(plan)).toBe(30);
    expect(plan.scenes.map((s) => s.assetId)).toEqual(photos.map((p) => p.row.id));
    expect(plan.texts.find((t) => t.id === "t_outro")?.sceneId).toBe("@last");
  });

  it("applies the edits: reorder, still shot, text banner, music", () => {
    const last = plan.scenes[14]!;
    plan.scenes = [last, ...plan.scenes.slice(0, 14)];                    // Room 15 now opens the video
    plan.scenes[2] = { ...plan.scenes[2]!, move: "still" };               // third scene (Room 2) holds still
    plan.texts = plan.texts.filter((t) => t.id !== "t_address");
    plan.texts.push({ id: "t_banner", text: "ACCEPTANCE TEST", sceneId: plan.scenes[0]!.id, style: "banner", position: "top", duration: null });
    plan.music = { assetId: music.row.id, volume: 0.8, fadeOut: true };
    expect(totalDuration(plan)).toBe(30);
  });

  it("renders the edited project to MP4 through the isolated FableCut worker and stores it", async () => {
    const doc = composeDocument({ plan, title: "742 Evergreen Terrace", photos: photoInfo(), music: musicInfo(), brand: BRAND });
    expect(validateFableCutDocument(doc)).toEqual({ ok: true });
    const job: RenderJob = { id: randomUUID(), organization_id: org, project_id: project, aspect: "16:9", document: doc };
    const { deps, stored, outcome, progress } = localDeps();
    const r = await processJob(job, deps);
    expect(r.error ?? "").toBe("");
    expect(r).toEqual({ ok: true });
    expect(outcome.value?.ok).toBe(true);
    expect(progress.length).toBeGreaterThan(3);
    const key = `video-exports/${org}/projects/${project}/${job.id}.mp4`;
    expect([...stored.keys()]).toEqual([key]);
    // "download" the stored file
    mp4 = join(OUT, "listing-video-16x9.mp4");
    writeFileSync(mp4, stored.get(key)!);
  }, 600_000);

  it("is a 1080p, 30-second H.264 MP4 with an audible music track", () => {
    const info = probe(mp4);
    expect(info.width).toBe(1920);
    expect(info.height).toBe(1080);
    expect(info.durationSeconds).toBeGreaterThan(29.8);
    expect(info.durationSeconds).toBeLessThan(30.3);
    expect(info.hasAudio).toBe(true);
    const codecs = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name", "-of", "csv=p=0", mp4], { encoding: "utf8" }).stdout.trim().split("\n");
    expect(codecs).toEqual(expect.arrayContaining(["h264", "aac"]));
    const vol = spawnSync("ffmpeg", ["-v", "info", "-ss", "5", "-t", "5", "-i", mp4, "-af", "volumedetect", "-vn", "-f", "null", "-"], { encoding: "utf8" }).stderr;
    const mean = Number(/mean_volume: (-?[\d.]+) dB/.exec(vol)?.[1]);
    expect(mean).toBeGreaterThan(-35);
    // decodes cleanly end to end
    expect(spawnSync("ffmpeg", ["-v", "error", "-i", mp4, "-f", "null", "-"], { encoding: "utf8" }).stderr.trim()).toBe("");
  });

  it("shows the scenes in the edited order", () => {
    const W = 192, H = 108;
    // sample the lower-right area (away from the label and the banner), mid-scene
    const sceneAt = (t: number) => nearest(avg(frameAt(mp4, t, W, H), W, 140, 70, 16));
    expect(sceneAt(1.0)).toBe(14);   // Room 15 first (the reorder)
    expect(sceneAt(3.0)).toBe(0);    // then Room 1
    expect(sceneAt(5.0)).toBe(1);    // then Room 2
    expect(sceneAt(29.0)).toBe(13);  // Room 14 last
  });

  it("holds the still scene steady while other scenes move", () => {
    const W = 192, H = 108;
    const stillMove = frameDiff(frameAt(mp4, 4.6, W, H), frameAt(mp4, 5.4, W, H));
    const pushIn = frameDiff(frameAt(mp4, 2.6, W, H), frameAt(mp4, 3.4, W, H));
    expect(stillMove).toBeLessThan(1.5);
    expect(pushIn).toBeGreaterThan(stillMove * 2);
  });

  it("shows the added text banner on the first scene only", () => {
    const W = 384, H = 216;
    const isBanner = (t: number) => {
      const f = frameAt(mp4, t, W, H);
      const row = 39; // ≈ 194 px of 1080 → the banner's band near the top
      let magenta = 0;
      for (let x = 0; x < W; x += 2) {
        const i = (row * W + x) * 3;
        if (f[i]! > 180 && f[i + 1]! < 90 && f[i + 2]! > 180) magenta++;
      }
      return magenta;
    };
    expect(isBanner(1.6)).toBeGreaterThan(10);
    expect(isBanner(8.0)).toBe(0);
  });

  it("keeps the agent/contact caption on the last scene after reordering", () => {
    const W = 192, H = 108;
    // the caption's dark box sits in the middle of the frame; compare with the photo's own color
    const centerDark = (t: number) => {
      const f = frameAt(mp4, t, W, H);
      const c = avg(f, W, 88, 50, 8);
      const photo = avg(f, W, 140, 70, 16);
      return (photo[0] + photo[1] + photo[2]) - (c[0] + c[1] + c[2]);
    };
    expect(centerDark(29.2)).toBeGreaterThan(150);
    expect(centerDark(1.6)).toBeLessThan(60);
  });

  it("plays back in Chrome", async () => {
    type Page = { goto(u: string): Promise<unknown>; evaluate<T>(fn: () => Promise<T>): Promise<T> };
    type Browser = { newPage(): Promise<Page>; close(): Promise<void> };
    const { chromium } = createRequire(import.meta.url)("playwright") as { chromium: { launch(o: object): Promise<Browser> } };
    const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"] });
    try {
      const page = await browser.newPage();
      const html = join(OUT, "player.html");
      writeFileSync(html, `<!doctype html><video id="v" src="listing-video-16x9.mp4" muted playsinline></video>`);
      await page.goto(`file://${html}`);
      const result = await page.evaluate(async () => {
        const v = document.getElementById("v") as HTMLVideoElement;
        await v.play();
        await new Promise((r) => setTimeout(r, 2500));
        return { width: v.videoWidth, height: v.videoHeight, duration: v.duration, time: v.currentTime, error: v.error?.message ?? null };
      });
      expect(result.error).toBeNull();
      expect(result.width).toBe(1920);
      expect(result.height).toBe(1080);
      expect(result.duration).toBeGreaterThan(29.8);
      expect(result.time).toBeGreaterThan(1.5);
    } finally {
      await browser.close();
    }
  }, 60_000);
});

describe.skipIf(!hasTools)("other formats and safety", () => {
  const shortPlan = (aspect: EditPlan["aspect"]): EditPlan => ({
    version: 1, aspect, transition: "fade", texts: [], music: { assetId: null, volume: 0.8, fadeOut: false },
    scenes: photos.slice(0, 3).map((p, i) => ({ id: `s${i}`, assetId: p.row.id, move: "push_in", duration: 2 })),
  });

  for (const [aspect, w, h] of [["9:16", 1080, 1920], ["1:1", 1080, 1080]] as const) {
    it(`renders ${aspect} at ${w}×${h}`, async () => {
      const doc = composeDocument({ plan: shortPlan(aspect), title: "Format test", photos: photoInfo(), music: musicInfo(), brand: BRAND });
      const { deps, stored } = localDeps();
      const r = await processJob({ id: randomUUID(), organization_id: org, project_id: project, aspect, document: doc }, deps);
      expect(r.ok).toBe(true);
      const file = join(OUT, `listing-video-${aspect.replace(":", "x")}.mp4`);
      writeFileSync(file, [...stored.values()][0]!);
      const info = probe(file);
      expect([info.width, info.height]).toEqual([w, h]);
      expect(info.durationSeconds).toBeGreaterThan(5.8);
    }, 300_000);
  }

  it("refuses to render a photo from another listing, even in the same company", async () => {
    const stranger: AssetRow = { id: randomUUID(), organization_id: org, listing_id: otherListing, project_id: null, kind: "photo", bucket: "listing-media", storage_path: `${org}/listings/${otherListing}/${randomUUID()}.jpg` };
    const doc = composeDocument({ plan: shortPlan("16:9"), title: "x", photos: photoInfo(), music: musicInfo(), brand: null });
    (doc.media as { assetId: string; src: string }[])[0]!.assetId = stranger.id;
    (doc.media as { assetId: string; src: string }[])[0]!.src = `/media/${stranger.storage_path.split("/").pop()}`;
    const { deps, stored, outcome } = localDeps([stranger]);
    const r = await processJob({ id: randomUUID(), organization_id: org, project_id: project, aspect: "16:9", document: doc }, deps);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not an allowed file/);
    expect(outcome.value?.ok).toBe(false);
    expect(stored.size).toBe(0);
  });

  it("refuses paths that point outside the job's media folder", async () => {
    const doc = composeDocument({ plan: shortPlan("16:9"), title: "x", photos: photoInfo(), music: musicInfo(), brand: null });
    (doc.media as { src: string }[])[0]!.src = "/media/../../etc/passwd";
    const { deps } = localDeps();
    const r = await processJob({ id: randomUUID(), organization_id: org, project_id: project, aspect: "16:9", document: doc }, deps);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/unexpected path/);
  });
});

describe.skipIf(!hasTools)("Stage 6 acceptance: Easy Mode makes a real video without technical settings", () => {
  const home: EasyListing = {
    address_line: "742 Evergreen Terrace", city: "Springfield", state: "OR", price: 525000, bedrooms: 4, bathrooms: 2.5,
    square_feet: 2150, property_type: "single_family", status: "for_sale", agent_name: "Alice Test", brokerage: "Acme Realty",
    contact_phone: "555-0100", contact_email: "alice@acme.test", open_house_text: null, cover_asset_id: null,
  };
  const render = async (p: EditPlan, name: string) => {
    const doc = composeDocument({ plan: p, title: "742 Evergreen Terrace", photos: photoInfo(), music: musicInfo(), brand: BRAND });
    expect(validateFableCutDocument(doc)).toEqual({ ok: true });
    const { deps, stored } = localDeps();
    const r = await processJob({ id: randomUUID(), organization_id: org, project_id: project, aspect: p.aspect, document: doc }, deps);
    expect(r.error ?? "").toBe("");
    const file = join(OUT, name);
    writeFileSync(file, [...stored.values()][0]!);
    return file;
  };

  it("Auto Create: one click → a 30-second 1080p 'Just Listed' video with music", async () => {
    // What the button does: listing facts → choices → storyboard (the person picks nothing).
    const choice = autoDirector({ listing: home, photoCount: 15, musicAssetIds: [music.row.id] });
    expect(choice.settings).toMatchObject({ style: "just-listed", duration: 30, aspect: "16:9", musicAssetId: music.row.id });
    const p = buildEasyPlan({ listing: home, photos: photos.map((f) => ({ id: f.row.id })), settings: choice.settings, brand: { company_name: "Acme Realty", outro_text: null } });
    const file = await render(p, "easy-auto-create-16x9.mp4");

    const info = probe(file);
    expect([info.width, info.height]).toEqual([1920, 1080]);
    expect(info.durationSeconds).toBeGreaterThan(29.8);
    expect(info.durationSeconds).toBeLessThan(30.3);
    expect(info.hasAudio).toBe(true);
    expect(spawnSync("ffmpeg", ["-v", "error", "-i", file, "-f", "null", "-"], { encoding: "utf8" }).stderr.trim()).toBe("");
    // the first scene is the first photo, with the brand-colored "JUST LISTED" banner across the top
    const W = 384, H = 216;
    const f = frameAt(file, 1.0, W, H);
    let magenta = 0;
    for (let y = 10; y < 60; y++) for (let x = 0; x < W; x += 2) {
      const i = (y * W + x) * 3;
      if (f[i]! > 180 && f[i + 1]! < 90 && f[i + 2]! > 180) magenta++;
    }
    expect(magenta).toBeGreaterThan(50);
    expect(nearest(avg(frameAt(file, 1.0, 192, 108), 192, 140, 80, 12))).toBe(0);
  }, 600_000);

  it("Easy Mode style 'Social Media Reel': a tall 15-second video", async () => {
    const p = buildEasyPlan({ listing: home, photos: photos.map((f) => ({ id: f.row.id })), settings: defaultSettings("social-reel"), brand: null });
    const file = await render(p, "easy-social-reel-9x16.mp4");
    const info = probe(file);
    expect([info.width, info.height]).toEqual([1080, 1920]);
    expect(info.durationSeconds).toBeGreaterThan(14.8);
    expect(info.durationSeconds).toBeLessThan(15.3);
  }, 600_000);
});
