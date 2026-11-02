import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CAMERA_MOVES } from "@lvs/camera-presets";
import { checkRenderDocument, allowedAssetsFor } from "@lvs/render-worker";
import { composeDocument, planSchema, totalDuration } from "@/lib/video/plan";
import {
  DURATIONS, STYLES, STYLE_IDS, autoDirector, buildEasyPlan, defaultSettings, orderPhotos, pickPhotos, type EasyListing,
} from "@/lib/video/easy";
import { validateFableCutDocument } from "@/lib/video/validate-document";
import { easyDetailsSchema } from "@/lib/validation";

const org = randomUUID(), listingId = randomUUID();
const photos = (n: number) => Array.from({ length: n }, () => {
  const id = randomUUID();
  return { id, storage_path: `${org}/listings/${listingId}/${id}.jpg`, file_name: `${id}.jpg`, width: 4000, height: 3000 };
});
const home = (over: Partial<EasyListing> = {}): EasyListing => ({
  address_line: "742 Evergreen Terrace", city: "Springfield", state: "OR", price: 525000, bedrooms: 4, bathrooms: 2.5,
  square_feet: 2400, property_type: "single_family", status: "for_sale", agent_name: "Alice Agent", brokerage: "Acme Realty",
  contact_phone: "555-0100", contact_email: "alice@example.com", open_house_text: null, cover_asset_id: null, ...over,
});
const brand = { company_name: "Acme Realty", outro_text: "Call today" };

describe("Easy Mode styles", () => {
  it("has the six styles, each a valid, renderable FableCut project in every length", () => {
    expect(STYLE_IDS).toEqual(["luxury", "modern", "just-listed", "open-house", "social-reel", "highlights"]);
    const ph = photos(20);
    for (const id of STYLE_IDS) {
      for (const duration of DURATIONS) {
        const plan = buildEasyPlan({ listing: home({ open_house_text: "Sun 1–3 PM" }), photos: ph, brand, settings: { ...defaultSettings(id), duration } });
        expect(planSchema.safeParse(plan).success, `${id} ${duration}`).toBe(true);
        expect(Math.abs(totalDuration(plan) - duration), `${id} ${duration}`).toBeLessThan(0.05);
        const doc = composeDocument({ plan, title: "Test", photos: ph, music: [], brand: null });
        expect(validateFableCutDocument(doc).ok, `${id} ${duration}`).toBe(true);
        const rows = ph.map((p) => ({ id: p.id, organization_id: org, listing_id: listingId, project_id: null, kind: "photo", bucket: "listing-media", storage_path: p.storage_path }));
        const files = checkRenderDocument(doc, allowedAssetsFor({ id: randomUUID(), organization_id: org, listing_id: listingId, title: "t" }, rows));
        expect(files.length, `${id} ${duration}`).toBe(plan.scenes.length);
      }
    }
  });

  it("uses each style's own shape, transition and plain-English camera moves", () => {
    const ph = photos(10);
    const reel = buildEasyPlan({ listing: home(), photos: ph, brand, settings: defaultSettings("social-reel") });
    expect(reel.aspect).toBe("9:16");
    expect(totalDuration(reel)).toBeCloseTo(15, 1);
    const lux = buildEasyPlan({ listing: home(), photos: ph, brand, settings: defaultSettings("luxury") });
    expect(lux.transition).toBe("fade");
    for (const s of lux.scenes) expect(s.duration).toBeGreaterThanOrEqual(STYLES.luxury.minScene - 0.01);
    const names = new Set(CAMERA_MOVES.map((m) => m.id));
    for (const s of [...reel.scenes, ...lux.scenes]) expect(names.has(s.move)).toBe(true);
  });

  it("writes real listing facts into the text — nothing invented", () => {
    const ph = photos(8);
    const jl = buildEasyPlan({ listing: home(), photos: ph, brand, settings: defaultSettings("just-listed") });
    const all = jl.texts.map((t) => t.text).join("\n");
    expect(all).toContain("JUST LISTED");
    expect(all).toContain("742 Evergreen Terrace");
    expect(all).toContain("$525,000");
    expect(all).toContain("Alice Agent");
    const bare = buildEasyPlan({ listing: home({ price: null, bedrooms: null, bathrooms: null, square_feet: null }), photos: ph, brand: null, settings: defaultSettings("highlights") });
    expect(bare.texts.map((t) => t.text).join("\n")).not.toMatch(/\$|bedroom|sq ft/);
    const noBrand = buildEasyPlan({ listing: home(), photos: ph, brand, settings: { ...defaultSettings("modern"), showBranding: false } });
    expect(noBrand.texts.some((t) => t.id === "t_outro")).toBe(false);
  });

  it("opens with the main photo, or follows the order the person chose", () => {
    const ph = photos(6);
    const withCover = buildEasyPlan({ listing: home({ cover_asset_id: ph[3]!.id }), photos: ph, brand, settings: defaultSettings("modern") });
    expect(withCover.scenes[0]!.assetId).toBe(ph[3]!.id);
    const order = [ph[5]!.id, ph[0]!.id];
    const chosen = buildEasyPlan({ listing: home({ cover_asset_id: ph[3]!.id }), photos: ph, brand, settings: defaultSettings("modern"), order });
    expect(chosen.scenes.slice(0, 2).map((s) => s.assetId)).toEqual(order);
    expect(chosen.easy.order).toEqual(order);
    expect(orderPhotos(ph, order).map((p) => p.id).slice(2)).toEqual([1, 2, 3, 4].map((i) => ph[i]!.id));
  });

  it("keeps an even spread of photos when there isn't time for all of them", () => {
    const ph = photos(30);
    const picked = pickPhotos(ph, null, 15, 1.5);
    expect(picked).toHaveLength(10);
    expect(picked[0]).toBe(ph[0]);
    expect(picked.at(-1)).toBe(ph[29]);
  });
});

describe("Auto Create (rule-based storyboard maker)", () => {
  it("chooses from listing facts and explains every choice", () => {
    expect(autoDirector({ listing: home({ open_house_text: "Sat 1–3 PM" }), photoCount: 12, musicAssetIds: [] }).settings.style).toBe("open-house");
    expect(autoDirector({ listing: home(), photoCount: 12, musicAssetIds: [] }).settings.style).toBe("just-listed");
    expect(autoDirector({ listing: home({ status: "sold", price: 2_000_000 }), photoCount: 12, musicAssetIds: [] }).settings.style).toBe("luxury");
    expect(autoDirector({ listing: home({ status: "sold", price: null }), photoCount: 12, musicAssetIds: [] }).settings.style).toBe("highlights");
    const bare = autoDirector({ listing: home({ status: "sold", price: null, bedrooms: null, bathrooms: null, square_feet: null }), photoCount: 5, musicAssetIds: [] });
    expect(bare.settings).toMatchObject({ style: "modern", duration: 15, musicAssetId: null, aiEffects: false });
    const music = randomUUID();
    const big = autoDirector({ listing: home(), photoCount: 20, musicAssetIds: [music] });
    expect(big.settings).toMatchObject({ duration: 60, musicAssetId: music });
    expect(big.reasons.length).toBeGreaterThanOrEqual(4);
    expect(big.reasons.join(" ")).not.toMatch(/dolly|keyframe|codec|fps/i);
  });
});

describe("Easy Mode details", () => {
  it("validates only the fields that were sent", () => {
    expect(easyDetailsSchema.partial().parse({ address_line: " 1 Oak St " })).toEqual({ address_line: "1 Oak St" });
    expect(easyDetailsSchema.partial().parse({ price: "$450,000" })).toEqual({ price: 450000 });
    expect(easyDetailsSchema.partial().safeParse({ contact_email: "nope" }).success).toBe(false);
  });
});
