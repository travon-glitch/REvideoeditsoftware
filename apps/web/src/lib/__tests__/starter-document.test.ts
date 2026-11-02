import { describe, expect, it } from "vitest";
import { buildStarterDocument, specsLine } from "@/lib/video/starter-document";
import { validateFableCutDocument } from "@/lib/video/validate-document";

const photos = Array.from({ length: 5 }, (_, i) => ({
  id: `aaaaaaaa-aaaa-4aaa-8aaa-00000000000${i}`,
  storage_path: `org/listings/l/aaaaaaaa-aaaa-4aaa-8aaa-00000000000${i}.jpg`,
  file_name: `room-${i}.jpg`,
  width: 4000,
  height: 3000,
}));
const listing = { address_line: "12 Oak Lane", city: "Austin", state: "TX", price: 450000, bedrooms: 3, bathrooms: 2, square_feet: 1850 };
const brand = { company_name: "Acme Realty", primary_color: "#1D4ED8", heading_font: "Montserrat", body_font: "Inter", outro_text: "Call 555-0100" };

describe("starter FableCut document", () => {
  it("passes FableCut's own project validation (vendored upstream checkProject)", () => {
    const doc = buildStarterDocument({ title: "12 Oak Lane — Luxury", aspect: "16:9", listing, photos, template: { slug: "luxury", style: { pace: "slow" } }, brand });
    expect(validateFableCutDocument(doc)).toEqual({ ok: true });
  });

  it("makes one camera-moved scene per photo plus title cards", () => {
    const doc = buildStarterDocument({ title: "t", aspect: "9:16", listing, photos, template: { slug: "modern", style: { pace: "medium" } }, brand }) as {
      width: number; height: number; clips: { kind: string; track: string; start: number; keyframes?: Record<string, unknown>; props?: { text?: string } }[];
    };
    expect([doc.width, doc.height]).toEqual([1080, 1920]);
    const scenes = doc.clips.filter((c) => c.kind === "image");
    expect(scenes).toHaveLength(5);
    expect(scenes.every((c) => c.track === "V1" && c.keyframes && "scale" in c.keyframes)).toBe(true);
    expect(scenes.map((c) => c.start)).toEqual([0, 3.5, 7, 10.5, 14]);
    const texts = doc.clips.filter((c) => c.kind === "text").map((c) => c.props?.text);
    expect(texts[0]).toBe("12 Oak Lane\nAustin, TX");
    expect(texts[1]).toContain("$450,000");
    expect(texts[2]).toBe("Acme Realty\nCall 555-0100");
  });

  it("is rejected by FableCut when a clip points at missing media", () => {
    const doc = buildStarterDocument({ title: "t", aspect: "1:1", listing, photos, template: { slug: "x", style: {} }, brand: null }) as { media: unknown[] };
    doc.media = [];
    const r = validateFableCutDocument(doc as Record<string, unknown>);
    expect(r.ok).toBe(false);
  });

  it("writes specs in plain words", () => {
    expect(specsLine(listing)).toBe("3 bd  ·  2 ba  ·  1,850 sq ft");
    expect(specsLine({ ...listing, bedrooms: null, bathrooms: null, square_feet: null })).toBe("");
  });
});
