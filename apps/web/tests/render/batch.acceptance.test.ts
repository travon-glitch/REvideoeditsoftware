/*
 * STAGE 10 ACCEPTANCE — Six-Video Automatic Generator.
 *
 *  "Create six distinct downloadable MP4 videos from one existing listing.
 *   Check all six outputs."
 *
 *  1. One listing with 20 photos (two real building exteriors, OpenCV samples, Apache-2.0,
 *     plus 18 distinct room images), the company's brand logo, and the built-in licensed
 *     music library (original tracks in apps/web/assets/music, company-owned).
 *  2. The six storyboards are built by the same code the "Generate 6 Videos" button runs
 *     (buildBatch): Cinematic Property Tour, Just Listed Reel, Luxury Highlights,
 *     Open House Promotion, Short Social Media Reel, Agent-Branded Advertisement —
 *     vertical 1080×1920 by default, address + price on every one, logo, music per mood.
 *  3. Six background render jobs go through the real render worker (FableCut → headless
 *     Chrome → FFmpeg). One job's first attempt hits a storage error on purpose: the other
 *     five still finish, and retrying ONLY that job succeeds.
 *  4. All six MP4s are checked: 1080×1920, planned length, H.264 + AAC music that isn't
 *     silent, clean decode, plays in Chrome, the logo is in the corner, and the six are
 *     genuinely different (length, opening picture, structure).
 *  5. "Download All as ZIP" with the same ZIP writer the download route uses; the ZIP is
 *     opened and verified.
 *
 * Run with: npm run test:render -w @lvs/web   (≈ 6–10 minutes)
 */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_CHROME_WRAPPER, processJob, probe, type AssetRow, type JobDeps } from "@lvs/render-worker";
import { BATCH_TYPES, BATCH_TYPE_INFO, analyzeListing, buildBatch, structureOf, type BatchType } from "@/lib/video/batch";
import { composeDocument, totalDuration, type PlanLogo, type PlanMusic } from "@/lib/video/plan";
import { validateFableCutDocument } from "@/lib/video/validate-document";
import { zipName, zipStream, type ZipEntry } from "@/lib/zip";
import type { EasyListing } from "@/lib/video/easy";

const hasTools = spawnSync("ffmpeg", ["-version"]).status === 0 && existsSync("/usr/bin/google-chrome");
process.env.LVS_CHROME_BIN ??= process.env.LVS_TEST_CHROME ?? "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome";
const OUT = join(__dirname, "..", "..", "test-output", "batch");
const MUSIC_DIR = join(__dirname, "..", "..", "assets", "music");
const FIX = join(__dirname, "..", "fixtures");
const org = randomUUID(), listingId = randomUUID();

interface Photo { row: AssetRow; file: string; width: number; height: number }
const photos: Photo[] = [];

function makePhotos() {
  mkdirSync(join(OUT, "photos"), { recursive: true });
  const real = ["opencv-building.jpg", "opencv-home.jpg"];
  for (let i = 0; i < 20; i++) {
    const id = randomUUID();
    let file: string, width: number, height: number;
    if (i < 2) {
      file = join(FIX, real[i]!); [width, height] = i === 0 ? [512, 384] : [868, 600];
    } else {
      const tall = i % 5 === 0;
      [width, height] = tall ? [1200, 1600] : [1600, 1200];
      file = join(OUT, "photos", `${id}.jpg`);
      const hue = (i * 37) % 360;
      const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `color=c=0x334455:s=${width}x${height}`, "-frames:v", "1",
        "-vf", `hue=h=${hue}:s=2,drawgrid=w=160:h=160:t=4:c=white@0.5,drawbox=x=${(i * 53) % (width - 300)}:y=${(i * 71) % (height - 300)}:w=300:h=300:c=0x${((i * 2654435761) >>> 8 & 0xffffff).toString(16).padStart(6, "0")}:t=fill,drawtext=text='Room ${i + 1}':fontsize=120:fontcolor=white:x=60:y=60`,
        "-q:v", "3", file]);
      if (r.status !== 0) throw new Error(String(r.stderr));
    }
    photos.push({ file, width, height, row: { id, organization_id: org, listing_id: listingId, project_id: null, kind: "photo", bucket: "listing-media", storage_path: `${org}/listings/${listingId}/${id}.jpg` } });
  }
}

/* The company's licensed music library (built-in original tracks) and its brand logo. */
const TRACKS = [
  { key: "elegant-evening", title: "Elegant Evening", mood: "elegant" }, { key: "bright-open-house", title: "Bright Open House", mood: "upbeat" },
  { key: "calm-morning", title: "Calm Morning", mood: "calm" }, { key: "warm-welcome", title: "Warm Welcome", mood: "warm" },
  { key: "inspiring-skyline", title: "Inspiring Skyline", mood: "inspiring" },
].map((t) => {
  const id = randomUUID();
  return { ...t, file: join(MUSIC_DIR, `${t.key}.m4a`), row: { id, organization_id: org, listing_id: null, project_id: null, kind: "audio", bucket: "music-library", storage_path: `${org}/music/${id}.m4a` } as AssetRow };
});
const logoId = randomUUID();
const logo = { file: join(OUT, "logo.png"), row: { id: logoId, organization_id: org, listing_id: null, project_id: null, kind: "logo", bucket: "brand-assets", storage_path: `${org}/brand/${logoId}.png` } as AssetRow };
function makeLogo() {
  // a solid magenta badge so the corner can be found in the frames
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0xFF00FF:s=600x240", "-frames:v", "1", logo.file]);
  if (r.status !== 0) throw new Error(String(r.stderr));
}
/** Same rule as the server: the track for the video's mood, a different one for each video where possible. */
function musicFor(types: readonly BatchType[]) {
  const used = new Set<string>();
  return Object.fromEntries(types.map((t) => {
    const pick = TRACKS.find((x) => x.mood === BATCH_TYPE_INFO[t].mood && !used.has(x.key)) ?? TRACKS.find((x) => !used.has(x.key)) ?? TRACKS[0]!;
    used.add(pick.key);
    return [t, pick.row.id];
  })) as Record<BatchType, string>;
}

const listing: EasyListing = {
  address_line: "742 Evergreen Terrace", city: "Springfield", state: "OR", price: 525000, bedrooms: 4, bathrooms: 2.5, square_feet: 2150,
  property_type: "single_family", status: "for_sale", agent_name: "Alice Agent", brokerage: "Acme Realty", contact_phone: "555-0100",
  contact_email: "alice@acme.test", open_house_text: "Sun, Nov 15 · 1:00 PM – 3:00 PM", cover_asset_id: null,
};
const BRAND = { primary_color: "#1D4ED8", heading_font: "Montserrat", body_font: "Inter" };

function deps(projectId: string, stored: Map<string, Uint8Array>, failDownload = false): JobDeps {
  const all = [...photos, ...TRACKS, logo];
  const byPath = new Map(all.map((p) => [p.row.storage_path, p.file]));
  return {
    chrome: DEFAULT_CHROME_WRAPPER,
    timeoutMs: 15 * 60_000,
    async loadProject(id) { return id === projectId ? { id, organization_id: org, listing_id: listingId, title: "Batch video" } : null; },
    async loadAssets(ids) { return all.map((p) => p.row).filter((r) => ids.includes(r.id)); },
    async download(_bucket, path) {
      if (failDownload) throw new Error("Storage is temporarily unavailable");
      return new Uint8Array(readFileSync(byPath.get(path)!));
    },
    async upload(bucket, path, bytes) { stored.set(`${bucket}/${path}`, bytes); },
    async recordOutput() { return randomUUID(); },
    async progress() {},
    async finish() {},
  };
}

describe.skipIf(!hasTools)("Stage 10 acceptance: one listing → six distinct, vertical, downloadable MP4s", () => {
  const results = new Map<BatchType, { file: string; planned: number; aspect: string; doc: Record<string, unknown> }>();

  it("analyses the listing and builds six different storyboards", () => {
    makePhotos();
    makeLogo();
    for (const t of TRACKS) expect(existsSync(t.file), t.key).toBe(true);
    const analysis = analyzeListing(listing, photos.map((p) => ({ id: p.row.id, width: p.width, height: p.height })));
    expect(analysis.photoCount).toBe(20);
    expect(analysis.landscapePhotos).toBe(17); // 3 of the generated rooms are tall
    const batch = buildBatch({
      listing, photos: photos.map((p) => ({ id: p.row.id, width: p.width, height: p.height })), brand: { company_name: "Acme Realty", outro_text: null },
      music: musicFor(BATCH_TYPES), logoAssetId: logo.row.id,
    });
    expect(batch.map((b) => b.type)).toEqual([...BATCH_TYPES]);
    expect(new Set(batch.map((b) => structureOf(b.plan))).size).toBe(6);
    expect(new Set(batch.map((b) => b.plan.scenes[0]!.assetId)).size).toBe(6); // six different opening scenes
    for (const { type, plan } of batch) {
      expect(plan.aspect, type).toBe("9:16");
      expect(plan.logoAssetId, type).toBe(logo.row.id);
      expect(plan.music.assetId, type).toBeTruthy();
      const text = plan.texts.map((t) => t.text).join(" | ");
      expect(text, type).toContain("742 Evergreen Terrace");
      expect(text, type).toContain("$525,000");
    }
    expect(new Set(batch.map((b) => b.plan.music.assetId)).size).toBe(5); // five library tracks across six videos
    (globalThis as { __batch?: typeof batch }).__batch = batch;
  });

  it("renders all six in background jobs; one failure doesn't stop the others; only the failed one is retried", async () => {
    const batch = (globalThis as { __batch?: ReturnType<typeof buildBatch> }).__batch!;
    const info = photos.map((p) => ({ id: p.row.id, storage_path: p.row.storage_path, file_name: "p.jpg", width: p.width, height: p.height }));
    const music: PlanMusic[] = TRACKS.map((t) => ({ id: t.row.id, storage_path: t.row.storage_path, file_name: `${t.key}.m4a`, duration_seconds: 75 }));
    const planLogo: PlanLogo = { id: logo.row.id, storage_path: logo.row.storage_path, width: 600, height: 240 };
    const jobs = batch.map(({ type, plan }) => {
      const projectId = randomUUID();
      const doc = composeDocument({ plan, title: BATCH_TYPE_INFO[type].title, photos: info, music, brand: BRAND, logo: planLogo });
      expect(validateFableCutDocument(doc), type).toEqual({ ok: true });
      return { type, plan, projectId, job: { id: randomUUID(), organization_id: org, project_id: projectId, aspect: plan.aspect, document: doc } };
    });
    const failing: BatchType = "open-house";
    const attempts: Record<string, number> = {};
    const outcome: Record<string, boolean> = {};
    for (const j of jobs) {
      const stored = new Map<string, Uint8Array>();
      attempts[j.type] = 1;
      const r = await processJob(j.job, deps(j.projectId, stored, j.type === failing));
      outcome[j.type] = r.ok;
      if (r.ok) {
        const file = join(OUT, `${j.type}.mp4`);
        writeFileSync(file, [...stored.values()][0]!);
        results.set(j.type, { file, planned: totalDuration(j.plan), aspect: j.plan.aspect, doc: j.job.document });
      } else {
        expect(r.error).toMatch(/temporarily unavailable/);
      }
    }
    expect(Object.entries(outcome).filter(([, ok]) => !ok).map(([t]) => t)).toEqual([failing]);
    expect(results.size).toBe(5);

    // Retry ONLY the failed video (a new attempt of the same storyboard)
    const retry = jobs.find((j) => j.type === failing)!;
    const stored = new Map<string, Uint8Array>();
    const r = await processJob({ ...retry.job, id: randomUUID() }, deps(retry.projectId, stored));
    attempts[failing]! += 1;
    expect(r.error ?? "").toBe("");
    const file = join(OUT, `${failing}.mp4`);
    writeFileSync(file, [...stored.values()][0]!);
    results.set(failing, { file, planned: totalDuration(retry.plan), aspect: retry.plan.aspect, doc: retry.job.document });
    expect(attempts).toMatchObject({ [failing]: 2, "cinematic-tour": 1, "just-listed-reel": 1, "luxury-highlights": 1, "social-reel": 1, "agent-ad": 1 });
    expect(results.size).toBe(6);
  }, 1_800_000);

  it("every video is a vertical 1080p MP4 of the planned length, with music, and decodes cleanly", () => {
    expect([...results.keys()].sort()).toEqual([...BATCH_TYPES].sort());
    for (const [type, r] of results) {
      const p = probe(r.file);
      expect([p.width, p.height], type).toEqual([1080, 1920]);
      const audio = spawnSync("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_name", "-of", "csv=p=0", r.file], { encoding: "utf8" }).stdout.trim();
      expect(audio, `${type} audio`).toBe("aac");
      const vol = spawnSync("ffmpeg", ["-v", "info", "-i", r.file, "-map", "0:a:0", "-af", "volumedetect", "-f", "null", "-"], { encoding: "utf8" }).stderr;
      const mean = Number(/mean_volume: (-?[\d.]+) dB/.exec(vol)?.[1] ?? "-99");
      expect(mean, `${type} music loudness`).toBeGreaterThan(-35);
      expect(Math.abs(p.durationSeconds - r.planned), `${type} ${p.durationSeconds} vs ${r.planned}`).toBeLessThan(0.6);
      expect(spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name", "-of", "csv=p=0", r.file], { encoding: "utf8" }).stdout.trim(), type).toBe("h264");
      expect(spawnSync("ffmpeg", ["-v", "error", "-i", r.file, "-f", "null", "-"], { encoding: "utf8" }).stderr.trim(), type).toBe("");
    }
  });

  it("the six are genuinely different videos", () => {
    const durations = [...results.values()].map((r) => Math.round(probe(r.file).durationSeconds));
    expect(new Set(durations).size).toBeGreaterThanOrEqual(5);
    expect(new Set([...results.values()].map((r) => r.aspect))).toEqual(new Set(["9:16"]));
    // opening frames differ from each other (compare small greyscale thumbnails)
    const frame = (file: string) => spawnSync("ffmpeg", ["-v", "error", "-ss", "0.3", "-i", file, "-frames:v", "1", "-vf", "scale=32:32,format=gray", "-f", "rawvideo", "-"], { maxBuffer: 1 << 20 }).stdout as Buffer;
    const frames = [...results.values()].map((r) => frame(r.file));
    let pairsDifferent = 0, pairs = 0;
    for (let i = 0; i < frames.length; i++) for (let j = i + 1; j < frames.length; j++) {
      pairs++;
      let d = 0;
      for (let k = 0; k < 1024; k++) d += Math.abs(frames[i]![k]! - frames[j]![k]!);
      if (d / 1024 > 6) pairsDifferent++;
    }
    expect(pairsDifferent).toBeGreaterThanOrEqual(pairs - 2);
  });

  it("every video carries the address, the price and the company logo", () => {
    for (const [type, r] of results) {
      const json = JSON.stringify(r.doc);
      expect(json, type).toContain("742 Evergreen Terrace");
      expect(json, type).toContain("$525,000");
      expect(json, type).toContain("c_logo");
      // the magenta logo is visible in the top-right corner of a frame
      const px = spawnSync("ffmpeg", ["-v", "error", "-ss", "2", "-i", r.file, "-frames:v", "1", "-vf", "crop=120:40:880:62,scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 1 << 16 }).stdout as Buffer;
      const [red, green, blue] = [px[0]!, px[1]!, px[2]!];
      expect(red > 150 && blue > 150 && green < 110, `${type} logo colour ${red},${green},${blue}`).toBe(true);
    }
  });

  it("all six play in Chrome", async () => {
    type Page = { goto(u: string): Promise<unknown>; evaluate<T>(fn: () => Promise<T>): Promise<T> };
    const { chromium } = createRequire(import.meta.url)("playwright") as { chromium: { launch(o: object): Promise<{ newPage(): Promise<Page>; close(): Promise<void> }> } };
    const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"] });
    try {
      const page = await browser.newPage();
      const html = join(OUT, "player.html");
      writeFileSync(html, `<!doctype html>${[...results.keys()].map((t) => `<video data-t="${t}" src="${t}.mp4" muted playsinline></video>`).join("")}`);
      await page.goto(`file://${html}`);
      const res = await page.evaluate(async () => Promise.all([...document.querySelectorAll("video")].map(async (v) => {
        await v.play(); await new Promise((r) => setTimeout(r, 1500));
        return { t: v.dataset.t, w: v.videoWidth, time: v.currentTime, err: v.error?.message ?? null };
      })));
      expect(res).toHaveLength(6);
      for (const r of res) { expect(r.err, r.t).toBeNull(); expect(r.w, r.t).toBeGreaterThan(0); expect(r.time, r.t).toBeGreaterThan(0.8); }
    } finally { await browser.close(); }
  }, 120_000);

  it("downloads: each file individually, and all six as one ZIP that opens and verifies", async () => {
    const used = new Set<string>();
    const entries: ZipEntry[] = BATCH_TYPES.map((type) => { const r = results.get(type)!; return { name: zipName(`${BATCH_TYPE_INFO[type].title}-${r.aspect.replace(":", "x")}`, "mp4", used), data: new Uint8Array(readFileSync(r.file)) }; });
    async function* gen() { for (const e of entries) yield e; }
    const reader = zipStream(gen()).getReader();
    const parts: Uint8Array[] = [];
    for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); }
    const zipFile = join(OUT, "742-Evergreen-Terrace-videos.zip");
    writeFileSync(zipFile, Buffer.concat(parts));
    const extractDir = join(OUT, "unzipped");
    const py = spawnSync("python3", ["-I", "-c", `
import zipfile, sys, json
z = zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None
z.extractall(sys.argv[2])
print(json.dumps([[i.filename, i.file_size] for i in z.infolist()]))`, zipFile, extractDir], { encoding: "utf8" });
    expect(py.stderr).toBe("");
    const listed = JSON.parse(py.stdout) as [string, number][];
    expect(listed.map((x) => x[0])).toEqual(entries.map((e) => e.name));
    expect(listed.map((x) => x[1])).toEqual(entries.map((e) => e.data.length));
    expect(listed).toHaveLength(6);
    expect(listed.map((x) => x[0])).toEqual(expect.arrayContaining(["Cinematic-Property-Tour-9x16.mp4", "Just-Listed-Reel-9x16.mp4", "Agent-Branded-Advertisement-9x16.mp4"]));
    // an extracted file is still a playable MP4
    expect(probe(join(extractDir, "Just-Listed-Reel-9x16.mp4")).height).toBe(1920);
  }, 120_000);
});
