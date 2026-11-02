import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { checkRenderDocument, allowedAssetsFor } from "@lvs/render-worker";
import { BATCH_TYPES, BATCH_TYPE_INFO, analyzeListing, buildBatch, buildBatchPlan, spread, structureOf } from "@/lib/video/batch";
import { composeDocument, resolveScene, totalDuration } from "@/lib/video/plan";
import { validateFableCutDocument } from "@/lib/video/validate-document";
import type { EasyListing } from "@/lib/video/easy";

const org = randomUUID(), listingId = randomUUID();
const photos = (n: number) => Array.from({ length: n }, (_, i) => {
  const id = randomUUID();
  return { id, storage_path: `${org}/listings/${listingId}/${id}.jpg`, file_name: `p${i}.jpg`, width: i % 5 === 4 ? 1200 : 1600, height: i % 5 === 4 ? 1600 : 1200 };
});
const home = (over: Partial<EasyListing> = {}): EasyListing => ({
  address_line: "742 Evergreen Terrace", city: "Springfield", state: "OR", price: 525000, bedrooms: 4, bathrooms: 2.5,
  square_feet: 2150, property_type: "single_family", status: "for_sale", agent_name: "Alice Agent", brokerage: "Acme Realty",
  contact_phone: "555-0100", contact_email: "alice@acme.test", open_house_text: "Sun, Nov 15 · 1:00 PM – 3:00 PM", cover_asset_id: null, ...over,
});
const brand = { company_name: "Acme Realty", outro_text: "Call today" };

describe("Generate 6 Videos", () => {
  it("analyzes the listing in plain English", () => {
    const a = analyzeListing(home(), photos(20));
    expect(a).toMatchObject({ photoCount: 20, landscapePhotos: 16, priceTier: "standard", hasOpenHouse: true, hasAgent: true, hasContact: true });
    expect(a.facts).toEqual(["4 bedrooms", "2.5 bathrooms", "2,150 sq ft", "Single Family"]);
    const bare = analyzeListing(home({ price: null, open_house_text: null, bedrooms: null, bathrooms: null, square_feet: null, property_type: null }), photos(6));
    expect(bare.notes.join(" ")).toMatch(/No price/);
    expect(bare.notes.join(" ")).toMatch(/no date is made up/);
  });

  it("builds six valid, renderable storyboards from 20 photos", () => {
    const ph = photos(20);
    const batch = buildBatch({ listing: home(), photos: ph, brand });
    expect(batch.map((b) => b.type)).toEqual([...BATCH_TYPES]);
    for (const { type, plan } of batch) {
      expect(plan.aspect).toBe(BATCH_TYPE_INFO[type].aspect);
      const doc = composeDocument({ plan, title: type, photos: ph, music: [], brand: null });
      expect(validateFableCutDocument(doc).ok, type).toBe(true);
      const rows = ph.map((p) => ({ id: p.id, organization_id: org, listing_id: listingId, project_id: null, kind: "photo", bucket: "listing-media", storage_path: p.storage_path }));
      expect(checkRenderDocument(doc, allowedAssetsFor({ id: randomUUID(), organization_id: org, listing_id: listingId, title: "t" }, rows)).length).toBeGreaterThan(0);
    }
  });

  it("gives every video a meaningfully different structure, hook and opening photo", () => {
    const batch = buildBatch({ listing: home(), photos: photos(20), brand });
    expect(new Set(batch.map((b) => structureOf(b.plan))).size).toBe(6);
    const hook = (i: number) => batch[i]!.plan.texts.find((x) => resolveScene(batch[i]!.plan, x.sceneId)?.id === batch[i]!.plan.scenes[0]!.id)?.text;
    expect(new Set(batch.map((_, i) => hook(i))).size).toBe(6);
    expect(new Set(batch.map((b) => b.plan.scenes[0]!.assetId)).size).toBeGreaterThanOrEqual(4);
    const len = Object.fromEntries(batch.map((b) => [b.type, totalDuration(b.plan)]));
    expect(len["just-listed-reel"]).toBe(15);
    expect(len["cinematic-tour"]).toBeGreaterThan(45);
    expect(new Set(batch.map((b) => b.plan.transition)).size).toBeGreaterThanOrEqual(5);
    expect(new Set(batch.map((b) => b.plan.aspect))).toEqual(new Set(["16:9", "9:16", "1:1"]));
  });

  it("uses only facts from the listing", () => {
    const plan = buildBatchPlan({ type: "open-house", listing: home({ open_house_text: null, price: null }), photos: photos(10), brand: null });
    const text = plan.texts.map((x) => x.text).join("\n");
    expect(text).not.toMatch(/\$|OPEN HOUSE/);
    expect(text).toMatch(/Ask us for a showing/);
    const hl = buildBatchPlan({ type: "highlights", listing: home(), photos: photos(10), brand });
    expect(hl.texts.map((x) => x.text)).toEqual(expect.arrayContaining(["1  ·  4 bedrooms", "2  ·  2.5 bathrooms"]));
  });

  it("works with few photos, keeps saved Camera Studio moves, and regenerates differently", () => {
    const few = photos(5);
    for (const type of BATCH_TYPES) expect(buildBatchPlan({ type, listing: home(), photos: few, brand }).scenes.length).toBeGreaterThan(0);
    const ph = photos(20);
    ph[0] = { ...ph[0]!, camera: { ...buildBatchPlan({ type: "luxury", listing: home(), photos: ph, brand }).scenes[0]!.camera!, move: "zoom" } } as typeof ph[0];
    const tour = buildBatchPlan({ type: "cinematic-tour", listing: home(), photos: ph, brand });
    expect(tour.scenes[0]!.camera!.move).toBe("zoom");
    const a = buildBatchPlan({ type: "just-listed-reel", listing: home(), photos: ph, brand, variation: 0 });
    const b = buildBatchPlan({ type: "just-listed-reel", listing: home(), photos: ph, brand, variation: 1 });
    expect(a.scenes.map((s) => s.assetId)).not.toEqual(b.scenes.map((s) => s.assetId));
  });

  it("spreads photos evenly without repeats", () => {
    expect(spread([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 4)).toEqual([1, 4, 7, 10]);
    expect(spread([1, 2, 3], 5)).toEqual([1, 2, 3]);
  });
});
