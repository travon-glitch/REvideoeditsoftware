/*
 * STAGE 4 ACCEPTANCE — real browser, real Supabase.
 *
 *   E2E_BASE_URL=https://video.yourcompany.com E2E_EMAIL=editor@yourcompany.com E2E_PASSWORD=… npm run test:e2e
 *
 * Signs in as an Editor, creates a listing, fills every field, uploads 20
 * photos, rearranges them, picks a main photo, saves, signs out, checks the
 * listing is unreachable while signed out, signs back in and verifies every
 * value and photo. Then checks that photos are not publicly reachable, that a
 * deleted photo's link stops working, and deletes the test listing.
 * Skipped when the E2E_* variables are not set.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

// Loaded with require so a globally installed Playwright (NODE_PATH) works as well as a project install.
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = process.env.E2E_BASE_URL;
const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const skip = !BASE || !EMAIL || !PASSWORD ? "set E2E_BASE_URL, E2E_EMAIL and E2E_PASSWORD (an Editor account) to run" : false;

const FIELDS = {
  "Property address": `${Date.now() % 10000} E2E Test Lane`,
  City: "Springfield",
  State: "OR",
  ZIP: "97403",
  "Listing price": "525000",
  Bedrooms: "4",
  Bathrooms: "2.5",
  "Square footage": "2150",
  "Property description": "Bright family home with a big backyard. (automated test)",
  "Agent name": "E2E Agent",
  Brokerage: "Acme Realty",
  "Contact phone": "555-010-0100",
  "Contact email": "e2e@example.com",
};

let browser;
let page;
let listingUrl = "";

async function signIn() {
  await page.goto(`${BASE}/login`);
  await page.getByLabel("Work email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/dashboard/);
}

before(async () => {
  if (skip) return;
  browser = await chromium.launch();
  page = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
  page.on("dialog", (d) => d.accept());
});

after(async () => { await browser?.close(); });

test("create a listing with 20 photos, sign out, sign in, everything is preserved", { skip, timeout: 300_000 }, async () => {
  await signIn();

  // 1. Property Information
  await page.goto(`${BASE}/listings/new`);
  await page.getByRole("button", { name: "Start a new listing" }).click();
  await page.waitForURL(/\/listings\/[0-9a-f-]{36}\?step=1/);
  listingUrl = page.url().split("?")[0];
  for (const [label, value] of Object.entries(FIELDS)) await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByLabel("Property type").selectOption("single_family");
  await page.getByLabel("Date").fill("2026-11-15");
  await page.getByLabel("Starts").fill("13:00");
  await page.getByLabel("Ends").fill("15:00");
  await page.getByText("All changes saved").waitFor({ timeout: 15_000 });

  // 2. Upload Photos — 20 distinct JPEGs made in the browser
  await page.getByRole("button", { name: "Next: Upload Photos" }).click();
  const images = await page.evaluate(async () => {
    const out = [];
    for (let i = 0; i < 20; i++) {
      const c = document.createElement("canvas");
      c.width = 320; c.height = 240;
      const g = c.getContext("2d");
      g.fillStyle = `hsl(${i * 18}, 60%, 55%)`; g.fillRect(0, 0, 320, 240);
      g.fillStyle = "#fff"; g.font = "bold 96px sans-serif"; g.fillText(String(i + 1), 100, 160);
      const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.85));
      const buf = new Uint8Array(await blob.arrayBuffer());
      let bin = ""; for (const b of buf) bin += String.fromCharCode(b);
      out.push(btoa(bin));
    }
    return out;
  });
  await page.getByLabel("Choose photos to upload").setInputFiles(
    images.map((b64, i) => ({ name: `photo-${String(i + 1).padStart(2, "0")}.jpg`, mimeType: "image/jpeg", buffer: Buffer.from(b64, "base64") })),
  );
  await page.getByText("20 of 30 photos").waitFor({ timeout: 120_000 });
  await page.getByRole("button", { name: "Make photo 5 the main photo" }).click();
  await page.getByRole("button", { name: "Move photo 20 earlier" }).click();
  await page.waitForTimeout(1500);

  // 3. Save and Continue → save the draft
  await page.getByRole("button", { name: "Next: Save and Continue" }).click();
  await page.getByText("Property address").first().waitFor();
  await page.getByRole("link", { name: "Save draft and finish later" }).click();
  await page.waitForURL(/\/listings$/);

  // Sign out; the listing must not be reachable
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL(/\/login\?notice=signed-out/);
  await page.goto(listingUrl);
  await page.waitForURL(/\/login/);

  // Sign back in and reopen
  await signIn();
  await page.goto(`${listingUrl}?step=1`);
  for (const [label, value] of Object.entries(FIELDS)) {
    assert.equal(await page.getByLabel(label, { exact: true }).inputValue(), value, label);
  }
  assert.equal(await page.getByLabel("Property type").inputValue(), "single_family");
  assert.equal(await page.getByLabel("Date").inputValue(), "2026-11-15");
  assert.equal(await page.getByLabel("Starts").inputValue(), "13:00");
  assert.equal(await page.getByLabel("Ends").inputValue(), "15:00");

  await page.getByRole("button", { name: "Next: Upload Photos" }).click();
  await page.getByText("20 of 30 photos").waitFor();
  assert.equal(await page.getByText("Main photo", { exact: true }).count(), 1);
  const imgs = page.locator('ol[aria-label="Photos in video order"] img');
  assert.equal(await imgs.count(), 20);
  await page.waitForFunction(() => [...document.querySelectorAll('ol[aria-label="Photos in video order"] img')].every((i) => i.complete && i.naturalWidth > 0));
  // order survived: photo 20 now sits in position 19
  assert.equal(await imgs.nth(18).getAttribute("alt"), "Photo 19");
});

test("photos are private, and a deleted photo's link stops working", { skip, timeout: 120_000 }, async () => {
  assert.ok(listingUrl, "needs the listing from the first test");
  await page.goto(`${listingUrl}?step=2`);
  const firstSrc = await page.locator('ol[aria-label="Photos in video order"] img').first().getAttribute("src");
  const signed = new URL(firstSrc);
  assert.match(signed.pathname, /\/storage\/v1\/object\/sign\/listing-media\//);

  // The same file without a signature (public URL) must not load
  const publicUrl = `${signed.origin}${signed.pathname.replace("/object/sign/", "/object/public/")}`;
  const anonymous = await fetch(publicUrl);
  assert.notEqual(anonymous.status, 200, "listing photos must not be public");

  // Delete the last photo; its signed link must stop working
  const lastSrc = await page.locator('ol[aria-label="Photos in video order"] img').last().getAttribute("src");
  await page.getByRole("button", { name: "Remove photo 20" }).click();
  await page.getByText("19 of 30 photos").waitFor();
  await page.waitForTimeout(1000);
  const gone = await fetch(lastSrc);
  assert.notEqual(gone.status, 200, "a deleted photo must not be downloadable");

  // Clean up the test listing
  await page.getByRole("button", { name: "Delete listing" }).click();
  await page.waitForURL(/\/listings\?deleted=1/);
});
