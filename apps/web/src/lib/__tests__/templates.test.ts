import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  BUILTIN_TEMPLATES, TEMPLATE_KEYS, buildTemplatePlan, recommendTemplate, supportedClaims, templateSpecSchema,
  type TemplateAgent, type TemplateBrand, type TemplateListing,
} from "@/lib/video/templates";
import { composeDocument, planSchema, totalDuration } from "@/lib/video/plan";
import { brandWindows } from "@/lib/video/brand-layers";
import { validateFableCutDocument } from "@/lib/video/validate-document";

const photos = Array.from({ length: 16 }, (_, i) => ({ id: randomUUID(), width: i % 5 === 0 ? 1200 : 1600, height: i % 5 === 0 ? 1600 : 1200 }));
const listing: TemplateListing = {
  address_line: "742 Evergreen Terrace", city: "Springfield", state: "OR", price: 525000, previous_price: null,
  bedrooms: 4, bathrooms: 2.5, square_feet: 2150, property_type: "single_family", status: "for_sale", mls_number: "OR-1234",
  description: "Sunny home with a big kitchen.", open_house_text: null, cover_asset_id: photos[0]!.id,
};
const logo = { id: randomUUID(), storage_path: `org/brand/${randomUUID()}.png`, width: 600, height: 240 };
const brokerage = { id: randomUUID(), storage_path: `org/brand/${randomUUID()}.png`, width: 500, height: 200 };
const headshot = { id: randomUUID(), storage_path: `org/agents/${randomUUID()}.jpg`, width: 600, height: 800 };
const brand: TemplateBrand = {
  primary_color: "#1D4ED8", secondary_color: "#0F172A", accent_color: "#F59E0B", heading_font: "Montserrat", body_font: "Inter",
  company_name: "Acme Realty", logoAssetId: logo.id, brokerageLogoAssetId: brokerage.id,
  intro_style: "logo-reveal", outro_style: "agent-card", agent_layout: "photo-left", disclosure: "Acme Realty, licensed real estate broker. Equal Housing Opportunity.",
};
const agent: TemplateAgent = { name: "Alice Agent", title: "Listing Agent", phone: "555-0100", email: "alice@acme.test", brokerage: "Acme Realty", license: "Lic. #01234567", headshotAssetId: headshot.id };
const photoInfo = photos.map((p) => ({ id: p.id, storage_path: `org/listings/l/${p.id}.jpg`, file_name: "p.jpg", width: p.width, height: p.height }));

function compose(key: (typeof TEMPLATE_KEYS)[number], opts: Partial<Parameters<typeof buildTemplatePlan>[0]> = {}) {
  const r = buildTemplatePlan({ spec: BUILTIN_TEMPLATES[key], listing, photos, brand, agent, ...opts });
  const doc = composeDocument({ plan: r.plan, title: key, photos: photoInfo, music: [], brand: { primary_color: brand.primary_color, heading_font: "Montserrat", body_font: "Inter" }, logo, brandImages: [logo, brokerage, headshot] });
  return { ...r, doc, clips: doc.clips as { id: string; kind: string; track: string; start: number; duration: number; props: Record<string, unknown> }[] };
}

describe("Stage 11 templates", () => {
  it("defines the fifteen templates with valid, distinct specs", () => {
    expect(TEMPLATE_KEYS).toHaveLength(15);
    for (const k of TEMPLATE_KEYS) expect(() => templateSpecSchema.parse(BUILTIN_TEMPLATES[k]), k).not.toThrow();
    expect(new Set(TEMPLATE_KEYS.map((k) => BUILTIN_TEMPLATES[k].name)).size).toBe(15);
  });

  for (const key of TEMPLATE_KEYS) {
    it(`${key}: builds a real plan that FableCut accepts (scenes, moves, transitions, type, branding)`, () => {
      const { plan, doc, clips } = compose(key);
      const spec = BUILTIN_TEMPLATES[key];
      expect(() => planSchema.parse(plan)).not.toThrow();
      expect(validateFableCutDocument(doc), key).toEqual({ ok: true });
      expect(plan.scenes.length).toBeGreaterThanOrEqual(3);
      expect(Math.abs(totalDuration(plan) - spec.duration)).toBeLessThanOrEqual(spec.sceneSeconds + 1);
      expect(plan.transition).toBe(spec.transition);
      expect(plan.scenes.every((s) => !!s.camera)).toBe(true); // every scene moves
      expect(plan.look?.headingFont).toBe(spec.look.headingFont);
      // typography reaches the document
      const titles = clips.filter((c) => c.kind === "text" && c.id.startsWith("c_text_"));
      expect(titles.length).toBeGreaterThan(0);
      expect(titles.some((c) => c.props.font === spec.look.headingFont || c.props.font === spec.look.bodyFont)).toBe(true);
      // agent card or end card in the outro, disclosure on the last scene
      expect(clips.some((c) => c.id === "c_brand_disclosure")).toBe(true);
      expect(clips.some((c) => c.id.startsWith("c_brand_agent_name") || c.id.startsWith("c_brand_outro"))).toBe(true);
      // no text on the last scene runs into the outro
      const w = brandWindows(plan);
      if (w.outro) for (const c of titles) expect(c.start + c.duration, c.id).toBeLessThanOrEqual(w.outro[0] + 0.01 + (c.start >= w.outro[0] ? 99 : 0));
    });
  }

  it("Just Listed puts the listing's own facts and the agent on screen", () => {
    const { plan, clips } = compose("just-listed");
    const words = plan.texts.map((t) => t.text).join(" | ");
    expect(words).toContain("Just Listed");
    expect(words).toContain("742 Evergreen Terrace");
    expect(words).toContain("$525,000");
    expect(words).toContain("4 beds");
    const agentText = clips.filter((c) => c.id.startsWith("c_brand_agent")).map((c) => String(c.props.text)).join(" | ");
    expect(agentText).toContain("ALICE AGENT");
    expect(agentText).toContain("555-0100");
    expect(clips.some((c) => c.id === "c_brand_headshot")).toBe(true);
    expect(clips.some((c) => c.id === "c_brand_brokerage_logo")).toBe(true);
    expect(clips.some((c) => c.id === "c_brand_intro_bar")).toBe(true); // template intro: bar wipe
    // the first text waits for the intro
    expect(plan.texts.find((t) => t.sceneId === "@first")?.offset).toBeGreaterThan(0);
  });

  it("templates differ in structure, timing and look", () => {
    const fingerprints = TEMPLATE_KEYS.map((k) => {
      const { plan } = compose(k);
      return [plan.aspect, plan.transition, plan.scenes.length, Math.round(totalDuration(plan)), plan.look?.headingFont, plan.look?.filter, plan.texts.map((t) => t.style).join("")].join("|");
    });
    expect(new Set(fingerprints).size).toBe(15);
  });

  it("never invents facts: claims the listing doesn't support become warnings", () => {
    expect(compose("waterfront-home").warnings.map((w) => w.kind)).toContain("claim");
    expect(compose("just-sold").warnings.some((w) => /Sold/.test(w.message))).toBe(true);
    const reduced = compose("price-reduced");
    expect(reduced.plan.texts.map((t) => t.text).join(" ")).not.toContain("Was");
    const real = compose("price-reduced", { listing: { ...listing, previous_price: 560000 } });
    expect(real.plan.texts.map((t) => t.text).join(" ")).toContain("Was $560,000");
    expect(real.warnings.filter((w) => w.kind === "claim")).toHaveLength(0);
    const oh = compose("open-house");
    expect(oh.plan.texts.map((t) => t.text).join(" ")).toContain("Ask us for a showing");
  });

  it("without an agent the end card falls back to the company, with a warning", () => {
    const { plan, warnings } = compose("just-listed", { agent: null });
    expect(plan.branding?.outro.style).toBe("logo-end");
    expect(warnings.some((w) => w.kind === "missing")).toBe(true);
  });

  it("administrator rules: locked fonts and colours, required agent card", () => {
    const { plan } = compose("luxury-listing", { rules: { requireLogo: true, requireDisclosure: true, requireAgentCard: true, lockFonts: true, lockColors: true } });
    expect(plan.look?.headingFont).toBe("Montserrat");
    expect(plan.look?.accent).toBe(brand.primary_color);
    expect(plan.branding?.outro.style).toBe("agent-card");
    expect(plan.logoAssetId).toBe(logo.id);
  });

  it("recommends a template from the listing", () => {
    expect(recommendTemplate({ ...listing, status: "sold" }).key).toBe("just-sold");
    expect(recommendTemplate({ ...listing, status: "for_rent" }).key).toBe("rental-property");
    expect(recommendTemplate({ ...listing, open_house_text: "Sun 1–3 PM" }).key).toBe("open-house");
    expect(recommendTemplate({ ...listing, previous_price: 600000 }).key).toBe("price-reduced");
    expect(recommendTemplate({ ...listing, description: "Private dock on the lake" }).key).toBe("waterfront-home");
    expect(recommendTemplate({ ...listing, price: 2_400_000 }).key).toBe("luxury-listing");
    expect(recommendTemplate({ ...listing, created_at: new Date().toISOString() }).key).toBe("just-listed");
    expect(recommendTemplate({ ...listing, created_at: "2020-01-01" }).key).toBe("property-highlights");
    expect(recommendTemplate(listing, { defaults: { for_sale: "modern-home" } }).key).toBe("modern-home");
    expect(recommendTemplate({ ...listing, status: "sold" }, { available: ["just-listed", "property-highlights"] }).key).toBe("property-highlights");
    expect(supportedClaims({ ...listing, description: "Brand-new construction by a local builder" }).has("new-construction")).toBe(true);
  });
});
