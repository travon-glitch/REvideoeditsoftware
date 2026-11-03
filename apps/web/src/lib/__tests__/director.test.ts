import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { checkRenderDocument, allowedAssetsFor } from "@lvs/render-worker";
import { DirectorError, costCents, photoAnalysisRequest, runDirector, storyboardRequest, type CallClaude, type DirectorImage } from "@/lib/director/claude";
import { checkClaim, verifiedFacts } from "@/lib/director/facts";
import { compileStoryboard, photoRefs } from "@/lib/director/compile";
import type { PhotoAnalysis, Storyboard } from "@/lib/director/schema";
import { composeDocument, resolveScene } from "@/lib/video/plan";
import { validateFableCutDocument } from "@/lib/video/validate-document";
import type { ListingRow } from "@/lib/database.types";

const listing = {
  address_line: "742 Evergreen Terrace", city: "Springfield", state: "OR", price: 525000, bedrooms: 4, bathrooms: 2.5, square_feet: 2150,
  property_type: "single_family", status: "for_sale", agent_name: "Alice Agent", brokerage: "Acme Realty", contact_phone: "555-0100",
  contact_email: "alice@acme.test", description: "Updated kitchen with quartz counters and a wood-burning fireplace.",
  open_house_date: "2026-11-15", open_house_start: "13:00", open_house_end: "15:00",
} as unknown as ListingRow;
const facts = verifiedFacts(listing);
const images: DirectorImage[] = Array.from({ length: 6 }, (_, i) => ({ ref: `P0${i + 1}`, mediaType: "image/jpeg", base64: "AAAA" }));
const rooms = ["exterior", "living_room", "kitchen", "bedroom", "bathroom", "pool"] as const;
const analysis: PhotoAnalysis = {
  photos: images.map((img, i) => ({ ref: img.ref, room_type: rooms[i]!, description: "A room.", visible_features: [], quality: 8, opener_score: i === 0 ? 9 : 4, suggested_move: "push_in" })),
  property_summary: "A two-storey home.",
};
const storyboard = (over: Partial<Storyboard> = {}): Storyboard => ({
  title: "742 Evergreen Terrace", opening_photo: "P01",
  scenes: [
    { photo: "P01", seconds: 4, camera_move: "push_in", intensity: "gentle", transition: "fade", reason: "Best exterior." },
    { photo: "P02", seconds: 3.5, camera_move: "truck_right", intensity: "normal", transition: "fade", reason: "Living room." },
    { photo: "P03", seconds: 3, camera_move: "orbit_left", intensity: "normal", transition: "slide-left", reason: "Kitchen." },
    { photo: "P99", seconds: 3, camera_move: "pan_left", intensity: "normal", transition: "fade", reason: "Unknown." },
    { photo: "P06", seconds: 30, camera_move: "pull_out", intensity: "dramatic", transition: "fade", reason: "Pool." },
  ],
  text_overlays: [
    { scene: 0, text: "Just listed\n742 Evergreen Terrace", style: "title", position: "bottom", kind: "hook", fact_keys: ["address"] },
    { scene: 1, text: "4 bedrooms · 2.5 baths · 2,150 sq ft", style: "caption", position: "bottom", kind: "fact", fact_keys: ["bedrooms", "bathrooms", "square_feet"] },
    { scene: 2, text: "Quartz counters", style: "caption", position: "bottom", kind: "highlight", fact_keys: ["description"] },
    { scene: 2, text: "Brand-new roof (2024)", style: "caption", position: "bottom", kind: "highlight", fact_keys: [] },
    { scene: 4, text: "Sparkling pool", style: "banner", position: "bottom", kind: "room_label", fact_keys: [] },
    { scene: 1, text: "Perfect for families", style: "caption", position: "top", kind: "hook", fact_keys: [] },
    { scene: 1, text: "Only $499,000!", style: "banner", position: "top", kind: "fact", fact_keys: ["price"] },
  ],
  music_mood: "warm",
  call_to_action: "Call Alice Agent · 555-0100",
  highlights: ["4 bedrooms", "Wood-burning fireplace", "Ocean views"],
  captions: { instagram: "Just listed in Springfield, OR — $525,000.", facebook: "Open house Sun, Nov 15.", short: "742 Evergreen Terrace · $525,000" },
  ...over,
});

describe("verified facts and the claim checker", () => {
  it("only includes what the agent entered", () => {
    expect(facts).toMatchObject({ price: "$525,000", bedrooms: "4", bathrooms: "2.5", square_feet: "2,150 sq ft", open_house: expect.stringMatching(/Nov 15/) });
    expect(verifiedFacts({ ...listing, price: null, description: null } as ListingRow)).not.toHaveProperty("price");
  });
  it("rejects invented numbers, amenities and fair-housing phrases; accepts grounded ones", () => {
    const r = new Set(["exterior", "pool"] as const);
    expect(checkClaim("4 bedrooms · 2.5 baths · $525,000", facts, r).ok).toBe(true);
    expect(checkClaim("Only $499,000", facts, r).ok).toBe(false);
    expect(checkClaim("Built in 2024", facts, r).ok).toBe(false);
    expect(checkClaim("Quartz counters and a fireplace", facts, r).ok).toBe(true);   // in the description
    expect(checkClaim("Sparkling pool", facts, r).ok).toBe(true);                     // a pool photo exists
    expect(checkClaim("Sparkling pool", facts, new Set(["exterior"] as const)).ok).toBe(false);
    expect(checkClaim("3-car garage", facts, r).ok).toBe(false);
    expect(checkClaim("Ocean views", facts, r).ok).toBe(false);
    expect(checkClaim("Perfect for families", facts, r).ok).toBe(false);
    expect(checkClaim("Call 555-0100", facts, r).ok).toBe(true);
  });
});

describe("storyboard compiler", () => {
  const assetIds: string[] = images.map(() => randomUUID());
  const photos = photoRefs(assetIds);
  it("turns Claude's storyboard into a valid editor plan with valid photo references", () => {
    const c = compileStoryboard({ storyboard: storyboard(), analysis, photos, facts, style: "luxury" });
    expect(c.plan.aspect).toBe("16:9");
    expect(c.plan.scenes.map((s) => s.assetId)).toEqual([assetIds[0], assetIds[1], assetIds[2], assetIds[5]]);
    expect(c.plan.scenes.every((s) => assetIds.includes(s.assetId))).toBe(true);
    expect(c.plan.scenes[3]!.duration).toBe(10);          // 30 s clamped
    expect(c.plan.scenes[2]!.camera!.move).toBe("truck_left"); // orbit needs AI → honest Standard move
    expect(c.plan.transition).toBe("fade");
    const texts = c.plan.texts.map((t) => t.text);
    expect(texts).toEqual(expect.arrayContaining(["Just listed\n742 Evergreen Terrace", "4 bedrooms · 2.5 baths · 2,150 sq ft", "Quartz counters", "Sparkling pool"]));
    expect(texts.join(" ")).not.toMatch(/roof|families|499/);
    expect(c.plan.texts.find((t) => t.id === "t1")!.sceneId).toBe("@first");
    expect(c.director.highlights).toEqual(["4 bedrooms", "Wood-burning fireplace"]);
    expect(c.warnings.map((w) => w.kind)).toEqual(expect.arrayContaining(["unknown_photo", "camera_changed", "duration_adjusted", "removed_text", "removed_highlight"]));
    // the plan renders: valid FableCut document, only this listing's files
    const org = randomUUID(), lid = randomUUID();
    const info = assetIds.map((id) => ({ id, storage_path: `${org}/listings/${lid}/${id}.jpg`, file_name: "p.jpg", width: 1600, height: 1200 }));
    const doc = composeDocument({ plan: c.plan, title: "t", photos: info, music: [], brand: null });
    expect(validateFableCutDocument(doc).ok).toBe(true);
    const rows = info.map((p) => ({ id: p.id, organization_id: org, listing_id: lid, project_id: null, kind: "photo", bucket: "listing-media", storage_path: p.storage_path }));
    expect(checkRenderDocument(doc, allowedAssetsFor({ id: randomUUID(), organization_id: org, listing_id: lid, title: "t" }, rows))).toHaveLength(4);
  });
  it("moves the chosen opener to the front and adds the call to action at the end", () => {
    const sb = storyboard({ opening_photo: "P03", text_overlays: [] });
    const c = compileStoryboard({ storyboard: sb, analysis, photos, facts, style: "social" });
    expect(c.plan.scenes[0]!.assetId).toBe(assetIds[2]);
    expect(c.plan.aspect).toBe("9:16");
    expect(resolveScene(c.plan, c.plan.texts.find((t) => t.id === "t_cta")!.sceneId)!.id).toBe(c.plan.scenes.at(-1)!.id);
  });
  it("fails clearly when no photo reference is valid", () => {
    expect(() => compileStoryboard({ storyboard: storyboard({ scenes: [{ photo: "X1", seconds: 3, camera_move: "zoom", intensity: "normal", transition: "fade", reason: "" }] }), analysis, photos, facts, style: "modern" })).toThrow(/didn't use any/);
  });
});

describe("Claude requests", () => {
  it("sends every photo as a labelled image and asks for schema-checked JSON", () => {
    const r = photoAnalysisRequest("claude-opus-5-5", images);
    const content = r.messages[0]!.content as { type: string; text?: string }[];
    expect(content.filter((b) => b.type === "image")).toHaveLength(6);
    expect(content.filter((b) => b.type === "text" && /^Photo P0\d:$/.test(b.text!))).toHaveLength(6);
    expect(r.output_config?.format?.type).toBe("json_schema");
    expect(r).toMatchObject({ model: "claude-opus-5-5", thinking: { type: "adaptive" }, fallbacks: "default", betas: ["server-side-fallback-2026-07-01"] });
    expect(photoAnalysisRequest("claude-haiku-5-5", images)).not.toHaveProperty("fallbacks");
    const s = storyboardRequest("claude-opus-5-5", { style: "luxury", facts, analysis, photoCount: 6 });
    const text = String(s.messages[0]!.content);
    expect(text).toContain("<listing_facts>");
    expect(text).toContain("$525,000");
    expect(text).toMatch(/orbit_left \(needs AI video — avoid\)/);
  });

  it("runs both calls, validates them and adds up the usage", async () => {
    const calls: unknown[] = [];
    const call: CallClaude = async (params) => {
      calls.push(params);
      const body = calls.length === 1 ? analysis : storyboard();
      return { id: "m", type: "message", role: "assistant", model: params.model, stop_reason: "end_turn", stop_sequence: null, stop_details: null,
        content: [{ type: "text", text: JSON.stringify(body), citations: null }],
        usage: { input_tokens: 1000, output_tokens: 500, cache_creation_input_tokens: 100, cache_read_input_tokens: 50 } } as never;
    };
    const r = await runDirector(call, { model: "claude-opus-5-5", style: "luxury", facts, images });
    expect(calls).toHaveLength(2);
    expect(r.analysis.photos).toHaveLength(6);
    expect(r.usage).toEqual({ input_tokens: 2000, output_tokens: 1000, cache_creation_input_tokens: 200, cache_read_input_tokens: 100 });
    // $4/M in, $20/M out, cache write 1.25×, cache read 0.1×
    expect(costCents("claude-opus-5-5", r.usage)).toBeCloseTo(((2000 * 4 + 200 * 5 + 100 * 0.4 + 1000 * 20) / 1e6) * 100, 6);
  });

  it("turns refusals and broken JSON into friendly errors", async () => {
    const refuse: CallClaude = async (p) => ({ model: p.model, stop_reason: "refusal", content: [], usage: { input_tokens: 1, output_tokens: 1 } }) as never;
    await expect(runDirector(refuse, { model: "claude-opus-5-5", style: "luxury", facts, images })).rejects.toThrow(DirectorError);
    const junk: CallClaude = async (p) => ({ model: p.model, stop_reason: "end_turn", content: [{ type: "text", text: "{\"nope\":1}" }], usage: { input_tokens: 1, output_tokens: 1 } }) as never;
    await expect(runDirector(junk, { model: "claude-opus-5-5", style: "luxury", facts, images })).rejects.toThrow(/didn't match/);
  });
});
