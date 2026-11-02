/*
 * "Generate 6 Videos": one listing → six marketing videos with different jobs,
 * shapes, lengths, pacing, camera work, text hooks and branding.
 *
 *  1. Cinematic Listing Tour        16:9 · long · every photo · slow camera moves
 *  2. Just Listed Reel              9:16 · 15 s · fast cuts · bold hook up front
 *  3. Property Highlights           16:9 · one numbered fact per scene
 *  4. Luxury-Style Video            16:9 · few long scenes · film motion blur · understated text
 *  5. Open House Promotion          1:1  · date first and again before the end
 *  6. Agent-Branded Listing Ad      16:9 · agent intro card, branded lower thirds, contact end card
 *
 * Everything comes from the listing record (no invented facts): when a fact is
 * missing, the scene simply has no text for it, and the analysis says so.
 */
import { defaultSpec, type CameraSpec } from "@lvs/camera-presets";
import {
  FIRST_SCENE, LAST_SCENE, MAX_SCENE_SECONDS, MIN_SCENE_SECONDS, planSchema,
  type Aspect, type EditPlan, type Scene, type TextOverlay, type Transition,
} from "@/lib/video/plan";
import type { EasyBrand, EasyListing } from "@/lib/video/easy";

export const BATCH_TYPES = ["cinematic-tour", "just-listed-reel", "highlights", "luxury", "open-house", "agent-ad"] as const;
export type BatchType = (typeof BATCH_TYPES)[number];

export interface BatchTypeInfo { id: BatchType; title: string; purpose: string; aspect: Aspect; template: string }
export const BATCH_TYPE_INFO: Record<BatchType, BatchTypeInfo> = {
  "cinematic-tour": { id: "cinematic-tour", title: "Cinematic Listing Tour", purpose: "A slow, complete walk through the home for your website and YouTube.", aspect: "16:9", template: "luxury" },
  "just-listed-reel": { id: "just-listed-reel", title: "Just Listed Reel", purpose: "A fast vertical teaser for Reels, TikTok and Shorts.", aspect: "9:16", template: "social-reel" },
  highlights: { id: "highlights", title: "Property Highlights", purpose: "The key facts, one per scene, so buyers learn the home quickly.", aspect: "16:9", template: "highlights" },
  luxury: { id: "luxury", title: "Luxury-Style Video", purpose: "Fewer, longer, elegant shots with understated titles.", aspect: "16:9", template: "luxury" },
  "open-house": { id: "open-house", title: "Open House Promotion", purpose: "Square post that invites people to the open house.", aspect: "1:1", template: "open-house" },
  "agent-ad": { id: "agent-ad", title: "Agent-Branded Listing Ad", purpose: "Puts the agent and company up front, with a contact end card.", aspect: "16:9", template: "modern" },
};

export interface BatchPhoto { id: string; width?: number | null; height?: number | null; camera?: CameraSpec | null }

export interface ListingAnalysis {
  photoCount: number;
  landscapePhotos: number;
  priceTier: "luxury" | "premium" | "standard" | "unknown";
  facts: string[];
  address: string;
  hasOpenHouse: boolean;
  hasAgent: boolean;
  hasContact: boolean;
  /** Plain-English notes shown on the dashboard. */
  notes: string[];
}

const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const round = (n: number) => Math.round(n * 100) / 100;

function factsOf(l: EasyListing): string[] {
  return [
    l.bedrooms != null ? plural(l.bedrooms, "bedroom", "bedrooms") : "",
    l.bathrooms != null ? plural(l.bathrooms, "bathroom", "bathrooms") : "",
    l.square_feet != null ? `${l.square_feet.toLocaleString("en-US")} sq ft` : "",
    l.property_type ? l.property_type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "",
  ].filter(Boolean);
}

/** Step 1 — look at the listing and its photos. */
export function analyzeListing(listing: EasyListing, photos: BatchPhoto[]): ListingAnalysis {
  const landscape = photos.filter((p) => p.width && p.height && p.width >= p.height).length;
  const price = listing.price ?? null;
  const priceTier = price == null ? "unknown" : price >= 1_500_000 ? "luxury" : price >= 750_000 ? "premium" : "standard";
  const facts = factsOf(listing);
  const notes: string[] = [];
  notes.push(`${photos.length} photos${landscape && landscape < photos.length ? ` (${landscape} wide, ${photos.length - landscape} tall)` : ""}.`);
  if (photos.length < 12) notes.push("With fewer than 12 photos some videos reuse fewer, longer shots.");
  notes.push(price != null ? `Price ${money(price)} — ${priceTier === "unknown" ? "" : `${priceTier} range`}.` : "No price on the listing — videos won't show one.");
  notes.push(facts.length ? `Facts used: ${facts.join(", ")}.` : "No bedrooms, bathrooms or size on the listing — Property Highlights will use photos only.");
  notes.push(listing.open_house_text ? `Open house: ${listing.open_house_text}.` : "No open house date — the Open House video invites people to ask for a showing instead (no date is made up).");
  if (!listing.agent_name) notes.push("No agent name on the listing — the agent ad uses the company name.");
  return {
    photoCount: photos.length, landscapePhotos: landscape, priceTier, facts,
    address: [listing.address_line, [listing.city, listing.state].filter(Boolean).join(", ")].filter(Boolean).join(", "),
    hasOpenHouse: !!listing.open_house_text, hasAgent: !!listing.agent_name, hasContact: !!(listing.contact_phone || listing.contact_email),
    notes,
  };
}

/* ── Photo selection ───────────────────────────────────────────────────── */

/** `count` photos spread evenly over the list, starting at `start` (wrapping), no repeats. */
export function spread<T>(items: T[], count: number, start = 0): T[] {
  if (items.length === 0) return [];
  const n = Math.min(count, items.length);
  const rotated = [...items.slice(start % items.length), ...items.slice(0, start % items.length)];
  if (n === rotated.length) return rotated;
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(rotated[Math.round((i * (rotated.length - 1)) / Math.max(1, n - 1))]!);
  return [...new Set(out)];
}

function coverFirst(photos: BatchPhoto[], coverId: string | null): BatchPhoto[] {
  const c = coverId ? photos.find((p) => p.id === coverId) : undefined;
  return c ? [c, ...photos.filter((p) => p.id !== coverId)] : [...photos];
}

/** Spread `total` seconds over `n` scenes (within limits), remainder on the last one. */
function lengths(n: number, total: number): number[] {
  const each = Math.min(MAX_SCENE_SECONDS, Math.max(MIN_SCENE_SECONDS, Math.floor((total / n) * 100) / 100));
  const out = Array.from({ length: n }, () => each);
  const last = round(out[n - 1]! + (total - each * n));
  if (last >= MIN_SCENE_SECONDS && last <= MAX_SCENE_SECONDS) out[n - 1] = last;
  return out;
}

/* ── The six recipes ───────────────────────────────────────────────────── */

export interface BatchInput {
  type: BatchType;
  listing: EasyListing;
  photos: BatchPhoto[];
  brand: EasyBrand | null;
  /** Changes photo choice and camera order ("Regenerate"). */
  variation?: number;
}

interface Recipe {
  pick: (photos: BatchPhoto[], v: number) => BatchPhoto[];
  seconds: (n: number) => number;
  transition: Transition;
  camera: (i: number, v: number) => CameraSpec;
  texts: (ctx: TextCtx) => TextOverlay[];
}
interface TextCtx { l: EasyListing; brand: EasyBrand | null; scenes: Scene[]; facts: string[] }

const t = (id: string, text: string, sceneId: string, style: TextOverlay["style"], position: TextOverlay["position"], duration: number | null = null): TextOverlay | null =>
  text.trim() ? { id, text: text.trim().slice(0, 200), sceneId, style, position, duration } : null;
const where = (l: EasyListing) => [l.city, l.state].filter(Boolean).join(", ");
const agentLine = (l: EasyListing, b: EasyBrand | null) => [l.agent_name, l.brokerage || b?.company_name].filter(Boolean).join(" · ");
const contact = (l: EasyListing) => [l.contact_phone, l.contact_email].filter(Boolean).join("  ·  ");
const at = (scenes: Scene[], i: number) => scenes[Math.max(0, Math.min(i, scenes.length - 1))]!.id;

const RECIPES: Record<BatchType, Recipe> = {
  "cinematic-tour": {
    pick: (p) => p.slice(0, 16),
    seconds: (n) => Math.min(60, n * 3.2),
    transition: "fade",
    camera: (i, v) => {
      const moves = ["push_in", "truck_right", "pull_out", "pan_left", "push_in", "truck_left"] as const;
      return defaultSpec(moves[(i + v) % moves.length]!, { strength: 0.4, lens: 24, motionBlur: 90, easing: "ease-in-out" });
    },
    texts: ({ l, brand, scenes }) => [
      t("hook", `Step inside\n${l.address_line}`, FIRST_SCENE, "title", "bottom"),
      t("where", where(l), at(scenes, 1), "caption", "bottom", 2.5),
      t("outro", [agentLine(l, brand), contact(l)].filter(Boolean).join("\n"), LAST_SCENE, "caption", "center"),
    ].filter(Boolean) as TextOverlay[],
  },
  "just-listed-reel": {
    pick: (p, v) => spread(p, 10, 1 + v),
    seconds: () => 15,
    transition: "whip",
    camera: (i) => defaultSpec(i % 2 ? "push_in" : "truck_right", { strength: 0.9, easing: "ease-out" }),
    texts: ({ l, scenes, facts }) => [
      t("hook", "JUST LISTED", FIRST_SCENE, "banner", "top"),
      t("price", l.price != null ? money(l.price) : "", FIRST_SCENE, "title", "bottom"),
      t("facts", facts.slice(0, 2).join(" · "), at(scenes, 3), "caption", "center"),
      t("where", l.address_line, at(scenes, 5), "caption", "bottom"),
      t("cta", ["Book your showing", contact(l)].filter(Boolean).join("\n"), LAST_SCENE, "banner", "center"),
    ].filter(Boolean) as TextOverlay[],
  },
  highlights: {
    pick: (p, v) => spread(p, 7, 2 + v),
    seconds: (n) => n * 4,
    transition: "wipe",
    camera: (i, v) => defaultSpec((i + v) % 2 ? "pan_right" : "tilt_up", { strength: 0.35, easing: "linear" }),
    texts: ({ l, scenes, facts }) => {
      const points = [...facts, l.price != null ? `Offered at ${money(l.price)}` : ""].filter(Boolean);
      const out = [t("hook", points.length ? `${points.length} things to know about\n${l.address_line}` : l.address_line, FIRST_SCENE, "title", "center")];
      points.slice(0, scenes.length - 1).forEach((p, i) => out.push(t(`fact${i}`, `${i + 1}  ·  ${p}`, at(scenes, i + 1), "banner", "bottom")));
      return out.filter(Boolean) as TextOverlay[];
    },
  },
  luxury: {
    pick: (p, v) => {
      const wide = p.filter((x) => !x.width || !x.height || x.width >= x.height);
      return spread(wide.length >= 6 ? wide : p, 7, 3 + v);
    },
    seconds: (n) => n * 5,
    transition: "fade",
    camera: (i, v) => defaultSpec((i + v) % 2 ? "pull_out" : "push_in", { strength: 0.3, lens: 50, motionBlur: 180, easing: "ease-in-out" }),
    texts: ({ l, brand, scenes }) => [
      t("hook", where(l) || l.address_line, FIRST_SCENE, "title", "center", 3.5),
      t("address", l.address_line, at(scenes, 1), "caption", "bottom", 3),
      t("price", l.price != null ? `Offered at ${money(l.price)}` : "", at(scenes, scenes.length - 2), "caption", "bottom"),
      t("outro", ["Private showings by appointment", agentLine(l, brand)].filter(Boolean).join("\n"), LAST_SCENE, "caption", "center"),
    ].filter(Boolean) as TextOverlay[],
  },
  "open-house": {
    pick: (p, v) => spread(p, 8, v),
    seconds: (n) => n * 3,
    transition: "zoom",
    camera: (i) => defaultSpec(i % 3 === 0 ? "pull_out" : "push_in", { strength: 0.55 }),
    texts: ({ l, scenes }) => {
      const date = l.open_house_text;
      return [
        t("hook", date ? `OPEN HOUSE\n${date}` : "VISIT THIS HOME\nAsk us for a showing", FIRST_SCENE, "banner", "center"),
        t("address", [l.address_line, where(l)].filter(Boolean).join("\n"), at(scenes, 1), "title", "bottom"),
        t("reminder", date ? `See you there\n${date}` : "", at(scenes, scenes.length - 2), "banner", "center"),
        t("cta", contact(l), LAST_SCENE, "caption", "center"),
      ].filter(Boolean) as TextOverlay[];
    },
  },
  "agent-ad": {
    pick: (p, v) => spread(p, 6, v * 2),
    seconds: (n) => n * 3.5,
    transition: "slide-left",
    camera: (i, v) => defaultSpec((i + v) % 2 ? "truck_left" : "push_in", { strength: 0.5 }),
    texts: ({ l, brand, scenes }) => {
      const who = l.agent_name || brand?.company_name || "";
      const co = l.brokerage || brand?.company_name || "";
      return [
        t("hook", who ? `${who} presents` : "Now presenting", FIRST_SCENE, "banner", "top"),
        t("address", l.address_line, FIRST_SCENE, "title", "bottom"),
        ...scenes.slice(1, -1).map((s, i) => t(`lower${i}`, `Listed by ${[who, co !== who ? co : ""].filter(Boolean).join(" · ")}`, s.id, "caption", "bottom")),
        t("end", [who, co !== who ? co : "", contact(l), brand?.outro_text ?? ""].filter(Boolean).join("\n"), LAST_SCENE, "banner", "center"),
      ].filter(Boolean) as TextOverlay[];
    },
  },
};

/** Step 2 — one storyboard for one video type. */
export function buildBatchPlan(input: BatchInput): EditPlan {
  const r = RECIPES[input.type];
  const v = input.variation ?? 0;
  const ordered = coverFirst(input.photos, input.listing.cover_asset_id);
  const chosen = r.pick(ordered, v);
  if (chosen.length === 0) throw new Error("Add photos to the listing first");
  const secs = lengths(chosen.length, Math.max(chosen.length * MIN_SCENE_SECONDS, r.seconds(chosen.length)));
  const scenes: Scene[] = chosen.map((p, i) => ({
    id: `s${i + 1}`, assetId: p.id, move: "still", duration: secs[i]!,
    // a move saved on the photo in Camera Studio wins over the recipe
    camera: p.camera ?? r.camera(i, v),
  }));
  const plan: EditPlan = {
    version: 1,
    aspect: BATCH_TYPE_INFO[input.type].aspect,
    transition: r.transition,
    scenes,
    texts: dedupeIds(r.texts({ l: input.listing, brand: input.brand, scenes, facts: factsOf(input.listing) })).slice(0, 20),
    music: { assetId: null, volume: 0.7, fadeOut: true },
  };
  return planSchema.parse(plan);
}

function dedupeIds(texts: TextOverlay[]): TextOverlay[] {
  const seen = new Set<string>();
  return texts.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
}

/** All six (or the first `max` when an administrator limits the batch size). */
export function buildBatch(input: Omit<BatchInput, "type">, max = BATCH_TYPES.length): { type: BatchType; plan: EditPlan }[] {
  return BATCH_TYPES.slice(0, Math.max(1, max)).map((type) => ({ type, plan: buildBatchPlan({ ...input, type }) }));
}

/** A short fingerprint of a storyboard's structure (used to prove the six are really different). */
export function structureOf(plan: EditPlan): string {
  const total = plan.scenes.reduce((s, x) => s + x.duration, 0);
  return [plan.aspect, plan.transition, plan.scenes.length, Math.round(total), plan.texts.map((x) => `${x.style}@${x.position}`).join(",")].join("|");
}
