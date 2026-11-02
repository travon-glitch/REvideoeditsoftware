/*
 * STAGE 5 ACCEPTANCE — real browser, real Supabase, real render worker.
 *
 *   E2E_BASE_URL=… E2E_EMAIL=editor@… E2E_PASSWORD=… npm run test:e2e -w @lvs/web
 *   (with `npm run worker` running somewhere that can reach the same Supabase project)
 *
 * Creates a listing with 15 photos, creates a video, opens the editor, edits it
 * (moves the last scene to the front, adds a text), exports a 1080p MP4, waits for
 * the worker, downloads the file and checks it with ffprobe. Deletes the listing.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("playwright");
const BASE = process.env.E2E_BASE_URL, EMAIL = process.env.E2E_EMAIL, PASSWORD = process.env.E2E_PASSWORD;
const skip = !BASE || !EMAIL || !PASSWORD ? "set E2E_BASE_URL, E2E_EMAIL and E2E_PASSWORD (an Editor account) and run the render worker" : false;

let browser, page;
before(async () => {
  if (skip) return;
  browser = await chromium.launch();
  page = await (await browser.newContext({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true })).newPage();
  page.on("dialog", (d) => d.accept());
});
after(async () => { await browser?.close(); });

test("15 photos → editor → edits → real 30-second MP4 download", { skip, timeout: 900_000 }, async () => {
  await page.goto(`${BASE}/login`);
  await page.getByLabel("Work email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/dashboard/);

  // Listing with 15 photos
  await page.goto(`${BASE}/listings/new`);
  await page.getByRole("button", { name: "Start a new listing" }).click();
  await page.waitForURL(/\/listings\/[0-9a-f-]{36}/);
  const listingUrl = page.url().split("?")[0];
  await page.getByLabel("Property address", { exact: true }).fill(`${Date.now() % 10000} Render Test Way`);
  await page.getByText("All changes saved").waitFor({ timeout: 15_000 });
  await page.getByRole("button", { name: "Next: Upload Photos" }).click();
  const images = await page.evaluate(async () => {
    const out = [];
    for (let i = 0; i < 15; i++) {
      const c = Object.assign(document.createElement("canvas"), { width: 1600, height: 1200 });
      const g = c.getContext("2d");
      g.fillStyle = `hsl(${i * 24}, 70%, 50%)`; g.fillRect(0, 0, 1600, 1200);
      g.fillStyle = "#fff"; g.font = "bold 200px sans-serif"; g.fillText(`Room ${i + 1}`, 200, 650);
      const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.85));
      const buf = new Uint8Array(await blob.arrayBuffer());
      let s = ""; for (const b of buf) s += String.fromCharCode(b);
      out.push(btoa(s));
    }
    return out;
  });
  await page.getByLabel("Choose photos to upload").setInputFiles(images.map((b, i) => ({ name: `room-${i + 1}.jpg`, mimeType: "image/jpeg", buffer: Buffer.from(b, "base64") })));
  await page.getByText("15 of 30 photos").waitFor({ timeout: 180_000 });

  // Create the video → editor opens with an automatic 30-second timeline
  await page.getByRole("button", { name: "Next: Save and Continue" }).click();
  await page.getByRole("button", { name: "Save and create a video" }).click();
  await page.waitForURL(/\/create\?listing=/);
  // Easy Mode wizard: step 1 already has the photos → choose a style → customize → storyboard
  await page.getByRole("button", { name: "Next: Choose a style" }).click();
  await page.waitForURL(/\/create\?project=[0-9a-f-]{36}&step=2/);
  await page.getByRole("radio", { name: /Modern/ }).click();
  await page.getByRole("button", { name: "Next: Customize" }).click();
  await page.getByRole("radio", { name: /Standard/ }).click();
  await page.getByRole("button", { name: "Next: Create video" }).click();
  await page.getByText("All changes saved").waitFor({ timeout: 15_000 });
  // then fine-tune the same project in the Advanced editor
  await page.getByRole("link", { name: "Fine-tune in Advanced editor" }).click();
  await page.waitForURL(/\/videos\/[0-9a-f-]{36}\/edit/);
  await page.getByText("15 scenes · 30.0 seconds").waitFor();

  // Edits: last scene to the front, add a text
  for (let i = 15; i > 1; i--) await page.getByRole("button", { name: `Move scene ${i} earlier` }).click();
  await page.getByRole("tab", { name: "Text" }).click();
  await page.getByRole("button", { name: "Add text" }).click();
  await page.locator("textarea").last().fill("E2E EDIT");
  await page.getByText("All changes saved").waitFor({ timeout: 15_000 });

  // Export and wait for the worker
  await page.getByRole("button", { name: "Export 1080p MP4" }).click();
  const download = page.getByRole("link", { name: "Download" }).first();
  await download.waitFor({ timeout: 600_000 });
  const [file] = await Promise.all([page.waitForEvent("download"), download.click()]);
  const dir = mkdtempSync(join(tmpdir(), "lvs-e2e-"));
  const mp4 = join(dir, "video.mp4");
  await file.saveAs(mp4);

  const probe = JSON.parse(spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name,width,height:format=duration", "-of", "json", mp4], { encoding: "utf8" }).stdout);
  const video = probe.streams.find((s) => s.width);
  assert.equal(video.codec_name, "h264");
  assert.deepEqual([video.width, video.height], [1920, 1080]);
  assert.ok(Math.abs(Number(probe.format.duration) - 30) < 0.5, `duration ${probe.format.duration}`);
  writeFileSync(join(dir, "ok"), "");

  // Clean up
  await page.goto(`${listingUrl}?step=1`);
  await page.getByRole("button", { name: "Delete listing" }).click();
});
