/*
 * STAGE 6 browser acceptance: a person makes a video with Easy Mode only —
 * drag in photos, press "Auto Create with AI", and download a real, playable MP4.
 * No camera or rendering settings are touched.
 *
 * Needs a running app + worker: E2E_BASE_URL, E2E_EMAIL, E2E_PASSWORD (an Editor account).
 *   node --test tests/e2e/easy-mode.e2e.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const { E2E_BASE_URL: base, E2E_EMAIL: email, E2E_PASSWORD: password } = process.env;

test("Easy Mode: photos → Auto Create → playable MP4", { skip: !base || !email || !password ? "set E2E_BASE_URL, E2E_EMAIL, E2E_PASSWORD" : false, timeout: 900_000 }, async () => {
  const { chromium } = createRequire(import.meta.url)("playwright");
  const browser = await chromium.launch();
  const page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
  try {
    await page.goto(`${base}/login`);
    await page.getByLabel("Work email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/dashboard/);

    await page.goto(`${base}/create`);
    const images = await page.evaluate(async () => Promise.all(Array.from({ length: 8 }, async (_, i) => {
      const c = Object.assign(document.createElement("canvas"), { width: 1600, height: 1200 });
      const g = c.getContext("2d");
      g.fillStyle = `hsl(${i * 45} 70% 50%)`; g.fillRect(0, 0, 1600, 1200);
      g.fillStyle = "#fff"; g.font = "bold 140px sans-serif"; g.fillText(`Room ${i + 1}`, 80, 220);
      const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.85));
      const buf = new Uint8Array(await blob.arrayBuffer());
      let s = ""; for (const b of buf) s += String.fromCharCode(b);
      return btoa(s);
    })));
    await page.getByLabel("Choose photos to upload").setInputFiles(images.map((b, i) => ({ name: `room-${i + 1}.jpg`, mimeType: "image/jpeg", buffer: Buffer.from(b, "base64") })));
    await page.getByText("8 of 30 photos").waitFor({ timeout: 180_000 });
    await page.getByLabel("Property address").fill("E2E 1 Easy Street");

    await page.getByRole("button", { name: "Auto Create with AI" }).click();
    await page.getByText("How we built your video").waitFor({ timeout: 60_000 });
    const download = page.getByRole("link", { name: "Download MP4" });
    await download.waitFor({ timeout: 600_000 });

    // it plays in the page
    const played = await page.evaluate(async () => {
      const v = document.querySelector("video");
      v.muted = true; await v.play(); await new Promise((r) => setTimeout(r, 2000));
      return { time: v.currentTime, w: v.videoWidth, error: v.error?.message ?? null };
    });
    assert.equal(played.error, null);
    assert.ok(played.time > 1 && played.w > 0);

    const [file] = await Promise.all([page.waitForEvent("download"), download.click()]);
    const mp4 = join(mkdtempSync(join(tmpdir(), "lvs-easy-")), "video.mp4");
    await file.saveAs(mp4);
    const probe = JSON.parse(spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name,width,height:format=duration", "-of", "json", mp4], { encoding: "utf8" }).stdout);
    const video = probe.streams.find((s) => s.width);
    assert.equal(video.codec_name, "h264");
    assert.ok(Math.max(video.width, video.height) === 1920);
    assert.ok(Number(probe.format.duration) > 10);
  } finally {
    await browser.close();
  }
});
