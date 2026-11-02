/*
 * STAGE 8 ACCEPTANCE — Generate 6 Videos.
 *
 *  "Upload 20 property photos. Generate six distinct real videos.
 *   Confirm each is playable and downloadable."
 *
 *  1. 20 photos: the two real building exteriors (OpenCV samples, Apache-2.0) and 18
 *     distinct room images (3 of them tall), as a listing would have them.
 *  2. The listing is analysed and the six storyboards are built with the same code the
 *     "Generate 6 Videos" button runs (buildBatch).
 *  3. Six background render jobs go through the real render worker (isolated FableCut →
 *     headless Chrome → FFmpeg). One job's first attempt hits a storage error on purpose:
 *     the other five must still finish, and retrying ONLY that job must succeed.
 *  4. Every MP4 is checked: right shape and length, H.264, decodes cleanly, plays in
 *     Chrome, and the six are genuinely different (shape, length, opening picture).
 *  5. "Download all as ZIP": the six files are zipped with the same ZIP writer the
 *     download route uses, and the ZIP is opened and verified.
 *
 * Run with: npm run test:render -w @lvs/web   (≈ 6–9 minutes)
 */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_CHROME_WRAPPER, processJob, probe, type AssetRow, type JobDeps } from "@lvs/render-worker";
import { BATCH_TYPE_INFO, analyzeListing, buildBatch, structureOf, type BatchType } from "@/lib/video/batch";
import { CANVAS_1080, composeDocument, totalDuration } from "@/lib/video/plan";
import { validateFableCutDocument } from "@/lib/video/validate-document";
import { zipName, zipStream, type ZipEntry } from "@/lib/zip";
import type { EasyListing } from "@/lib/video/easy";

const hasTools = spawnSync("ffmpeg", ["-version"]).status === 0 && existsSync("/usr/bin/google-chrome");
process.env.LVS_CHROME_BIN ??= process.env.LVS_TEST_CHROME ?? "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome";
const OUT = join(__dirname, "..", "..", "test-output", "batch");
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

const listing: EasyListing = {
  address_line: "742 Evergreen Terrace", city: "Springfield", state: "OR", price: 525000, bedrooms: 4, bathrooms: 2.5, square_feet: 2150,
  property_type: "single_family", status: "for_sale", agent_name: "Alice Agent", brokerage: "Acme Realty", contact_phone: "555-0100",
  contact_email: "alice@acme.test", open_house_text: "Sun, Nov 15 · 1:00 PM – 3:00 PM", cover_asset_id: null,
};
const BRAND = { primary_color: "#1D4ED8", heading_font: "Montserrat", body_font: "Inter" };

function deps(projectId: string, stored: Map<string, Uint8Array>, failDownload = false): JobDeps {
  const byPath = new Map(photos.map((p) => [p.row.storage_path, p.file]));
  return {
    chrome: DEFAULT_CHROME_WRAPPER,
    timeoutMs: 15 * 60_000,
    async loadProject(id) { return id === projectId ? { id, organization_id: org, listing_id: listingId, title: "Batch video" } : null; },
    async loadAssets(ids) { return photos.map((p) => p.row).filter((r) => ids.includes(r.id)); },
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

describe.skipIf(!hasTools)("Stage 8 acceptance: 20 photos → six distinct, playable, downloadable videos", () => {
  const results = new Map<BatchType, { file: string; planned: number; aspect: string }>();

  it("analyses the listing and builds six different storyboards", () => {
    makePhotos();
    const analysis = analyzeListing(listing, photos.map((p) => ({ id: p.row.id, width: p.width, height: p.height })));
    expect(analysis.photoCount).toBe(20);
    expect(analysis.landscapePhotos).toBe(17); // 3 of the generated rooms are tall
    const batch = buildBatch({ listing, photos: photos.map((p) => ({ id: p.row.id, width: p.width, height: p.height })), brand: { company_name: "Acme Realty", outro_text: null } });
    expect(batch).toHaveLength(6);
    expect(new Set(batch.map((b) => structureOf(b.plan))).size).toBe(6);
    (globalThis as { __batch?: typeof batch }).__batch = batch;
  });

  it("renders all six in background jobs; one failure doesn't stop the others; only the failed one is retried", async () => {
    const batch = (globalThis as { __batch?: ReturnType<typeof buildBatch> }).__batch!;
    const info = photos.map((p) => ({ id: p.row.id, storage_path: p.row.storage_path, file_name: "p.jpg", width: p.width, height: p.height }));
    const jobs = batch.map(({ type, plan }) => {
      const projectId = randomUUID();
      const doc = composeDocument({ plan, title: BATCH_TYPE_INFO[type].title, photos: info, music: [], brand: BRAND });
      expect(validateFableCutDocument(doc), type).toEqual({ ok: true });
      return { type, plan, projectId, job: { id: randomUUID(), organization_id: org, project_id: projectId, aspect: plan.aspect, document: doc } };
    });
    const failing: BatchType = "highlights";
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
        results.set(j.type, { file, planned: totalDuration(j.plan), aspect: j.plan.aspect });
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
    results.set(failing, { file, planned: totalDuration(retry.plan), aspect: retry.plan.aspect });
    expect(attempts).toMatchObject({ [failing]: 2, "cinematic-tour": 1, luxury: 1 });
    expect(results.size).toBe(6);
  }, 1_800_000);

  it("every video is a valid MP4 of the right shape and length, and decodes cleanly", () => {
    for (const [type, r] of results) {
      const p = probe(r.file);
      const c = CANVAS_1080[r.aspect as keyof typeof CANVAS_1080];
      expect([p.width, p.height], type).toEqual([c.width, c.height]);
      expect(Math.abs(p.durationSeconds - r.planned), `${type} ${p.durationSeconds} vs ${r.planned}`).toBeLessThan(0.6);
      expect(spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name", "-of", "csv=p=0", r.file], { encoding: "utf8" }).stdout.trim(), type).toBe("h264");
      expect(spawnSync("ffmpeg", ["-v", "error", "-i", r.file, "-f", "null", "-"], { encoding: "utf8" }).stderr.trim(), type).toBe("");
    }
  });

  it("the six are genuinely different videos", () => {
    const durations = [...results.values()].map((r) => Math.round(probe(r.file).durationSeconds));
    expect(new Set(durations).size).toBeGreaterThanOrEqual(5);
    expect(new Set([...results.values()].map((r) => r.aspect))).toEqual(new Set(["16:9", "9:16", "1:1"]));
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
    const entries: ZipEntry[] = [...results.entries()].map(([type, r]) => ({ name: zipName(`${BATCH_TYPE_INFO[type].title}-${r.aspect.replace(":", "x")}`, "mp4", used), data: new Uint8Array(readFileSync(r.file)) }));
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
    expect(listed.map((x) => x[0])).toEqual(expect.arrayContaining(["Cinematic-Listing-Tour-16x9.mp4", "Just-Listed-Reel-9x16.mp4", "Open-House-Promotion-1x1.mp4"]));
    // an extracted file is still a playable MP4
    expect(probe(join(extractDir, "Just-Listed-Reel-9x16.mp4")).height).toBe(1920);
  }, 120_000);
});
