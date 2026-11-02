/*
 * Easy Mode: six ready-made styles, the simple settings people choose, and the
 * rule-based "Auto Create" storyboard maker.
 *
 * Easy Mode never asks for camera or rendering settings. It turns
 * (listing + photos + a few plain choices) into the same EditPlan the Advanced
 * editor uses, so both modes work on one saved project.
 *
 * "Auto Create with AI" uses autoDirector() below — a transparent rule-based
 * generator — until an AI Director service is connected. It is labeled as such.
 */
import { z } from "zod";
import type { CameraSpec } from "@lvs/camera-presets";
import {
  FIRST_SCENE, LAST_SCENE, MAX_SCENE_SECONDS, MAX_SCENES, MIN_SCENE_SECONDS, STILL,
  type Aspect, type EditPlan, type Scene, type TextOverlay, type Transition,
} from "@/lib/video/plan";

export const STYLE_IDS = ["luxury", "modern", "just-listed", "open-house", "social-reel", "highlights"] as const;
export type StyleId = (typeof STYLE_IDS)[number];

export const DURATIONS = [15, 30, 60] as const;
export type EasyDuration = (typeof DURATIONS)[number];

export const DURATION_LABELS: Record<EasyDuration, { label: string; hint: string }> = {
  15: { label: "Short", hint: "about 15 seconds — great for social media" },
  30: { label: "Standard", hint: "about 30 seconds — works everywhere" },
  60: { label: "Long", hint: "about 1 minute — shows every room" },
};

export const ORIENTATION_LABELS: Record<Aspect, { label: string; hint: string }> = {
  "16:9": { label: "Wide", hint: "YouTube, websites, MLS" },
  "9:16": { label: "Tall", hint: "Reels, TikTok, Shorts, Stories" },
  "1:1": { label: "Square", hint: "Facebook and Instagram posts" },
};

export interface StyleDef {
  id: StyleId;
  name: string;
  description: string;
  aspect: Aspect;
  duration: EasyDuration;
  /** Shortest scene this style uses (fewer, longer scenes feel calmer). */
  minScene: number;
  moves: string[];
  transition: Transition;
}

export const STYLES: Record<StyleId, StyleDef> = {
  luxury: {
    id: "luxury", name: "Luxury Cinematic", description: "Slow, elegant moves and refined titles.",
    aspect: "16:9", duration: 30, minScene: 3.5, moves: ["push_in", "pan_right", "pull_out", "pan_left"], transition: "fade",
  },
  modern: {
    id: "modern", name: "Modern", description: "Clean, quick cuts with bold text.",
    aspect: "16:9", duration: 30, minScene: 2, moves: ["pan_left", "push_in", "pan_right", "pull_out"], transition: "slide-left",
  },
  "just-listed": {
    id: "just-listed", name: "Just Listed", description: "Announces a new listing with a bold banner.",
    aspect: "16:9", duration: 30, minScene: 2, moves: ["push_in", "pan_right", "push_in", "pan_left"], transition: "zoom",
  },
  "open-house": {
    id: "open-house", name: "Open House", description: "Invites people with the date and time up front.",
    aspect: "1:1", duration: 30, minScene: 2.5, moves: ["push_in", "pan_left", "pull_out", "pan_right"], transition: "fade",
  },
  "social-reel": {
    id: "social-reel", name: "Social Media Reel", description: "Short, fast and vertical for Reels and TikTok.",
    aspect: "9:16", duration: 15, minScene: 1.5, moves: ["push_in", "pan_left", "push_in", "pan_right"], transition: "whip",
  },
  highlights: {
    id: "highlights", name: "Property Highlights", description: "Shows the key facts one by one.",
    aspect: "16:9", duration: 30, minScene: 3, moves: ["pan_right", "push_in", "pan_left", "pull_out"], transition: "wipe",
  },
};

export const easySettingsSchema = z.object({
  style: z.enum(STYLE_IDS),
  duration: z.union([z.literal(15), z.literal(30), z.literal(60)]),
  aspect: z.enum(["16:9", "9:16", "1:1"]),
  musicAssetId: z.string().uuid().nullable(),
  showBranding: z.boolean(),
  aiEffects: z.boolean(),
});
export type EasySettings = z.infer<typeof easySettingsSchema>;

/** What Easy Mode knows about the listing (from the listing record). */
export interface EasyListing {
  address_line: string;
  city: string | null;
  state: string | null;
  price: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  square_feet: number | null;
  property_type: string | null;
  status: string;
  agent_name: string | null;
  brokerage: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  open_house_text: string | null;
  cover_asset_id: string | null;
}

export interface EasyBrand { company_name: string | null; outro_text: string | null }

const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function defaultSettings(style: StyleId = "modern"): EasySettings {
  return { style, duration: STYLES[style].duration, aspect: STYLES[style].aspect, musicAssetId: null, showBranding: true, aiEffects: false };
}

/**
 * Which photos to use, in order: main photo first, then the listing order.
 * If there isn't time for all of them, an even spread is kept (first and last always included).
 */
export function pickPhotos<T extends { id: string }>(photos: T[], coverId: string | null, seconds: number, minScene: number): T[] {
  const ordered = coverId && photos.some((p) => p.id === coverId)
    ? [photos.find((p) => p.id === coverId)!, ...photos.filter((p) => p.id !== coverId)]
    : [...photos];
  const room = Math.max(1, Math.min(MAX_SCENES, Math.floor(seconds / minScene)));
  if (ordered.length <= room) return ordered;
  if (room === 1) return [ordered[0]!];
  const out: T[] = [];
  for (let i = 0; i < room; i++) out.push(ordered[Math.round((i * (ordered.length - 1)) / (room - 1))]!);
  return [...new Map(out.map((p) => [p.id, p])).values()];
}

function sceneDurations(count: number, seconds: number): number[] {
  const each = Math.min(MAX_SCENE_SECONDS, Math.max(MIN_SCENE_SECONDS, Math.floor((seconds / count) * 100) / 100));
  const list = Array.from({ length: count }, () => each);
  const rest = Math.round((seconds - each * count) * 100) / 100;
  const last = Math.round((list[count - 1]! + rest) * 100) / 100;
  if (rest !== 0 && last >= MIN_SCENE_SECONDS && last <= MAX_SCENE_SECONDS) list[count - 1] = last;
  return list;
}

function texts(style: StyleId, l: EasyListing, scenes: Scene[], brand: EasyBrand | null, showBranding: boolean): TextOverlay[] {
  const out: TextOverlay[] = [];
  const add = (id: string, text: string, sceneId: string, s: TextOverlay["style"], position: TextOverlay["position"], duration: number | null = null) => {
    if (text.trim()) out.push({ id, text: text.trim(), sceneId, style: s, position, duration });
  };
  const where = [l.city, l.state].filter(Boolean).join(", ");
  const address = [l.address_line, where].filter(Boolean).join("\n");
  const price = l.price != null ? money(l.price) : "";
  const facts = [
    l.bedrooms != null ? plural(l.bedrooms, "bedroom", "bedrooms") : "",
    l.bathrooms != null ? plural(l.bathrooms, "bathroom", "bathrooms") : "",
    l.square_feet != null ? `${l.square_feet.toLocaleString("en-US")} sq ft` : "",
  ].filter(Boolean);
  const at = (i: number) => scenes[Math.min(i, scenes.length - 1)]!.id;
  const many = scenes.length > 2;

  switch (style) {
    case "luxury":
      add("t_address", address, FIRST_SCENE, "title", "bottom");
      if (many) add("t_price", [price, facts.join("  ·  ")].filter(Boolean).join("\n"), at(1), "caption", "bottom");
      break;
    case "modern":
      add("t_address", address, FIRST_SCENE, "title", "center");
      if (many) add("t_facts", facts.join("  ·  "), at(1), "caption", "bottom");
      if (many && price) add("t_price", price, at(2), "banner", "bottom");
      break;
    case "just-listed":
      add("t_banner", "JUST LISTED", FIRST_SCENE, "banner", "top");
      add("t_address", address, FIRST_SCENE, "title", "bottom");
      if (many) add("t_price", [price, facts.join("  ·  ")].filter(Boolean).join("\n"), at(1), "caption", "bottom");
      break;
    case "open-house":
      add("t_banner", `OPEN HOUSE${l.open_house_text ? `\n${l.open_house_text}` : ""}`, FIRST_SCENE, "banner", "center");
      add("t_address", address, at(1), "title", "bottom");
      if (scenes.length > 3 && l.open_house_text) add("t_reminder", `See you there\n${l.open_house_text}`, at(scenes.length - 2), "banner", "center");
      break;
    case "social-reel":
      add("t_address", l.address_line, FIRST_SCENE, "title", "top");
      if (price) add("t_price", price, FIRST_SCENE, "banner", "bottom");
      if (many && facts.length) add("t_facts", facts.join(" · "), at(2), "caption", "center");
      break;
    case "highlights": {
      add("t_address", address, FIRST_SCENE, "title", "bottom");
      const points = [...facts, price ? `Offered at ${price}` : ""].filter(Boolean);
      points.forEach((p, i) => { if (i + 1 < scenes.length - 1) add(`t_fact_${i}`, p, at(i + 1), "banner", "bottom"); });
      break;
    }
  }

  if (showBranding && scenes.length > 1) {
    const agent = [l.agent_name, l.brokerage || brand?.company_name].filter(Boolean).join(" · ");
    const contact = [l.contact_phone, l.contact_email].filter(Boolean).join("  ·  ");
    add("t_outro", [agent, contact, brand?.outro_text ?? ""].filter(Boolean).join("\n"), LAST_SCENE, "caption", "center");
  }
  return out;
}

/** Easy settings + listing + photos → a full EditPlan (the same model the Advanced editor uses). */
export function buildEasyPlan(input: {
  listing: EasyListing;
  /** `camera`: the photo's own Camera Studio move, used instead of the style's move. */
  photos: { id: string; camera?: CameraSpec | null }[];
  settings: EasySettings;
  brand: EasyBrand | null;
  /** Photo order chosen by the person (otherwise: main photo first, then the listing order). */
  order?: string[];
  /** Photos the person left out. */
  skipped?: string[];
}): EditPlan & { easy: EasySettings & { customized: false; order?: string[]; skipped?: string[] } } {
  const skipped = new Set(input.skipped ?? []);
  const photos = orderPhotos(input.photos, input.order).filter((p) => !skipped.has(p.id));
  if (photos.length === 0) throw new Error("Add at least one photo first");
  const style = STYLES[input.settings.style];
  const chosen = pickPhotos(photos, input.order?.length ? null : input.listing.cover_asset_id, input.settings.duration, style.minScene);
  const lengths = sceneDurations(chosen.length, input.settings.duration);
  const scenes: Scene[] = chosen.map((p, i) => ({
    id: `s${i + 1}`,
    assetId: p.id,
    move: style.moves[i % style.moves.length] ?? STILL,
    duration: lengths[i]!,
    ...(p.camera ? { camera: p.camera } : {}),
  }));
  return {
    version: 1,
    aspect: input.settings.aspect,
    transition: style.transition,
    scenes,
    texts: texts(style.id, input.listing, scenes, input.brand, input.settings.showBranding),
    music: { assetId: input.settings.musicAssetId, volume: 0.7, fadeOut: true },
    easy: {
      ...input.settings, customized: false,
      ...(input.order?.length ? { order: input.order.slice(0, 60) } : {}),
      ...(skipped.size ? { skipped: [...skipped].slice(0, 60) } : {}),
    },
  };
}

/** Photos in the chosen order; photos not in the order (e.g. just uploaded) go at the end. */
export function orderPhotos<T extends { id: string }>(photos: T[], order?: string[]): T[] {
  if (!order?.length) return [...photos];
  const rank = new Map(order.map((id, i) => [id, i]));
  return photos
    .map((p, i) => ({ p, r: rank.get(p.id) ?? order.length + i }))
    .sort((a, b) => a.r - b.r)
    .map((x) => x.p);
}

export interface DirectorChoice { settings: EasySettings; reasons: string[] }

/**
 * The rule-based "Auto Create" storyboard maker (used until an AI Director is connected).
 * Every choice comes from facts about the listing — nothing is invented.
 */
export function autoDirector(input: {
  listing: EasyListing;
  photoCount: number;
  musicAssetIds: string[];
  companyDefaults?: { aspect?: Aspect };
}): DirectorChoice {
  const l = input.listing;
  const reasons: string[] = [];
  let style: StyleId;
  if (l.open_house_text) { style = "open-house"; reasons.push("This listing has an open house date, so the video invites people to it."); }
  else if (l.status === "coming_soon" || l.status === "for_sale") { style = "just-listed"; reasons.push("The home is for sale, so the video announces it as just listed."); }
  else if ((l.price ?? 0) >= 1_000_000) { style = "luxury"; reasons.push("The price suggests a luxury property, so the video uses slow, elegant moves."); }
  else if (l.bedrooms != null || l.bathrooms != null || l.square_feet != null) { style = "highlights"; reasons.push("The video shows the home's key facts one by one."); }
  else { style = "modern"; reasons.push("A clean, modern style works for any home."); }

  const duration: EasyDuration = input.photoCount >= 18 ? 60 : input.photoCount >= 6 ? 30 : 15;
  reasons.push(`${input.photoCount} photos fit a ${DURATION_LABELS[duration].label.toLowerCase()} video (${DURATION_LABELS[duration].hint}).`);
  const aspect = input.companyDefaults?.aspect ?? STYLES[style].aspect;
  reasons.push(`${ORIENTATION_LABELS[aspect].label} shape — best for ${ORIENTATION_LABELS[aspect].hint}.`);
  const musicAssetId = input.musicAssetIds[0] ?? null;
  reasons.push(musicAssetId ? "Your music is added and fades out at the end." : "No music yet — you can add some in step 3.");
  reasons.push("The main photo opens the video, and your contact details close it.");
  return { settings: { style, duration, aspect, musicAssetId, showBranding: true, aiEffects: false }, reasons };
}
