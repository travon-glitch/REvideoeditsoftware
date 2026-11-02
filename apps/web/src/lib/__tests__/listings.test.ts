import { describe, expect, it } from "vitest";
import {
  MAX_PHOTOS, formatOpenHouse, isReady, moveItem, orderForVideo, planUpload, readinessChecklist,
} from "@/lib/listings";
import { listingDraftSchema } from "@/lib/validation";
import { buildStarterDocument } from "@/lib/video/starter-document";
import { validateFableCutDocument } from "@/lib/video/validate-document";

const jpg = (name: string, size = 1000) => ({ name, type: "image/jpeg", size });

describe("upload planning", () => {
  it("accepts 20 photos at once", () => {
    const files = Array.from({ length: 20 }, (_, i) => jpg(`p${i}.jpg`));
    const plan = planUpload(0, files);
    expect(plan.accepted).toHaveLength(20);
    expect(plan.rejected).toHaveLength(0);
  });

  it("never goes past 30 photos and explains why", () => {
    const plan = planUpload(25, Array.from({ length: 8 }, (_, i) => jpg(`p${i}.jpg`)));
    expect(plan.accepted).toHaveLength(5);
    expect(plan.rejected).toHaveLength(3);
    expect(plan.rejected[0]!.reason).toMatch(/up to 30/);
    expect(planUpload(MAX_PHOTOS, [jpg("x.jpg")]).accepted).toHaveLength(0);
  });

  it("skips files that aren't photos, without using up a slot", () => {
    const plan = planUpload(29, [{ name: "x.svg", type: "image/svg+xml", size: 10 }, { name: "big.jpg", type: "image/jpeg", size: 60 * 1024 * 1024 }, jpg("ok.jpg")]);
    expect(plan.accepted.map((f) => f.name)).toEqual(["ok.jpg"]);
    expect(plan.rejected.map((r) => r.file.name)).toEqual(["x.svg", "big.jpg"]);
  });
});

describe("rearranging", () => {
  it("moves one photo and keeps the rest in order", () => {
    expect(moveItem(["a", "b", "c", "d"], 3, 0)).toEqual(["d", "a", "b", "c"]);
    expect(moveItem(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveItem(["a", "b"], 0, 5)).toEqual(["a", "b"]);
  });

  it("puts the main photo first in the video", () => {
    const photos = [{ id: "1" }, { id: "2" }, { id: "3" }];
    expect(orderForVideo(photos, "3").map((p) => p.id)).toEqual(["3", "1", "2"]);
    expect(orderForVideo(photos, null).map((p) => p.id)).toEqual(["1", "2", "3"]);
    expect(orderForVideo(photos, "missing").map((p) => p.id)).toEqual(["1", "2", "3"]);
  });
});

describe("Save and Continue checklist", () => {
  const base = { address_line: "", city: null, state: null, price: null, description: null, agent_name: null, photoCount: 0, hasCover: false };
  it("requires only an address and 5–30 photos", () => {
    expect(isReady(readinessChecklist(base))).toBe(false);
    expect(isReady(readinessChecklist({ ...base, address_line: "1 Main St", photoCount: 4 }))).toBe(false);
    expect(isReady(readinessChecklist({ ...base, address_line: "1 Main St", photoCount: 5 }))).toBe(true);
    expect(isReady(readinessChecklist({ ...base, address_line: "1 Main St", photoCount: 31 }))).toBe(false);
  });
});

describe("draft form", () => {
  it("saves an empty draft", () => {
    const r = listingDraftSchema.parse({});
    expect(r.address_line).toBe("");
    expect(r.price).toBeNull();
    expect(r.property_type).toBeNull();
  });

  it("keeps every field", () => {
    const r = listingDraftSchema.parse({
      address_line: " 742 Evergreen Terrace ", city: "Springfield", state: "OR", postal_code: "97403", price: "$525,000",
      bedrooms: "4", bathrooms: "2.5", square_feet: "2150", property_type: "single_family", description: "Nice",
      agent_name: "Alice Test", brokerage: "Acme Realty", contact_phone: "(555) 010-0100", contact_email: "Alice@Acme.test",
      open_house_date: "2026-11-15", open_house_start: "13:00", open_house_end: "15:00",
    });
    expect(r).toMatchObject({
      address_line: "742 Evergreen Terrace", postal_code: "97403", price: 525000, bathrooms: 2.5, square_feet: 2150,
      property_type: "single_family", contact_email: "alice@acme.test", open_house_start: "13:00", open_house_end: "15:00",
    });
  });

  it("flags only the fields that are wrong", () => {
    const r = listingDraftSchema.safeParse({ postal_code: "9740", contact_email: "nope", contact_phone: "call me", property_type: "castle", open_house_start: "15:00", open_house_end: "13:00" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.map((i) => i.path.join(".")).sort()).toEqual(["contact_email", "contact_phone", "postal_code", "property_type"].sort());
    }
    const times = listingDraftSchema.safeParse({ open_house_start: "15:00", open_house_end: "13:00" });
    expect(times.success).toBe(false);
  });

  it("formats the open house for people and for the video", () => {
    expect(formatOpenHouse("2026-11-15", "13:00", "15:00")).toBe("Sun, Nov 15 · 1:00 PM – 3:00 PM");
    expect(formatOpenHouse("2026-11-15", null, null)).toBe("Sun, Nov 15");
    expect(formatOpenHouse(null, "13:00", null)).toBeNull();
  });
});

describe("listing information flows into the video", () => {
  it("adds the agent, contact and open house, and FableCut accepts the document", () => {
    const photos = Array.from({ length: 6 }, (_, i) => ({
      id: `aaaaaaaa-aaaa-4aaa-8aaa-00000000000${i}`, storage_path: `o/listings/l/${i}.jpg`, file_name: `${i}.jpg`, width: 4000, height: 3000,
    }));
    const doc = buildStarterDocument({
      title: "t", aspect: "16:9", photos, template: { slug: "modern", style: {} },
      brand: { company_name: "Acme", primary_color: "#1D4ED8", heading_font: "Inter", body_font: "Inter", outro_text: "acme.test" },
      listing: {
        address_line: "742 Evergreen Terrace", city: "Springfield", state: "OR", price: 525000, bedrooms: 4, bathrooms: 2.5, square_feet: 2150,
        agent_name: "Alice Test", brokerage: "Acme Realty", contact_phone: "555-0100", contact_email: null, open_house_text: "Sun, Nov 15 · 1:00 PM – 3:00 PM",
      },
    }) as { clips: { id: string; props?: { text?: string } }[] };
    const text = (id: string) => doc.clips.find((c) => c.id === id)?.props?.text;
    expect(text("c_open_house")).toBe("OPEN HOUSE\nSun, Nov 15 · 1:00 PM – 3:00 PM");
    expect(text("c_outro")).toBe("Alice Test · Acme Realty\n555-0100\nacme.test");
    expect(validateFableCutDocument(doc as unknown as Record<string, unknown>)).toEqual({ ok: true });
  });
});
