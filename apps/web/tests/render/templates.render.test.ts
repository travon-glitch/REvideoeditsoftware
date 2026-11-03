/*
 * STAGE 11 — every template exports.
 *
 * Each of the fifteen templates is built for one listing (20 photos, brand kit with logo,
 * brokerage logo and disclosure, an agent profile with a headshot), composed into a FableCut
 * document and rendered by the real render worker. Each MP4 is checked (size, length, H.264,
 * clean decode) and a strip of frames is saved for review.
 *
 * Run with: LVS_RENDER_TESTS=1 npx vitest run tests/render/templates.render.test.ts
 *   (LVS_TEMPLATES=just-listed,luxury-listing renders only those)
 */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { processJob, probe } from "@lvs/render-worker";
import { contactStrip, makeFixtures, workerDeps, type Asset } from "./template-fixtures";
import { BUILTIN_TEMPLATES, TEMPLATE_KEYS, buildTemplatePlan, type TemplateBrand, type TemplateKey } from "@/lib/video/templates";
import { CANVAS_1080, composeDocument, totalDuration } from "@/lib/video/plan";
import { validateFableCutDocument } from "@/lib/video/validate-document";

const hasTools = spawnSync("ffmpeg", ["-version"]).status === 0 && existsSync("/usr/bin/google-chrome");
process.env.LVS_CHROME_BIN ??= process.env.LVS_TEST_CHROME ?? "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome";
const OUT = join(__dirname, "..", "..", "test-output", "templates");
const only = (process.env.LVS_TEMPLATES ?? "").split(",").filter(Boolean) as TemplateKey[];
const KEYS = only.length ? only : [...TEMPLATE_KEYS];

describe.skipIf(!hasTools)("Stage 11: every template renders a real MP4", () => {
  const org = randomUUID(), listingId = randomUUID();
  const fx = makeFixtures(org, listingId, OUT);
  const brand: TemplateBrand = {
    primary_color: "#1D4ED8", secondary_color: "#0F172A", accent_color: "#F59E0B", heading_font: "Montserrat", body_font: "Inter",
    company_name: "Acme Realty", logoAssetId: fx.logo.row.id, brokerageLogoAssetId: fx.brokerage.row.id,
    intro_style: "logo-reveal", outro_style: "agent-card", agent_layout: "photo-left", disclosure: "Acme Realty, licensed real estate broker. Equal Housing Opportunity.",
  };
  const listing = {
    address_line: "742 Evergreen Terrace", city: "Springfield", state: "OR", price: 525000, previous_price: 560000, bedrooms: 4, bathrooms: 2.5,
    square_feet: 2150, property_type: "single_family", status: "for_sale", mls_number: "OR-1234", description: "Bright home near the lake.",
    open_house_text: "Sun, Nov 15 · 1:00 PM – 3:00 PM", cover_asset_id: fx.photos[0]!.row.id,
  };
  const agent = { name: "Alice Agent", title: "Listing Agent", phone: "555-0100", email: "alice@acme.test", brokerage: "Acme Realty", license: "Lic. #01234567", headshotAssetId: fx.headshot.row.id };
  const all = [...fx.photos, fx.logo, fx.brokerage, fx.headshot];
  const info = fx.photos.map((p) => ({ id: p.row.id, storage_path: p.row.storage_path, file_name: "p.jpg", width: p.width, height: p.height }));
  const img = (a: Asset) => ({ id: a.row.id, storage_path: a.row.storage_path, width: a.width, height: a.height });

  for (const key of KEYS) {
    it(`${key}`, async () => {
      const { plan } = buildTemplatePlan({ spec: BUILTIN_TEMPLATES[key], listing, photos: fx.photos.map((p) => ({ id: p.row.id, width: p.width, height: p.height })), brand, agent });
      const doc = composeDocument({ plan, title: key, photos: info, music: [], brand: { primary_color: brand.primary_color, heading_font: "Montserrat", body_font: "Inter" }, logo: img(fx.logo), brandImages: [img(fx.logo), img(fx.brokerage), img(fx.headshot)] });
      expect(validateFableCutDocument(doc)).toEqual({ ok: true });
      const projectId = randomUUID();
      const stored = new Map<string, Uint8Array>();
      const r = await processJob({ id: randomUUID(), organization_id: org, project_id: projectId, aspect: plan.aspect, document: doc }, workerDeps(org, listingId, projectId, all, stored));
      expect(r.error ?? "").toBe("");
      const file = join(OUT, `${key}.mp4`);
      writeFileSync(file, [...stored.values()][0]!);
      const p = probe(file);
      const c = CANVAS_1080[plan.aspect];
      expect([p.width, p.height]).toEqual([c.width, c.height]);
      expect(Math.abs(p.durationSeconds - totalDuration(plan))).toBeLessThan(0.6);
      expect(spawnSync("ffmpeg", ["-v", "error", "-i", file, "-f", "null", "-"], { encoding: "utf8" }).stderr.trim()).toBe("");
      contactStrip(file, join(OUT, `${key}-strip.jpg`), totalDuration(plan), 8);
    }, 900_000);
  }
});
