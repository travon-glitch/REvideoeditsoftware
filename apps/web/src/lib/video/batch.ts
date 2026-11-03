/*
 * "Generate 6 Videos" (Stage 10): one listing → six distinct marketing videos.
 *
 *  1. Cinematic Property Tour       ~45 s · slow · every room in order · opens on the main photo
 *  2. Just Listed Reel              15 s · fast whip cuts · opens with a JUST LISTED banner
 *  3. Luxury Highlights             ~35 s · few long shots · one understated fact per scene
 *  4. Open House Promotion          ~24 s · opens on the date, repeats it before the end
 *  5. Short Social Media Reel       12 s · quickest cuts · price-first hook for the feed
 *  6. Agent-Branded Advertisement   ~21 s · opens on the agent, branded lower thirds, contact card
 *
 * Every video: address + price overlays (when the listing has a price), the company's
 * brand colours/fonts (and logo when the brand kit has one), a licensed music track
 * matched to the video's mood, a different opening photo, and its own pacing.
 * Shape is chosen per batch — vertical 1080×1920 by default.
 * Only facts from the listing record are used.
 */
import { defaultSpec, type CameraSpec } from "@lvs/camera-presets";
import {
  FIRST_SCENE, LAST_SCENE, MAX_SCENE_SECONDS, MIN_SCENE_SECONDS, planSchema,
  type Aspect, type EditPlan, type Scene, type TextOverlay, type Transition,
} from "@/lib/video/plan";
import type { EasyBrand, EasyListing } from "@/lib/video/easy";

export const BATCH_TYPES = ["cinematic-tour", "just-listed-reel", "luxury-highlights", "open-house", "social-reel", "agent-ad"] as const;
export type BatchType = (typeof BATCH_TYPES)[number];
/** Types made by the Stage 8 generator — still shown for older batches. */
export const LEGACY_BATCH_TYPES = ["highlights", "luxury"] as const;
export type AnyBatchType = BatchType | (typeof LEGACY_BATCH_TYPES)[number];

export type MusicMood = "elegant" | "calm" | "upbeat" | "warm" | "inspiring";

export interface BatchTypeInfo { title: string; purpose: string; emphasis: string; mood: MusicMood; template: string }
export const BATCH_TYPE_INFO: Record<AnyBatchType, BatchTypeInfo> = {
  "cinematic-tour": { title: "Cinematic Property Tour", purpose: "A slow, complete tour of the home for websites and YouTube.", emphasis: "The flow of the home, room to room", mood: "inspiring", template: "luxury" },
  "just-listed-reel": { title: "Just Listed Reel", purpose: "A fast announcement that the home is on the market.", emphasis: "New on the market + price", mood: "upbeat", template: "just-listed" },
  "luxury-highlights": { title: "Luxury Highlights", purpose: "Fewer, longer, elegant shots with one key fact at a time.", emphasis: "Quality and key facts", mood: "elegant", template: "luxury" },
  "open-house": { title: "Open House Promotion", purpose: "Invites people to the open house — date first, again at the end.", emphasis: "Date, time and place", mood: "warm", template: "open-house" },
  "social-reel": { title: "Short Social Media Reel", purpose: "The quickest version for the feed: price and address up front.", emphasis: "Scroll-stopping price hook", mood: "upbeat", template: "social-reel" },
  "agent-ad": { title: "Agent-Branded Advertisement", purpose: "Puts the agent and company first, with a contact end card.", emphasis: "The agent and how to reach them", mood: "calm", template: "modern" },
  highlights: { title: "Property Highlights", purpose: "Key facts one per scene (Stage 8).", emphasis: "Facts", mood: "calm", template: "highlights" },
  luxury: { title: "Luxury-Style Video", purpose: "Elegant long shots (Stage 8).", emphasis: "Elegance", mood: "elegant", template: "luxury" },
};

export const SHAPES: { aspect: Aspect; label: string; size: string }[] = [
  { aspect: "9:16", label: "Vertical", size: "1080×1920" },
  { aspect: "16:9", label: "Wide", size: "1920×1080" },
  { aspect: "1:1", label: "Square", size: "1080×1080" },
];
export const DEFAULT_BATCH_ASPECT: Aspect = "9:16";

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
  notes.push(price != null ? `Price ${money(price)}${priceTier === "unknown" ? "" : ` — ${priceTier} range`}. Shown on every video.` : "No price on the listing — videos won't show one.");
  notes.push(facts.length ? `Facts used: ${facts.join(", ")}.` : "No bedrooms, bathrooms or size on the listing — Luxury Highlights will use photos only.");
  notes.push(listing.open_house_text ? `Open house: ${listing.open_house_text}.` : "No open house date — the Open House video invites people to ask for a showing instead (no date is made up).");
  if (!listing.agent_name) notes.push("No agent name on the listing — the agent ad uses the company name.");
  return {
    photoCount: photos.length, landscapePhotos: landscape, priceTier, facts,
    address: [listing.address_line, [listing.city, listing.state].filter(Boolean).join(", ")].filter(Boolean).join(", "),
    hasOpenHouse: !!listing.open_house_text, hasAgent: !!listing.agent_name, hasContact: !!(listing.contact_phone || listing.contact_email),
    notes,
  };
}

/** `count` items spread evenly, starting at `start` (wrapping), no repeats. */
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

function lengths(n: number, total: number): number[] {
  const each = Math.min(MAX_SCENE_SECONDS, Math.max(MIN_SCENE_SECONDS, Math.floor((total / n) * 100) / 100));
  const out = Array.from({ length: n }, () => each);
  const last = round(out[n - 1]! + (total - each * n));
  if (last >= MIN_SCENE_SECONDS && last <= MAX_SCENE_SECONDS) out[n - 1] = last;
  return out;
}

export interface BatchInput {
  type: BatchType;
  listing: EasyListing;
  photos: BatchPhoto[];
  brand: EasyBrand | null;
  /** Shape for the whole batch (vertical by default). */
  aspect?: Aspect;
  /** A licensed library track for this video. */
  musicAssetId?: string | null;
  /** The company's brand logo (media asset), shown in the corner. */
  logoAssetId?: string | null;
  /** Changes photo choice and camera order ("Regenerate"). */
  variation?: number;
}

interface Recipe {
  /** Which photo opens the video (index into the cover-first list). */
  opener: (photos: BatchPhoto[]) => number;
  count: number;
  seconds: (n: number) => number;
  transition: Transition;
  camera: (i: number, v: number) => CameraSpec;
  texts: (c: TextCtx) => (TextOverlay | null)[];
}
interface TextCtx { l: EasyListing; brand: EasyBrand | null; scenes: Scene[]; facts: string[]; price: string; address: string; where: string }

const t = (id: string, text: string, sceneId: string, style: TextOverlay["style"], position: TextOverlay["position"], duration: number | null = null): TextOverlay | null =>
  text.trim() ? { id, text: text.trim().slice(0, 200), sceneId, style, position, duration } : null;
const at = (scenes: Scene[], i: number) => scenes[Math.max(0, Math.min(i, scenes.length - 1))]!.id;
const agentLine = (l: EasyListing, b: EasyBrand | null) => [l.agent_name, l.brokerage || b?.company_name].filter(Boolean).join(" · ");
const contact = (l: EasyListing) => [l.contact_phone, l.contact_email].filter(Boolean).join("  ·  ");
const firstWide = (from: number) => (p: BatchPhoto[]) => {
  const i = p.findIndex((x, k) => k >= from && (!x.width || !x.height || x.width >= x.height));
  return i >= 0 ? i : from;
};

const RECIPES: Record<BatchType, Recipe> = {
  "cinematic-tour": {
    opener: () => 0, count: 14, seconds: (n) => Math.min(48, n * 3.2), transition: "fade",
    camera: (i, v) => defaultSpec((["push_in", "truck_right", "pull_out", "pan_left", "push_in", "truck_left"] as const)[(i + v) % 6]!, { strength: 0.4, lens: 24, motionBlur: 90 }),
    texts: ({ l, brand, scenes, address, where, price, facts }) => [
      t("hook", `Welcome to\n${address}`, FIRST_SCENE, "title", "bottom"),
      t("where", where, at(scenes, 1), "caption", "bottom", 2.5),
      t("price", [price ? `Offered at ${price}` : "", facts.slice(0, 2).join(" · ")].filter(Boolean).join("\n"), at(scenes, 2), "caption", "bottom"),
      t("outro", [address, agentLine(l, brand), contact(l)].filter(Boolean).join("\n"), LAST_SCENE, "caption", "center"),
    ],
  },
  "just-listed-reel": {
    opener: () => 1, count: 10, seconds: () => 15, transition: "whip",
    camera: (i) => defaultSpec(i % 2 ? "push_in" : "truck_right", { strength: 0.9, easing: "ease-out" }),
    texts: ({ l, scenes, address, price, facts }) => [
      t("hook", "JUST LISTED", FIRST_SCENE, "banner", "top"),
      t("address", address, FIRST_SCENE, "title", "bottom"),
      t("price", price, at(scenes, 1), "banner", "center"),
      t("facts", facts.slice(0, 2).join(" · "), at(scenes, 3), "caption", "bottom"),
      t("cta", ["Book your showing", contact(l)].filter(Boolean).join("\n"), LAST_SCENE, "banner", "center"),
    ],
  },
  "luxury-highlights": {
    opener: firstWide(2), count: 7, seconds: (n) => n * 5, transition: "fade",
    camera: (i, v) => defaultSpec((i + v) % 2 ? "pull_out" : "push_in", { strength: 0.3, lens: 50, motionBlur: 180 }),
    texts: ({ l, brand, scenes, address, where, price, facts }) => {
      const points = [...facts, price ? `Offered at ${price}` : ""].filter(Boolean);
      return [
        t("hook", [where, address].filter(Boolean).join("\n"), FIRST_SCENE, "title", "center", 3.5),
        ...points.slice(0, Math.max(0, scenes.length - 2)).map((p, i) => t(`fact${i}`, p, at(scenes, i + 1), "caption", "bottom")),
        // the price always appears (also when there are more facts than scenes)
        points.length > scenes.length - 2 && price ? t("price", `Offered at ${price}`, at(scenes, scenes.length - 2), "caption", "top") : null,
        t("outro", ["Private showings by appointment", agentLine(l, brand)].filter(Boolean).join("\n"), LAST_SCENE, "caption", "center"),
      ];
    },
  },
  "open-house": {
    opener: () => 3, count: 8, seconds: (n) => n * 3, transition: "zoom",
    camera: (i) => defaultSpec(i % 3 === 0 ? "pull_out" : "push_in", { strength: 0.55 }),
    texts: ({ l, scenes, address, where, price }) => {
      const date = l.open_house_text;
      return [
        t("hook", date ? `OPEN HOUSE\n${date}` : "VISIT THIS HOME\nAsk us for a showing", FIRST_SCENE, "banner", "center"),
        t("address", [address, where].filter(Boolean).join("\n"), at(scenes, 1), "title", "bottom"),
        t("price", price, at(scenes, 2), "caption", "bottom"),
        t("reminder", date ? `See you there\n${date}` : "", at(scenes, scenes.length - 2), "banner", "center"),
        t("cta", [address, contact(l)].filter(Boolean).join("\n"), LAST_SCENE, "caption", "center"),
      ];
    },
  },
  "social-reel": {
    opener: (p) => p.length - 1, count: 8, seconds: () => 12, transition: "slide-left",
    camera: (i) => defaultSpec(i % 2 ? "zoom" : "pan_left", { strength: 0.8, easing: "ease-out" }),
    texts: ({ l, scenes, address, price, facts }) => [
      t("hook", price ? price : "Take a look inside", FIRST_SCENE, "banner", "top"),
      t("address", address, FIRST_SCENE, "title", "bottom"),
      t("facts", facts.slice(0, 3).join(" · "), at(scenes, 2), "caption", "center"),
      t("cta", ["Message us for details", l.contact_phone ?? ""].filter(Boolean).join("\n"), LAST_SCENE, "banner", "center"),
    ],
  },
  "agent-ad": {
    opener: () => 4, count: 6, seconds: (n) => n * 3.5, transition: "wipe",
    camera: (i, v) => defaultSpec((i + v) % 2 ? "truck_left" : "push_in", { strength: 0.5 }),
    texts: ({ l, brand, scenes, address, price }) => {
      const who = l.agent_name || brand?.company_name || "";
      const co = l.brokerage || brand?.company_name || "";
      return [
        t("hook", who ? `${who}${co && co !== who ? `\n${co}` : ""}\npresents` : "Now presenting", FIRST_SCENE, "banner", "center"),
        t("address", address, at(scenes, 1), "title", "bottom"),
        t("price", price ? `Listed at ${price}` : "", at(scenes, 2), "caption", "bottom"),
        ...scenes.slice(3, -1).map((s, i) => t(`lower${i}`, `Listed by ${[who, co !== who ? co : ""].filter(Boolean).join(" · ")}`, s.id, "caption", "bottom")),
        t("end", [who, co !== who ? co : "", contact(l), brand?.outro_text ?? ""].filter(Boolean).join("\n"), LAST_SCENE, "banner", "center"),
      ];
    },
  },
};

/** Step 2 — one original storyboard for one video type. */
export function buildBatchPlan(input: BatchInput): EditPlan {
  const r = RECIPES[input.type];
  const v = input.variation ?? 0;
  const ordered = coverFirst(input.photos, input.listing.cover_asset_id);
  if (ordered.length === 0) throw new Error("Add photos to the listing first");
  const openerIndex = (r.opener(ordered) + v) % ordered.length;
  const opener = ordered[openerIndex]!;
  const rest = ordered.filter((p) => p.id !== opener.id);
  const chosen = [opener, ...spread(rest, r.count - 1, (openerIndex + v * 3) % Math.max(1, rest.length))];
  const secs = lengths(chosen.length, Math.max(chosen.length * MIN_SCENE_SECONDS, r.seconds(chosen.length)));
  const scenes: Scene[] = chosen.map((p, i) => ({
    id: `s${i + 1}`, assetId: p.id, move: "still", duration: secs[i]!,
    camera: p.camera ?? r.camera(i, v),
  }));
  const l = input.listing;
  const texts = r.texts({
    l, brand: input.brand, scenes, facts: factsOf(l), price: l.price != null ? money(l.price) : "",
    address: l.address_line.trim(), where: [l.city, l.state].filter(Boolean).join(", "),
  }).filter((x): x is TextOverlay => !!x);
  const seen = new Set<string>();
  return planSchema.parse({
    version: 1,
    aspect: input.aspect ?? DEFAULT_BATCH_ASPECT,
    transition: r.transition,
    scenes,
    texts: texts.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true))).slice(0, 20),
    music: { assetId: input.musicAssetId ?? null, volume: 0.6, fadeOut: true },
    ...(input.logoAssetId ? { logoAssetId: input.logoAssetId } : {}),
  });
}

/** All six (or the first `max` when an administrator limits the batch size). */
export function buildBatch(input: Omit<BatchInput, "type" | "musicAssetId"> & { music?: Partial<Record<BatchType, string | null>> }, max = BATCH_TYPES.length): { type: BatchType; plan: EditPlan }[] {
  return BATCH_TYPES.slice(0, Math.max(1, max)).map((type) => ({ type, plan: buildBatchPlan({ ...input, type, musicAssetId: input.music?.[type] ?? null }) }));
}

/** A short fingerprint of a storyboard's structure (used to prove the six are really different). */
export function structureOf(plan: EditPlan): string {
  const total = plan.scenes.reduce((s, x) => s + x.duration, 0);
  return [plan.transition, plan.scenes.length, Math.round(total), plan.texts.map((x) => `${x.style}@${x.position}`).join(",")].join("|");
}

/** Rough render time: about twice the video length per video on one renderer. */
export function estimateRenderMinutes(plans: EditPlan[], concurrent: number): number {
  const seconds = plans.reduce((s, p) => s + p.scenes.reduce((a, x) => a + x.duration, 0) * 2.2 + 15, 0);
  return Math.max(1, Math.round(seconds / 60 / Math.max(1, concurrent)));
}
