/*
 * Real-estate video templates (Stage 11).
 *
 * A template is data (TemplateSpec): scene structure, camera moves, transitions,
 * typography and animations, which listing facts appear where, intro/outro and the
 * agent card. buildTemplatePlan() turns template + listing + photos + brand kit +
 * agent profile into the same EditPlan every other part of the app renders, so a
 * template always produces a real FableCut document and a real MP4.
 *
 * Fifteen built-in templates are defined below. Companies get their own copies
 * (video_templates rows) which administrators can edit, approve, disable and assign
 * as defaults; new templates start from one of these built-in structures.
 *
 * Facts rule: everything shown about the property comes from the listing. Template
 * words that make a claim (waterfront, new construction, price reduced, sold) are
 * flagged as warnings when the listing doesn't back them up.
 */
import { z } from "zod";
import { DEFAULT_GIMBAL, INTENSITY_STRENGTH, defaultSpec, getStudioMove, type CameraSpec, type StudioMoveId } from "@lvs/camera-presets";
import {
  AGENT_LAYOUTS, ASPECTS, BRAND_FONTS, FIRST_SCENE, INTRO_STYLES, LAST_SCENE, MAX_SCENES, OUTRO_STYLES, PHOTO_FILTERS, STILL, TEXT_ANIMS,
  TRANSITIONS, planSchema,
  type AgentCard, type AgentLayout, type Aspect, type EditPlan, type IntroStyle, type OutroStyle, type PlanBranding, type PlanLook, type Scene, type TextOverlay,
} from "./plan";
import type { MusicMood } from "./batch";
import type { AgentProfileRow, BrandKitRow, ListingRow } from "@/lib/database.types";
import { formatOpenHouse } from "@/lib/listings";

export const TEMPLATE_KEYS = [
  "just-listed", "luxury-listing", "modern-home", "open-house", "price-reduced", "coming-soon", "just-sold", "property-highlights",
  "investment-property", "rental-property", "waterfront-home", "new-construction", "twilight-tour", "agent-introduction", "cinematic-reveal",
] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

/** What a template can put on screen. All of it comes from the listing, the agent profile or the template's own words. */
export const SLOTS = [
  "badge", "headline", "address", "price", "new-price", "specs", "facts-each", "open-house", "rent", "property-type", "mls", "cta", "presented-by",
] as const;
export type Slot = (typeof SLOTS)[number];
export const SCENE_REFS = ["first", "second", "third", "middle", "last", "each"] as const;
export const MUSIC_MOODS = ["elegant", "calm", "upbeat", "warm", "inspiring"] as const;
export const OPENERS = ["cover", "wide", "last"] as const;
export const COLOR_REFS = ["brand-primary", "brand-secondary", "brand-accent"] as const;
const colorRef = z.union([z.enum(COLOR_REFS), z.string().regex(/^#[0-9a-fA-F]{6}$/)]);

/** Standard (2D) moves only: templates never need AI to render. */
export const TEMPLATE_MOVES = ["push_in", "pull_out", "pan_left", "pan_right", "tilt_up", "tilt_down", "zoom", "truck_left", "truck_right"] as const satisfies readonly StudioMoveId[];

export const beatSchema = z.object({
  slot: z.enum(SLOTS),
  scene: z.enum(SCENE_REFS),
  style: z.enum(["title", "caption", "banner"]),
  position: z.enum(["top", "center", "bottom"]),
  /** Seconds after the scene starts (after the intro on the first scene). */
  offset: z.number().min(0).max(6).optional(),
  duration: z.number().min(1).max(12).optional(),
});
export type Beat = z.infer<typeof beatSchema>;

export const templateSpecSchema = z.object({
  /** The built-in structure this template is based on. */
  recipe: z.enum(TEMPLATE_KEYS),
  name: z.string().trim().min(2).max(60),
  usage: z.string().trim().min(3).max(200),
  description: z.string().trim().max(300),
  aspect: z.enum(ASPECTS),
  duration: z.number().int().min(10).max(90),
  heroSeconds: z.number().min(2.5).max(8),
  sceneSeconds: z.number().min(1.5).max(6),
  endSeconds: z.number().min(3).max(8),
  maxScenes: z.number().int().min(3).max(MAX_SCENES),
  opener: z.enum(OPENERS),
  moves: z.array(z.enum(TEMPLATE_MOVES)).min(1).max(6),
  intensity: z.enum(["gentle", "normal", "dramatic"]),
  transition: z.enum(TRANSITIONS),
  look: z.object({
    headingFont: z.enum(BRAND_FONTS),
    bodyFont: z.enum(BRAND_FONTS),
    titleAnim: z.enum(TEXT_ANIMS),
    captionAnim: z.enum(TEXT_ANIMS),
    bannerAnim: z.enum(TEXT_ANIMS),
    uppercase: z.boolean(),
    letterSpacing: z.number().min(0).max(24),
    accent: colorRef,
    panel: colorRef,
    text: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    filter: z.enum(PHOTO_FILTERS),
    letterbox: z.boolean(),
  }),
  badge: z.string().trim().max(40),
  headline: z.string().trim().max(80),
  callToAction: z.string().trim().max(80),
  beats: z.array(beatSchema).min(1).max(12),
  /** "brand" = use the brand kit's choice. */
  intro: z.union([z.literal("brand"), z.enum(INTRO_STYLES)]),
  outro: z.union([z.literal("brand"), z.enum(OUTRO_STYLES)]),
  introSeconds: z.number().min(1).max(4),
  outroSeconds: z.number().min(2).max(8),
  agentCard: z.boolean(),
  showLogo: z.boolean(),
  music: z.enum(MUSIC_MOODS),
  /** Words that make a claim the listing must back up (shown as a warning otherwise). */
  claims: z.array(z.enum(["waterfront", "new-construction", "price-reduced", "sold", "coming-soon", "rental", "open-house"])).max(4),
});
export type TemplateSpec = z.infer<typeof templateSpecSchema>;

/* ── The fifteen built-in templates ─────────────────────────────────────── */

type Look = TemplateSpec["look"];
const look = (p: Partial<Look>): Look => ({
  headingFont: "Montserrat", bodyFont: "Inter", titleAnim: "rise-mask", captionAnim: "word-slide", bannerAnim: "zoom-in",
  uppercase: false, letterSpacing: 0, accent: "brand-primary", panel: "brand-secondary", text: "#FFFFFF", filter: "none", letterbox: false, ...p,
});
const beat = (slot: Slot, scene: Beat["scene"], style: Beat["style"], position: Beat["position"], extra: Partial<Beat> = {}): Beat => ({ slot, scene, style, position, ...extra });
const base = {
  heroSeconds: 4, sceneSeconds: 3, endSeconds: 5, maxScenes: 14, opener: "cover" as const, intensity: "normal" as const,
  intro: "brand" as const, outro: "brand" as const, introSeconds: 2.2, outroSeconds: 4, agentCard: true, showLogo: true, claims: [] as TemplateSpec["claims"],
  badge: "", headline: "", callToAction: "",
};

export const BUILTIN_TEMPLATES: Record<TemplateKey, TemplateSpec> = {
  "just-listed": {
    ...base, recipe: "just-listed", name: "Just Listed", usage: "Announce a new listing the day it hits the market.",
    description: "Bold JUST LISTED banner, price up front, quick zoom cuts and an agent card.",
    aspect: "9:16", duration: 30, sceneSeconds: 2.6, moves: ["push_in", "pan_right", "zoom", "pan_left"], transition: "zoom", music: "upbeat",
    look: look({ uppercase: true, letterSpacing: 2, bannerAnim: "zoom-in", titleAnim: "rise-mask" }),
    badge: "Just Listed", callToAction: "Book your private showing", intro: "bar-wipe",
    beats: [beat("badge", "first", "banner", "top"), beat("address", "first", "title", "bottom"), beat("price", "second", "banner", "bottom"),
      beat("specs", "third", "caption", "bottom"), beat("cta", "last", "banner", "center", { duration: 2 })],
  },
  "luxury-listing": {
    ...base, recipe: "luxury-listing", name: "Luxury Listing", usage: "High-end homes: slow, elegant and understated.",
    description: "Long gentle moves, serif titles with wide spacing, a cinematic grade and a logo reveal.",
    aspect: "16:9", duration: 45, heroSeconds: 5, sceneSeconds: 4.5, endSeconds: 6, maxScenes: 10, opener: "wide", intensity: "gentle",
    moves: ["push_in", "pan_right", "pull_out", "pan_left"], transition: "fade", music: "elegant", intro: "logo-reveal", introSeconds: 2.8, outroSeconds: 5,
    look: look({ headingFont: "Playfair Display", bodyFont: "Lato", titleAnim: "clip-reveal", captionAnim: "clip-reveal", bannerAnim: "clip-reveal", uppercase: true, letterSpacing: 8, filter: "cinematic", accent: "brand-secondary" }),
    headline: "Presenting", callToAction: "Private showings by appointment",
    beats: [beat("headline", "first", "caption", "top"), beat("address", "first", "title", "bottom"), beat("specs", "second", "caption", "bottom"),
      beat("price", "middle", "caption", "bottom"), beat("cta", "last", "caption", "center", { duration: 2 })],
  },
  "modern-home": {
    ...base, recipe: "modern-home", name: "Modern Home", usage: "Contemporary homes and condos: clean, fast and bold.",
    description: "Geometric sans-serif type, slide transitions and punchy word animations.",
    aspect: "16:9", duration: 30, sceneSeconds: 2.4, moves: ["truck_right", "push_in", "truck_left", "zoom"], transition: "slide-left", music: "upbeat",
    look: look({ headingFont: "Poppins", bodyFont: "DM Sans", titleAnim: "word-pop", captionAnim: "word-pop", bannerAnim: "word-pop", accent: "brand-accent" }),
    intro: "bar-wipe",
    beats: [beat("address", "first", "title", "center"), beat("specs", "second", "banner", "bottom"), beat("price", "third", "banner", "bottom"),
      beat("property-type", "middle", "caption", "top")],
  },
  "open-house": {
    ...base, recipe: "open-house", name: "Open House", usage: "Invite buyers to an open house: date and time first and last.",
    description: "Opens with a title card, repeats the date before the end, warm and friendly.",
    aspect: "1:1", duration: 30, moves: ["push_in", "pan_left", "pull_out", "pan_right"], transition: "fade", music: "warm",
    intro: "title-card", introSeconds: 2.6, claims: ["open-house"],
    look: look({ headingFont: "Montserrat", uppercase: true, letterSpacing: 2, bannerAnim: "rise-mask" }),
    headline: "Open House", callToAction: "We'd love to see you there",
    beats: [beat("open-house", "first", "banner", "center"), beat("address", "second", "title", "bottom"), beat("specs", "third", "caption", "bottom"),
      beat("open-house", "last", "banner", "center", { duration: 2 })],
  },
  "price-reduced": {
    ...base, recipe: "price-reduced", name: "Price Reduced", usage: "A new, lower price: lead with the price change.",
    description: "Strong price banner (with the old price when the listing has it), whip cuts.",
    aspect: "9:16", duration: 20, heroSeconds: 4, sceneSeconds: 2.2, maxScenes: 8, moves: ["zoom", "pan_right", "push_in"], transition: "whip", music: "upbeat",
    claims: ["price-reduced"], intro: "none",
    look: look({ headingFont: "Oswald", bodyFont: "Roboto", uppercase: true, letterSpacing: 1, bannerAnim: "zoom-in", accent: "brand-accent" }),
    badge: "Price Improved", callToAction: "Schedule a showing",
    beats: [beat("badge", "first", "banner", "top", { offset: 0.2 }), beat("new-price", "first", "title", "bottom", { offset: 0.6 }), beat("address", "second", "caption", "bottom"),
      beat("specs", "third", "caption", "bottom"), beat("cta", "last", "banner", "center", { duration: 2 })],
  },
  "coming-soon": {
    ...base, recipe: "coming-soon", name: "Coming Soon", usage: "Tease a listing before it goes live.",
    description: "Short teaser: COMING SOON, a few glimpses, no price, early-access call to action.",
    aspect: "9:16", duration: 15, heroSeconds: 4, sceneSeconds: 2, endSeconds: 4, maxScenes: 6, moves: ["push_in", "tilt_up", "pull_out"], transition: "fade", music: "inspiring",
    claims: ["coming-soon"], intro: "title-card", outroSeconds: 3,
    look: look({ headingFont: "Bebas Neue", bodyFont: "Inter", titleAnim: "letter-pop", bannerAnim: "letter-pop", uppercase: true, letterSpacing: 6, filter: "dreamy" }),
    headline: "Coming Soon", badge: "Coming Soon", callToAction: "Ask for early access",
    beats: [beat("badge", "second", "banner", "center"), beat("address", "third", "caption", "bottom"), beat("cta", "last", "caption", "center", { duration: 2 })],
  },
  "just-sold": {
    ...base, recipe: "just-sold", name: "Just Sold", usage: "Celebrate a closed sale and invite new sellers.",
    description: "SOLD stamp, the address, and a 'thinking of selling?' agent card.",
    aspect: "9:16", duration: 15, heroSeconds: 4, sceneSeconds: 2, endSeconds: 5, maxScenes: 6, moves: ["push_in", "pan_left", "zoom"], transition: "zoom", music: "upbeat",
    claims: ["sold"], intro: "title-card", outro: "agent-card",
    look: look({ headingFont: "Anton", bodyFont: "Inter", bannerAnim: "zoom-in", uppercase: true, letterSpacing: 3, accent: "brand-accent" }),
    headline: "Just Sold", badge: "Sold", callToAction: "Thinking of selling? Let's talk.",
    beats: [beat("badge", "second", "banner", "center"), beat("address", "second", "title", "bottom"), beat("cta", "last", "caption", "top", { duration: 1.5 })],
  },
  "property-highlights": {
    ...base, recipe: "property-highlights", name: "Property Highlights", usage: "Walk through the key facts, one per scene.",
    description: "Numbered fact banners (beds, baths, size, type, price) over a steady tour.",
    aspect: "16:9", duration: 40, sceneSeconds: 3.2, maxScenes: 12, moves: ["pan_right", "push_in", "pan_left", "pull_out"], transition: "wipe", music: "calm",
    look: look({ bannerAnim: "rise-mask" }),
    beats: [beat("address", "first", "title", "bottom"), beat("facts-each", "each", "banner", "bottom"), beat("mls", "last", "caption", "top", { duration: 1.5 })],
  },
  "investment-property": {
    ...base, recipe: "investment-property", name: "Investment Property", usage: "Income and multi-family properties for investors.",
    description: "Numbers first: price, size and type, with a clean business look.",
    aspect: "16:9", duration: 30, sceneSeconds: 2.8, moves: ["pan_right", "push_in", "truck_left"], transition: "wipe", music: "inspiring",
    look: look({ headingFont: "Barlow", bodyFont: "Inter", uppercase: true, letterSpacing: 2, bannerAnim: "clip-reveal", captionAnim: "clip-reveal", accent: "brand-primary" }),
    headline: "Investment Opportunity", callToAction: "Request the details",
    beats: [beat("headline", "first", "banner", "top"), beat("address", "first", "title", "bottom"), beat("price", "second", "banner", "bottom"),
      beat("property-type", "third", "caption", "bottom"), beat("specs", "middle", "caption", "bottom"), beat("mls", "last", "caption", "top", { duration: 1.5 })],
  },
  "rental-property": {
    ...base, recipe: "rental-property", name: "Rental Property", usage: "Homes and apartments for rent.",
    description: "FOR RENT banner, monthly rent, rooms and a 'schedule a viewing' card.",
    aspect: "9:16", duration: 25, sceneSeconds: 2.5, maxScenes: 10, moves: ["push_in", "pan_right", "pan_left"], transition: "slide-left", music: "warm",
    claims: ["rental"], intro: "bar-wipe",
    look: look({ headingFont: "Rubik", bodyFont: "Inter", titleAnim: "word-pop", bannerAnim: "zoom-in" }),
    badge: "For Rent", callToAction: "Schedule a viewing",
    beats: [beat("badge", "first", "banner", "top"), beat("rent", "first", "title", "bottom"), beat("address", "second", "caption", "bottom"),
      beat("specs", "third", "caption", "bottom"), beat("cta", "last", "banner", "center", { duration: 2 })],
  },
  "waterfront-home": {
    ...base, recipe: "waterfront-home", name: "Waterfront Home", usage: "Homes on the water: wide views and a calm pace.",
    description: "Wide openers, slow pans, a crisp cool look and elegant serif titles.",
    aspect: "16:9", duration: 40, heroSeconds: 5, sceneSeconds: 3.8, opener: "wide", intensity: "gentle", moves: ["pan_right", "pull_out", "pan_left", "push_in"],
    transition: "fade", music: "calm", claims: ["waterfront"], intro: "logo-reveal",
    look: look({ headingFont: "Playfair Display", bodyFont: "Lato", titleAnim: "clip-reveal", captionAnim: "clip-reveal", filter: "cold", letterSpacing: 2 }),
    headline: "Waterfront Living",
    beats: [beat("headline", "first", "caption", "top"), beat("address", "first", "title", "bottom"), beat("specs", "second", "caption", "bottom"), beat("price", "middle", "caption", "bottom")],
  },
  "new-construction": {
    ...base, recipe: "new-construction", name: "New Construction", usage: "Brand-new homes and builder listings.",
    description: "Bold blocky type, wipes and the property type up front.",
    aspect: "16:9", duration: 35, sceneSeconds: 3, moves: ["tilt_up", "push_in", "truck_right", "pull_out"], transition: "wipe", music: "inspiring",
    claims: ["new-construction"], intro: "bar-wipe",
    look: look({ headingFont: "Archivo Black", bodyFont: "Inter", uppercase: true, letterSpacing: 1, bannerAnim: "clip-reveal", accent: "brand-accent", filter: "pop" }),
    badge: "New Construction",
    beats: [beat("badge", "first", "banner", "top"), beat("address", "first", "title", "bottom"), beat("property-type", "second", "caption", "bottom"),
      beat("specs", "third", "banner", "bottom"), beat("price", "middle", "banner", "bottom")],
  },
  "twilight-tour": {
    ...base, recipe: "twilight-tour", name: "Twilight Tour", usage: "Evening mood for dusk and night photos.",
    description: "Warm evening colour look, slow fades and refined titles. (A colour look only; it doesn't change the photos' time of day.)",
    aspect: "16:9", duration: 30, heroSeconds: 4.5, sceneSeconds: 3.5, maxScenes: 9, opener: "last", intensity: "gentle", moves: ["push_in", "pan_left", "pull_out"],
    transition: "fade", music: "elegant", intro: "logo-reveal",
    look: look({ headingFont: "Abril Fatface", bodyFont: "Lato", titleAnim: "clip-reveal", captionAnim: "clip-reveal", filter: "sunset", letterSpacing: 1 }),
    beats: [beat("address", "first", "title", "bottom"), beat("specs", "second", "caption", "bottom"), beat("price", "middle", "caption", "bottom")],
  },
  "agent-introduction": {
    ...base, recipe: "agent-introduction", name: "Agent Introduction", usage: "Introduce the listing agent with their photo and contact details.",
    description: "Opens with 'Presented by', ends on a large agent card with headshot and brokerage.",
    aspect: "9:16", duration: 20, heroSeconds: 4, sceneSeconds: 2.6, endSeconds: 7, maxScenes: 7, moves: ["push_in", "pan_right", "pull_out"], transition: "fade", music: "warm",
    intro: "title-card", outro: "agent-card", outroSeconds: 6,
    look: look({ headingFont: "Montserrat", bodyFont: "Inter", bannerAnim: "rise-mask" }),
    headline: "Meet your agent", callToAction: "",
    beats: [beat("presented-by", "first", "banner", "bottom"), beat("address", "second", "caption", "bottom"), beat("specs", "third", "caption", "bottom")],
  },
  "cinematic-reveal": {
    ...base, recipe: "cinematic-reveal", name: "Cinematic Property Reveal", usage: "A dramatic, film-style reveal for a hero listing.",
    description: "Cinema bars, long reveals, a cinematic grade and a logo reveal.",
    aspect: "16:9", duration: 45, heroSeconds: 5.5, sceneSeconds: 4, endSeconds: 6, maxScenes: 10, opener: "wide", intensity: "dramatic",
    moves: ["pull_out", "pan_right", "push_in", "tilt_up"], transition: "fade", music: "inspiring", intro: "logo-reveal", introSeconds: 3,
    look: look({ headingFont: "Bebas Neue", bodyFont: "Barlow", titleAnim: "clip-reveal", captionAnim: "clip-reveal", uppercase: true, letterSpacing: 10, filter: "cinematic", letterbox: true }),
    beats: [beat("address", "first", "title", "center"), beat("specs", "middle", "caption", "bottom"), beat("price", "last", "caption", "center", { duration: 2 })],
  },
};

/* ── Inputs ─────────────────────────────────────────────────────────────── */

export interface TemplateListing {
  address_line: string; city: string | null; state: string | null; price: number | null; previous_price?: number | null;
  bedrooms: number | null; bathrooms: number | null; square_feet: number | null; property_type: string | null; status: string;
  mls_number?: string | null; description?: string | null; open_house_text: string | null; cover_asset_id: string | null;
}
export interface TemplatePhoto { id: string; width?: number | null; height?: number | null; camera?: CameraSpec | null }
export interface TemplateBrand {
  primary_color: string; secondary_color: string; accent_color: string; heading_font: string; body_font: string;
  company_name: string | null; logoAssetId: string | null; brokerageLogoAssetId: string | null;
  intro_style: IntroStyle; outro_style: OutroStyle; agent_layout: AgentLayout; disclosure: string | null;
}
export interface TemplateAgent { name: string; title?: string | null; phone?: string | null; email?: string | null; brokerage?: string | null; license?: string | null; headshotAssetId?: string | null }
/** Administrator branding rules (organization_settings). */
export interface BrandRules { requireLogo: boolean; requireDisclosure: boolean; requireAgentCard: boolean; lockFonts: boolean; lockColors: boolean }
export const NO_RULES: BrandRules = { requireLogo: false, requireDisclosure: false, requireAgentCard: false, lockFonts: false, lockColors: false };

export interface TemplateWarning { kind: "claim" | "missing" | "rule"; message: string }

const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
const plural = (n: number, one: string, many: string) => `${Number(n)} ${Number(n) === 1 ? one : many}`;
const TYPE_LABELS: Record<string, string> = {
  single_family: "Single-family home", condo: "Condo", townhouse: "Townhouse", multi_family: "Multi-family", land: "Land", commercial: "Commercial", other: "",
};

function listingText(l: TemplateListing): string {
  return [l.description, l.property_type].filter(Boolean).join(" ").toLowerCase();
}
const WATER = /\b(waterfront|lake ?front|oceanfront|beachfront|riverfront|bay ?front|on the (lake|water|river|bay|ocean)|private dock|boat dock|water views?|lake views?|ocean views?)\b/;
const NEW_BUILD = /\b(new construction|newly built|brand[- ]new (home|build|construction)|builder|never lived in)\b/;

/** Which claims the listing backs up. */
export function supportedClaims(l: TemplateListing): Set<TemplateSpec["claims"][number]> {
  const t = listingText(l);
  const out = new Set<TemplateSpec["claims"][number]>();
  if (WATER.test(t)) out.add("waterfront");
  if (NEW_BUILD.test(t)) out.add("new-construction");
  if (l.previous_price != null && l.price != null && Number(l.previous_price) > Number(l.price)) out.add("price-reduced");
  if (l.status === "sold") out.add("sold");
  if (l.status === "coming_soon") out.add("coming-soon");
  if (l.status === "for_rent") out.add("rental");
  if (l.open_house_text) out.add("open-house");
  return out;
}

const CLAIM_MESSAGES: Record<TemplateSpec["claims"][number], string> = {
  waterfront: "The listing doesn't mention the water. Check that this home really is waterfront before using this template.",
  "new-construction": "The listing doesn't say it's new construction. Check before using this template.",
  "price-reduced": "The listing has no earlier, higher price saved, so the old price isn't shown. Add the previous price to the listing to show it.",
  sold: "The listing isn't marked Sold yet.",
  "coming-soon": "The listing isn't marked Coming Soon.",
  rental: "The listing isn't marked For Rent, so the price is shown as a sale price.",
  "open-house": "The listing has no open house date, so the video says 'Ask us for a showing' instead of a date.",
};

/* ── Building the plan ─────────────────────────────────────────────────── */

function resolveColor(ref: string, brand: TemplateBrand): string {
  if (ref === "brand-primary") return brand.primary_color;
  if (ref === "brand-secondary") return brand.secondary_color;
  if (ref === "brand-accent") return brand.accent_color;
  return ref;
}
const asFont = (f: string, fallback: (typeof BRAND_FONTS)[number]) => ((BRAND_FONTS as readonly string[]).includes(f) ? f as (typeof BRAND_FONTS)[number] : fallback);

function orderForTemplate(photos: TemplatePhoto[], coverId: string | null, opener: TemplateSpec["opener"]): TemplatePhoto[] {
  if (photos.length === 0) return [];
  let first: TemplatePhoto | undefined;
  if (opener === "last") first = photos.at(-1);
  else if (opener === "wide") first = photos.find((p) => p.id === coverId && (p.width ?? 0) > (p.height ?? 0)) ?? photos.find((p) => (p.width ?? 0) > (p.height ?? 0) * 1.2);
  first ??= photos.find((p) => p.id === coverId) ?? photos[0]!;
  return [first, ...photos.filter((p) => p.id !== first!.id)];
}

/** Scene count and lengths that add up to (about) the template's duration. */
function sceneLengths(spec: TemplateSpec, available: number): number[] {
  const middle = Math.max(0, spec.duration - spec.heroSeconds - spec.endSeconds);
  let count = Math.min(spec.maxScenes, available, Math.max(2, 2 + Math.round(middle / spec.sceneSeconds)));
  count = Math.max(1, count);
  if (count === 1) return [Math.min(10, Math.max(spec.heroSeconds, spec.duration))];
  if (count === 2) return [spec.heroSeconds, spec.endSeconds];
  const each = Math.min(6, Math.max(1.5, Math.round((middle / (count - 2)) * 100) / 100));
  return [spec.heroSeconds, ...Array.from({ length: count - 2 }, () => each), spec.endSeconds];
}

/** Template + listing + photos + brand kit + agent → EditPlan (validated) and warnings. */
export function buildTemplatePlan(input: {
  spec: TemplateSpec;
  listing: TemplateListing;
  photos: TemplatePhoto[];
  brand: TemplateBrand;
  agent: TemplateAgent | null;
  aspect?: Aspect;
  musicAssetId?: string | null;
  rules?: BrandRules;
  /** Changes photo choice and camera order ("Regenerate"). */
  variation?: number;
}): { plan: EditPlan; warnings: TemplateWarning[] } {
  const spec = templateSpecSchema.parse(input.spec);
  const { listing: l, brand } = input;
  const rules = input.rules ?? NO_RULES;
  const warnings: TemplateWarning[] = [];
  if (input.photos.length === 0) throw new Error("Add at least one photo first");

  // scenes
  const ordered = orderForTemplate(input.photos, l.cover_asset_id, spec.opener);
  const lengths = sceneLengths(spec, ordered.length);
  const v = Math.max(0, input.variation ?? 0);
  const rest = ordered.slice(1);
  const step = rest.length / Math.max(1, lengths.length - 1);
  const chosen = [ordered[0]!, ...Array.from({ length: lengths.length - 1 }, (_, i) => rest[(Math.floor(i * step) + v) % Math.max(1, rest.length)]!)]
    .filter((p, i, a) => !!p && a.findIndex((x) => x?.id === p.id) === i);
  const strength = INTENSITY_STRENGTH[spec.intensity];
  const scenes: Scene[] = chosen.map((p, i) => {
    const move = spec.moves[(i + v) % spec.moves.length]!;
    const ok = getStudioMove(move) && !getStudioMove(move)!.requiresAI;
    return {
      id: `s${i + 1}`, assetId: p.id, move: STILL, duration: lengths[i] ?? spec.sceneSeconds,
      camera: p.camera ?? defaultSpec(ok ? move : "push_in", { strength, easing: "ease-in-out", gimbal: DEFAULT_GIMBAL }),
    };
  });
  // if photos ran out, the last scene keeps the end length
  if (scenes.length >= 2) scenes[scenes.length - 1]!.duration = spec.endSeconds;
  const n = scenes.length;
  const sceneFor = (ref: Beat["scene"]): string[] => {
    const idx = ref === "first" ? [0] : ref === "second" ? [Math.min(1, n - 1)] : ref === "third" ? [Math.min(2, n - 1)]
      : ref === "middle" ? [Math.floor(n / 2)] : ref === "last" ? [n - 1] : Array.from({ length: Math.max(0, n - 2) }, (_, i) => i + 1);
    return idx.map((i) => (i === 0 ? FIRST_SCENE : i === n - 1 ? LAST_SCENE : scenes[i]!.id));
  };

  // branding (brand kit + template + agent profile + admin rules)
  const introStyle: IntroStyle = spec.intro === "brand" ? brand.intro_style : spec.intro;
  let outroStyle: OutroStyle = spec.outro === "brand" ? brand.outro_style : spec.outro;
  const agentCard: AgentCard | null = input.agent?.name?.trim() ? {
    name: input.agent.name.trim(),
    ...(input.agent.title ? { title: input.agent.title } : {}),
    ...(input.agent.phone ? { phone: input.agent.phone } : {}),
    ...(input.agent.email ? { email: input.agent.email } : {}),
    ...((input.agent.brokerage ?? brand.company_name) ? { brokerage: (input.agent.brokerage ?? brand.company_name)! } : {}),
    ...(input.agent.license ? { license: input.agent.license } : {}),
    ...(input.agent.headshotAssetId ? { headshotAssetId: input.agent.headshotAssetId } : {}),
    layout: brand.agent_layout,
  } : null;
  const wantsCard = spec.agentCard || rules.requireAgentCard;
  if (wantsCard && outroStyle === "none") outroStyle = "agent-card";
  if (outroStyle === "agent-card" && !agentCard) {
    warnings.push({ kind: "missing", message: "No agent is assigned to this listing, so the end card shows the company instead of an agent." });
    outroStyle = "logo-end";
  }
  if (rules.requireAgentCard && !agentCard) warnings.push({ kind: "rule", message: "Your company requires an agent card. Assign an agent profile to this listing." });
  if (rules.requireLogo && !brand.logoAssetId) warnings.push({ kind: "rule", message: "Your company requires the logo, but no logo is uploaded in the brand kit." });
  if (rules.requireDisclosure && !brand.disclosure) warnings.push({ kind: "rule", message: "Your company requires a brokerage disclosure, but the brand kit has none." });
  const intro = { style: introStyle, seconds: Math.min(spec.introSeconds, Math.max(1, lengths[0]! - 0.8)), ...(spec.headline || spec.badge ? { title: spec.headline || spec.badge } : {}) };
  const branding: PlanBranding = {
    intro,
    outro: { style: outroStyle, seconds: Math.min(spec.outroSeconds, Math.max(2, scenes.at(-1)!.duration - 0.5)) },
    agent: outroStyle === "agent-card" || outroStyle === "contact-bar" || wantsCard ? agentCard : agentCard,
    ...(brand.company_name ? { companyName: brand.company_name } : {}),
    ...(brand.logoAssetId ? { logoAssetId: brand.logoAssetId } : {}),
    ...(brand.brokerageLogoAssetId ? { brokerageLogoAssetId: brand.brokerageLogoAssetId } : {}),
    ...(brand.disclosure ? { disclosure: brand.disclosure } : {}),
  };
  const introEnd = introStyle === "none" ? 0 : intro.seconds;

  // look (brand fonts / colours win when the administrator locks them)
  const planLook: PlanLook = {
    template: spec.recipe,
    headingFont: rules.lockFonts ? asFont(brand.heading_font, spec.look.headingFont) : spec.look.headingFont,
    bodyFont: rules.lockFonts ? asFont(brand.body_font, spec.look.bodyFont) : spec.look.bodyFont,
    titleAnim: spec.look.titleAnim, captionAnim: spec.look.captionAnim, bannerAnim: spec.look.bannerAnim,
    uppercase: spec.look.uppercase, letterSpacing: spec.look.letterSpacing,
    accent: rules.lockColors ? brand.primary_color : resolveColor(spec.look.accent, brand),
    panel: rules.lockColors ? brand.secondary_color : resolveColor(spec.look.panel, brand),
    text: spec.look.text, filter: spec.look.filter, ...(spec.look.letterbox ? { letterbox: true } : {}),
  };

  // words (listing facts only)
  const claims = supportedClaims(l);
  for (const c of spec.claims) if (!claims.has(c)) warnings.push({ kind: "claim", message: CLAIM_MESSAGES[c] });
  const where = [l.city, l.state].filter(Boolean).join(", ");
  const address = [l.address_line.trim(), where].filter(Boolean).join("\n");
  const price = l.price != null ? money(Number(l.price)) : "";
  const specs = [
    l.bedrooms != null ? plural(l.bedrooms, "bed", "beds") : "",
    l.bathrooms != null ? plural(l.bathrooms, "bath", "baths") : "",
    l.square_feet != null ? `${Number(l.square_feet).toLocaleString("en-US")} sq ft` : "",
  ].filter(Boolean);
  const type = l.property_type ? (TYPE_LABELS[l.property_type] ?? l.property_type.replace(/_/g, " ")) : "";
  const reduced = claims.has("price-reduced") && l.previous_price != null;
  const slotText = (slot: Slot): string[] => {
    switch (slot) {
      case "badge": return spec.badge ? [spec.badge] : [];
      case "headline": return spec.headline ? [spec.headline] : [];
      case "address": return address ? [address] : [];
      case "price": return price ? [l.status === "for_rent" ? `${price} / month` : price] : [];
      case "new-price": return price ? [reduced ? `Now ${price}\nWas ${money(Number(l.previous_price))}` : `Now ${price}`] : [];
      case "rent": return price ? [l.status === "for_rent" ? `${price} / month` : price] : [];
      case "specs": return specs.length ? [specs.join("  ·  ")] : [];
      case "facts-each": return [...specs, type, price ? (l.status === "for_rent" ? `${price} / month` : `Offered at ${price}`) : ""].filter(Boolean).map((f, i) => `${i + 1}. ${f}`);
      case "open-house": return [l.open_house_text ? `Open House\n${l.open_house_text}` : "Visit this home\nAsk us for a showing"];
      case "property-type": return type ? [type] : [];
      case "mls": return l.mls_number ? [`MLS# ${l.mls_number}`] : [];
      case "cta": return spec.callToAction ? [spec.callToAction] : [];
      case "presented-by": return agentCard ? [`Presented by\n${agentCard.name}`] : brand.company_name ? [`Presented by\n${brand.company_name}`] : [];
    }
  };
  const texts: TextOverlay[] = [];
  const outroLen = outroStyle === "none" ? 0 : branding.outro.seconds;
  spec.beats.forEach((b, bi) => {
    const values = slotText(b.slot);
    const targets = sceneFor(b.scene);
    if (!values.length || !targets.length) return;
    const pairs: (readonly [string, string])[] = b.scene === "each"
      ? values.flatMap((val, i) => (targets[i] ? [[val, targets[i]!] as const] : []))
      : [[values[0]!, targets[0]!] as const];
    pairs.forEach(([val, sceneId], k) => {
      const scene = sceneId === FIRST_SCENE ? scenes[0]! : sceneId === LAST_SCENE ? scenes[n - 1]! : scenes.find((s) => s.id === sceneId)!;
      const isFirst = sceneId === FIRST_SCENE || (n === 1);
      const isLast = sceneId === LAST_SCENE || n === 1;
      const offset = Math.round(((b.offset ?? 0) + (isFirst ? introEnd : 0)) * 100) / 100;
      // texts on the last scene finish before the outro covers it
      let duration: number | null = b.duration ?? null;
      const room = scene.duration - offset - (isLast ? outroLen : 0);
      if (room < 1) return;
      if (duration == null && (offset > 0 || isLast)) duration = Math.round(room * 100) / 100;
      if (duration != null) duration = Math.max(1, Math.min(duration, Math.round(room * 100) / 100));
      texts.push({ id: `t_${b.slot.replace(/-/g, "_")}_${bi}_${k}`, text: val.slice(0, 200), sceneId, style: b.style, position: b.position, duration, ...(offset > 0 ? { offset } : {}) });
    });
  });

  const plan = planSchema.parse({
    version: 1,
    aspect: input.aspect ?? spec.aspect,
    transition: spec.transition,
    scenes,
    texts: texts.slice(0, 20),
    music: { assetId: input.musicAssetId ?? null, volume: 0.65, fadeOut: true },
    ...((spec.showLogo || rules.requireLogo) && brand.logoAssetId ? { logoAssetId: brand.logoAssetId } : {}),
    look: planLook,
    branding,
  });
  return { plan, warnings };
}

/* ── Recommendation ───────────────────────────────────────────────────── */

export interface Recommendation { key: TemplateKey; reason: string }

/**
 * The best template for a listing (company defaults first, then the listing's status and facts).
 * `defaults` maps a listing status to the template key an administrator assigned to it.
 */
export function recommendTemplate(l: TemplateListing & { created_at?: string | null }, opts: { defaults?: Partial<Record<string, TemplateKey>>; available?: readonly string[]; now?: Date } = {}): Recommendation {
  const ok = (k: TemplateKey) => !opts.available || opts.available.includes(k);
  const pick = (k: TemplateKey, reason: string): Recommendation | null => (ok(k) ? { key: k, reason } : null);
  const claims = supportedClaims(l);
  const days = l.created_at ? ((opts.now ?? new Date()).getTime() - new Date(l.created_at).getTime()) / 86_400_000 : null;
  const assigned = opts.defaults?.[l.status];
  const price = l.price != null ? Number(l.price) : null;
  return (assigned ? pick(assigned, "Your company's default template for this kind of listing.") : null)
    ?? (l.status === "sold" ? pick("just-sold", "The listing is marked Sold.") : null)
    ?? (l.status === "coming_soon" ? pick("coming-soon", "The listing is marked Coming Soon.") : null)
    ?? (l.status === "for_rent" ? pick("rental-property", "The listing is for rent.") : null)
    ?? ((l.status === "open_house" || l.open_house_text) ? pick("open-house", "The listing has an open house scheduled.") : null)
    ?? (claims.has("price-reduced") ? pick("price-reduced", "The price is lower than the previous price.") : null)
    ?? (claims.has("waterfront") ? pick("waterfront-home", "The listing mentions the water.") : null)
    ?? (claims.has("new-construction") ? pick("new-construction", "The listing mentions new construction.") : null)
    ?? (price != null && price >= 1_500_000 ? pick("luxury-listing", "The price is in the luxury range.") : null)
    ?? (l.property_type === "multi_family" || l.property_type === "commercial" ? pick("investment-property", "Multi-family and commercial properties suit investors.") : null)
    ?? (days != null && days <= 14 ? pick("just-listed", "The listing is new (added in the last two weeks).") : null)
    ?? pick("property-highlights", "A good all-round tour of the key facts.")
    ?? { key: (opts.available?.[0] as TemplateKey | undefined) ?? "just-listed", reason: "The first available template." };
}

/** Plain-English facts for a template card. */
export function templateSummary(spec: TemplateSpec): string {
  const shape = spec.aspect === "9:16" ? "Vertical" : spec.aspect === "1:1" ? "Square" : "Wide";
  return `${shape} · about ${spec.duration} s · ${spec.look.headingFont}`;
}

export { AGENT_LAYOUTS };
export type { MusicMood };

/* ── Enforcing the administrator's branding rules on any plan ─────────── */

export interface BrandFacts {
  logoAssetId: string | null;
  disclosure: string | null;
  companyName: string | null;
  brokerageLogoAssetId: string | null;
  agent: AgentCard | null;
  headingFont: string; bodyFont: string; primary: string; secondary: string;
}

/**
 * Applies required branding to a plan (Easy Mode, editor and template videos alike):
 * the logo, the disclosure and the agent card are added when required and missing;
 * locked fonts and colours replace a template's own. Returns the plan and what changed.
 */
export function applyBrandRules(plan: EditPlan, rules: BrandRules, f: BrandFacts): { plan: EditPlan; changes: string[] } {
  const changes: string[] = [];
  let next: EditPlan = { ...plan };
  const last = plan.scenes.at(-1)?.duration ?? 3;
  const ensureBranding = () => next.branding ?? {
    intro: { style: "none" as const, seconds: 2 }, outro: { style: "none" as const, seconds: Math.max(2, Math.min(4, last - 0.5)) }, agent: null,
    ...(f.companyName ? { companyName: f.companyName } : {}),
  };
  if (rules.requireLogo && f.logoAssetId && !next.logoAssetId) { next.logoAssetId = f.logoAssetId; changes.push("Added the company logo (required)."); }
  if (rules.requireDisclosure && f.disclosure && next.branding?.disclosure !== f.disclosure) {
    next.branding = { ...ensureBranding(), disclosure: f.disclosure };
    changes.push("Added the brokerage disclosure (required).");
  }
  if (rules.requireAgentCard && f.agent && (next.branding?.outro.style !== "agent-card" || !next.branding?.agent)) {
    const b = ensureBranding();
    next.branding = { ...b, agent: b.agent ?? f.agent, outro: { style: "agent-card", seconds: Math.max(2, Math.min(b.outro.seconds || 4, last - 0.5, 8)) },
      ...(f.logoAssetId && !b.logoAssetId ? { logoAssetId: f.logoAssetId } : {}),
      ...(f.brokerageLogoAssetId && !b.brokerageLogoAssetId ? { brokerageLogoAssetId: f.brokerageLogoAssetId } : {}) };
    changes.push("Added the agent card (required).");
  }
  if (next.look && rules.lockFonts) {
    const h = asFont(f.headingFont, next.look.headingFont), b = asFont(f.bodyFont, next.look.bodyFont);
    if (h !== next.look.headingFont || b !== next.look.bodyFont) { next.look = { ...next.look, headingFont: h, bodyFont: b }; changes.push("Used the company fonts (locked)."); }
  }
  if (next.look && rules.lockColors && (next.look.accent !== f.primary || next.look.panel !== f.secondary)) {
    next.look = { ...next.look, accent: f.primary, panel: f.secondary };
    changes.push("Used the company colours (locked).");
  }
  if (changes.length) next = planSchema.parse(next);
  return { plan: next, changes };
}

/* ── Mapping database rows (shared by the server and the acceptance test) ─ */

export function templateListing(l: ListingRow): TemplateListing & { created_at: string } {
  return {
    address_line: l.address_line, city: l.city, state: l.state, price: l.price == null ? null : Number(l.price), previous_price: l.previous_price == null ? null : Number(l.previous_price),
    bedrooms: l.bedrooms == null ? null : Number(l.bedrooms), bathrooms: l.bathrooms == null ? null : Number(l.bathrooms), square_feet: l.square_feet,
    property_type: l.property_type, status: l.status, mls_number: l.mls_number, description: l.description,
    open_house_text: formatOpenHouse(l.open_house_date, l.open_house_start, l.open_house_end), cover_asset_id: l.cover_asset_id, created_at: l.created_at,
  };
}

/** Agent shown on a listing's videos: the assigned profile, else the agent typed on the listing. */
export function agentFrom(profile: AgentProfileRow | null, listing: Pick<ListingRow, "agent_name" | "brokerage" | "contact_phone" | "contact_email">, kit: BrandKitRow | null, headshotAssetId: string | null): TemplateAgent | null {
  const brokerage = kit?.brokerage_name ?? kit?.company_name ?? null;
  if (profile && profile.is_active) {
    return { name: profile.name, title: profile.title, phone: profile.phone, email: profile.email, brokerage: profile.brokerage ?? brokerage,
      license: profile.license ?? kit?.brokerage_license ?? null, headshotAssetId };
  }
  if (listing.agent_name?.trim()) {
    return { name: listing.agent_name.trim(), phone: listing.contact_phone, email: listing.contact_email, brokerage: listing.brokerage ?? brokerage, license: kit?.brokerage_license ?? null };
  }
  return null;
}

/** The brand kit as templates use it. */
export function templateBrandFrom(kit: BrandKitRow | null, orgName: string | null, logoAssetId: string | null, brokerageLogoAssetId: string | null): TemplateBrand {
  return {
    primary_color: kit?.primary_color ?? "#1D4ED8", secondary_color: kit?.secondary_color ?? "#0F172A", accent_color: kit?.accent_color ?? "#F59E0B",
    heading_font: kit?.heading_font ?? "Montserrat", body_font: kit?.body_font ?? "Inter", company_name: kit?.company_name ?? orgName,
    logoAssetId, brokerageLogoAssetId,
    intro_style: kit?.intro_style ?? "logo-reveal", outro_style: kit?.outro_style ?? "agent-card", agent_layout: kit?.agent_layout ?? "photo-left",
    disclosure: kit?.disclaimer?.trim() ? kit.disclaimer.trim() : null,
  };
}

/** Rules from my_brand_rules(). */
export function rulesFrom(json: unknown): BrandRules {
  const r = (json ?? {}) as Record<string, boolean | undefined>;
  return { requireLogo: !!r.require_logo, requireDisclosure: !!r.require_disclosure, requireAgentCard: !!r.require_agent_card, lockFonts: !!r.lock_fonts, lockColors: !!r.lock_colors };
}

/** Brand kit + agent → the facts applyBrandRules() needs. */
export function factsFrom(brand: TemplateBrand, agent: TemplateAgent | null): BrandFacts {
  const card: AgentCard | null = agent?.name ? {
    name: agent.name,
    ...(agent.title ? { title: agent.title } : {}), ...(agent.phone ? { phone: agent.phone } : {}), ...(agent.email ? { email: agent.email } : {}),
    ...(agent.brokerage ? { brokerage: agent.brokerage } : {}), ...(agent.license ? { license: agent.license } : {}),
    ...(agent.headshotAssetId ? { headshotAssetId: agent.headshotAssetId } : {}),
    layout: brand.agent_layout,
  } : null;
  return {
    logoAssetId: brand.logoAssetId, disclosure: brand.disclosure, companyName: brand.company_name, brokerageLogoAssetId: brand.brokerageLogoAssetId, agent: card,
    headingFont: brand.heading_font, bodyFont: brand.body_font, primary: brand.primary_color, secondary: brand.secondary_color,
  };
}

/** The company's copies of the built-in templates, approved (added once by the server). */
export function builtinTemplateRows(orgId: string, existing: Set<string | null> = new Set()) {
  return TEMPLATE_KEYS.filter((k) => !existing.has(k)).map((k) => {
    const s = BUILTIN_TEMPLATES[k];
    return {
      organization_id: orgId, slug: k, builtin_key: k, name: s.name, description: s.description, usage: s.usage,
      aspect_ratios: [s.aspect], style: s as unknown as Record<string, unknown>, status: "approved" as const, sort_order: TEMPLATE_KEYS.indexOf(k),
    };
  });
}
