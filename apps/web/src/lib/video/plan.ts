/*
 * The editor's model ("edit plan") and how it becomes a FableCut project.
 *
 * People edit a simple plan: an ordered list of scenes (photo + camera move +
 * length), text overlays pinned to scenes, music, a transition and a format.
 * composeDocument() turns the plan into FableCut's project.json (timeline,
 * keyframes, transitions, text clips, audio clip), which FableCut validates
 * and renders. The plan is stored next to the document so the editor can
 * reopen it exactly.
 */
import { z } from "zod";
import { BACKGROUND_LOOK, CAMERA_MOVES, cameraKeyframes, evalChannel, getMove, kenBurnsKeyframes, mixHex, type CameraChannels, type FrameBackground } from "@lvs/camera-presets";
import { cameraSpecSchema } from "./camera";
import { brandLayerClips, type BrandImage } from "./brand-layers";
import { captionClips, itemKeyframes, musicClip, overlayClips, voiceClip } from "./editor-layers";

export const ASPECTS = ["16:9", "9:16", "1:1", "4:5"] as const;
export type Aspect = (typeof ASPECTS)[number];

export const ASPECT_LABELS: Record<Aspect, string> = {
  "16:9": "Horizontal 16:9",
  "9:16": "Vertical 9:16",
  "1:1": "Square 1:1",
  "4:5": "Portrait 4:5",
};

/** 1080p canvas for each format. */
export const CANVAS_1080: Record<Aspect, { width: number; height: number }> = {
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
};

export const TRANSITIONS = ["fade", "slide-left", "zoom", "wipe", "whip", "none"] as const;
export type Transition = (typeof TRANSITIONS)[number];
export const TRANSITION_LABELS: Record<Transition, string> = {
  fade: "Soft fade", "slide-left": "Slide", zoom: "Zoom", wipe: "Wipe", whip: "Quick whip", none: "Straight cut",
};

export const TEXT_STYLES = ["title", "caption", "banner"] as const;
export type TextStyle = (typeof TEXT_STYLES)[number];
export const TEXT_STYLE_LABELS: Record<TextStyle, string> = { title: "Big title", caption: "Caption with box", banner: "Color banner" };

export const TEXT_POSITIONS = ["top", "center", "bottom"] as const;
export type TextPosition = (typeof TEXT_POSITIONS)[number];

/* ── Template look and branding layers (Stage 11) ─────────────────────── */

/** Fonts bundled with the renderer (no network needed to draw them). */
export const BRAND_FONTS = [
  "Montserrat", "Inter", "Playfair Display", "Poppins", "Lato", "Roboto", "Oswald", "Bebas Neue", "Anton",
  "Archivo Black", "DM Sans", "Barlow", "Rubik", "Teko", "Abril Fatface",
] as const;
export type BrandFont = (typeof BRAND_FONTS)[number];
/** FableCut text animations used by templates. */
export const TEXT_ANIMS = ["none", "rise-mask", "clip-reveal", "zoom-in", "word-slide", "word-pop", "letter-pop", "typewriter"] as const;
export type TextAnim = (typeof TEXT_ANIMS)[number];
/** FableCut photo looks used by templates. */
export const PHOTO_FILTERS = ["none", "cinematic", "warm", "cold", "pop", "dreamy", "sunset", "midnight", "faded"] as const;
export type PhotoFilter = (typeof PHOTO_FILTERS)[number];
export const INTRO_STYLES = ["none", "logo-reveal", "bar-wipe", "title-card"] as const;
export type IntroStyle = (typeof INTRO_STYLES)[number];
export const OUTRO_STYLES = ["none", "agent-card", "logo-end", "contact-bar"] as const;
export type OutroStyle = (typeof OUTRO_STYLES)[number];
export const AGENT_LAYOUTS = ["photo-left", "centered", "minimal"] as const;
export type AgentLayout = (typeof AGENT_LAYOUTS)[number];

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const line = (max: number) => z.string().trim().max(max);

export const lookSchema = z.object({
  /** The template this look came from. */
  template: z.string().max(48),
  headingFont: z.enum(BRAND_FONTS),
  bodyFont: z.enum(BRAND_FONTS),
  titleAnim: z.enum(TEXT_ANIMS),
  captionAnim: z.enum(TEXT_ANIMS),
  bannerAnim: z.enum(TEXT_ANIMS),
  uppercase: z.boolean(),
  letterSpacing: z.number().min(0).max(24),
  /** Banner / bar colour, panel colour behind cards, text colour. */
  accent: hex,
  panel: hex,
  text: hex,
  filter: z.enum(PHOTO_FILTERS),
  /** Cinema bars top and bottom. */
  letterbox: z.boolean().optional(),
});
export type PlanLook = z.infer<typeof lookSchema>;

export const agentCardSchema = z.object({
  name: line(120).min(1),
  title: line(80).optional(),
  phone: line(40).optional(),
  email: line(160).optional(),
  brokerage: line(160).optional(),
  license: line(60).optional(),
  headshotAssetId: z.string().uuid().optional(),
  layout: z.enum(AGENT_LAYOUTS),
});
export type AgentCard = z.infer<typeof agentCardSchema>;

export const brandingSchema = z.object({
  intro: z.object({ style: z.enum(INTRO_STYLES), seconds: z.number().min(1).max(4), title: line(80).optional() }),
  outro: z.object({ style: z.enum(OUTRO_STYLES), seconds: z.number().min(2).max(8) }),
  agent: agentCardSchema.nullable(),
  companyName: line(120).optional(),
  /** Company logo used by the intro / outro animation. */
  logoAssetId: z.string().uuid().optional(),
  brokerageLogoAssetId: z.string().uuid().optional(),
  /** Required brokerage disclosure, shown small on the last scene. */
  disclosure: line(500).optional(),
});
export type PlanBranding = z.infer<typeof brandingSchema>;

export const STILL = "still";
export const SCENE_MOVES = [STILL, ...CAMERA_MOVES.map((m) => m.id)] as const;

export const MIN_SCENE_SECONDS = 1.5;
export const MAX_SCENE_SECONDS = 10;
export const MAX_SCENES = 30;
export const MAX_TEXTS = 20;
export const TRANSITION_SECONDS = 0.5;
export const TARGET_SECONDS = 30;

const id = z.string().regex(/^[a-z0-9_-]{1,40}$/i);
const uuid = z.string().uuid();

/* ── Stage 12: advanced editor ──────────────────────────────────────── */

/** A keyframe on a text or overlay: `t` seconds from the item's start; x/y are fractions of the frame from its centre. */
export const keySchema = z.object({
  t: z.number().min(0).max(60),
  x: z.number().min(-1).max(1).optional(),
  y: z.number().min(-1).max(1).optional(),
  scale: z.number().min(0.05).max(5).optional(),
  rotation: z.number().min(-360).max(360).optional(),
  opacity: z.number().min(0).max(1).optional(),
  ease: z.enum(["linear", "ease-in", "ease-out", "ease-in-out"]).optional(),
});
export type ItemKey = z.infer<typeof keySchema>;

export const OVERLAY_PRESETS = ["lower-third", "badge", "arrow", "frame", "underline", "sparkle", "sold-stamp", "price-tag"] as const;
export type OverlayPreset = (typeof OVERLAY_PRESETS)[number];
export const OVERLAY_LABELS: Record<OverlayPreset, string> = {
  "lower-third": "Lower-third bar", badge: "Round badge", arrow: "Pointing arrow", frame: "Frame border", underline: "Drawn underline",
  sparkle: "Sparkles", "sold-stamp": "Stamp", "price-tag": "Price tag",
};
export const ANIM_IN = ["none", "fade", "pop", "slide-up", "slide-left", "draw"] as const;
export const ANIM_OUT = ["none", "fade", "pop", "slide-down", "slide-right"] as const;

export const overlaySchema = z.object({
  id,
  preset: z.enum(OVERLAY_PRESETS),
  /** Seconds on the timeline. */
  start: z.number().min(0).max(600),
  duration: z.number().min(0.3).max(120),
  x: z.number().min(-0.5).max(0.5),
  y: z.number().min(-0.5).max(0.5),
  scale: z.number().min(0.2).max(3),
  rotation: z.number().min(-180).max(180).default(0),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  text: z.string().trim().max(60).optional(),
  animIn: z.enum(ANIM_IN),
  animOut: z.enum(ANIM_OUT),
  keys: z.array(keySchema).max(24).optional(),
});
export type Overlay = z.infer<typeof overlaySchema>;

export const CAPTION_STYLES = ["subtitle", "karaoke", "highlight", "pop"] as const;
export type CaptionStyle = (typeof CAPTION_STYLES)[number];
export const CAPTION_STYLE_LABELS: Record<CaptionStyle, string> = {
  subtitle: "Subtitles on a bar", karaoke: "Karaoke (words light up)", highlight: "Bold highlight (social)", pop: "Word pop",
};

export const voiceoverSchema = z.object({
  assetId: uuid,
  /** The script as written (what captions show). */
  script: z.string().trim().min(1).max(4000),
  /** A voice id, or "recorded" for the person's own recording. */
  voice: z.string().regex(/^([a-z]{2}_[a-z]+|recorded)$/),
  speed: z.number().min(0.7).max(1.3),
  /** Where the narration starts on the timeline. */
  start: z.number().min(0).max(600),
  volume: z.number().min(0).max(2),
  /** Length of the narration audio. */
  duration: z.number().min(0.1).max(600),
  /** Sentences in the audio (seconds from its start), used to dip the music. */
  sentences: z.array(z.object({ start: z.number().min(0), end: z.number().min(0) })).max(200).optional(),
});
export type Voiceover = z.infer<typeof voiceoverSchema>;

export const cueSchema = z.object({
  id,
  /** Seconds on the narration's own clock (the timeline time is voiceover.start + offset + this). */
  start: z.number().min(0).max(600),
  end: z.number().min(0).max(600),
  text: z.string().trim().min(1).max(160),
  /** Per-word times (same clock), when they are known. */
  words: z.array(z.tuple([z.number(), z.number()])).max(40).optional(),
});
export type Cue = z.infer<typeof cueSchema>;

export const captionsSchema = z.object({
  enabled: z.boolean(),
  style: z.enum(CAPTION_STYLES),
  position: z.enum(["top", "center", "bottom"]),
  /** Timing adjustment in seconds (− earlier, + later). */
  offset: z.number().min(-3).max(3),
  size: z.number().min(0.6).max(1.6),
  cues: z.array(cueSchema).max(300),
  /** Where the words came from. */
  source: z.enum(["narration", "transcription", "manual"]).optional(),
});
export type Captions = z.infer<typeof captionsSchema>;

export const sceneSchema = z.object({
  id,
  assetId: uuid,
  move: z.string().refine((m) => m === STILL || !!getMove(m), "Unknown camera move"),
  duration: z.number().min(MIN_SCENE_SECONDS).max(MAX_SCENE_SECONDS),
  /** A Camera Studio move (replaces `move` when set). */
  camera: cameraSpecSchema.optional(),
  /** An AI camera clip made from this scene's photo, played instead of the photo. */
  clipAssetId: uuid.optional(),
  /** Trimmed start of the AI clip (seconds into it). */
  clipIn: z.number().min(0).max(60).optional(),
  /** Transition into this scene (overrides the video's transition) and its length. */
  transition: z.enum(TRANSITIONS).optional(),
  transitionSeconds: z.number().min(0.2).max(1.5).optional(),
  /** Hand placement of a still photo: centre offset (fractions of the frame), zoom and turn. */
  position: z.object({ x: z.number().min(-0.5).max(0.5), y: z.number().min(-0.5).max(0.5), zoom: z.number().min(1).max(4), rotation: z.number().min(-45).max(45) }).optional(),
  /** After a split: the part of the camera move this scene shows (0…1 of the whole move). */
  segment: z.object({ from: z.number().min(0).max(1), to: z.number().min(0).max(1) }).optional(),
});

/** Text can follow a specific photo, or stay on the first / last scene whatever the order. */
export const FIRST_SCENE = "@first";
export const LAST_SCENE = "@last";
const sceneRef = z.union([z.literal(FIRST_SCENE), z.literal(LAST_SCENE), id]);

export const textSchema = z.object({
  id,
  text: z.string().trim().min(1).max(200),
  sceneId: sceneRef,
  style: z.enum(TEXT_STYLES),
  position: z.enum(TEXT_POSITIONS),
  /** Seconds the text stays on screen; null = the whole scene. */
  duration: z.number().min(1).max(30).nullable(),
  /** Seconds after the scene starts (e.g. after a template's intro). */
  offset: z.number().min(0).max(10).optional(),
  /** Free position (fractions of the frame from its centre); overrides `position`. */
  x: z.number().min(-0.5).max(0.5).optional(),
  y: z.number().min(-0.5).max(0.5).optional(),
  /** Keyframes (seconds from the text's start). */
  keys: z.array(keySchema).max(24).optional(),
});

export const planSchema = z.object({
  version: z.literal(1),
  aspect: z.enum(ASPECTS),
  transition: z.enum(TRANSITIONS),
  scenes: z.array(sceneSchema).min(1).max(MAX_SCENES),
  texts: z.array(textSchema).max(MAX_TEXTS),
  music: z.object({
    assetId: uuid.nullable(),
    volume: z.number().min(0).max(1),
    fadeOut: z.boolean(),
    /** Fade lengths in seconds (fadeOut true + no length = 2 s). */
    fadeIn: z.number().min(0).max(10).optional(),
    fadeOutSeconds: z.number().min(0).max(10).optional(),
    /** Trim: skip this many seconds of the track; start / stop it at these timeline times. */
    in: z.number().min(0).max(600).optional(),
    start: z.number().min(0).max(600).optional(),
    end: z.number().min(0).max(600).optional(),
    /** Lower the music while the narration speaks, to this share of its volume. */
    duck: z.number().min(0.05).max(1).optional(),
  }),
  overlays: z.array(overlaySchema).max(20).optional(),
  voiceover: voiceoverSchema.optional(),
  captions: captionsSchema.optional(),
  /** The company's brand kit logo, shown small in a corner for the whole video. */
  logoAssetId: uuid.optional(),
  /** A template's typography, colours, animations and photo look. */
  look: lookSchema.optional(),
  /** Intro / outro animation, agent card and disclosure (from the brand kit and the agent profile). */
  branding: brandingSchema.optional(),
  /** Easy Mode choices this plan was built from; `customized` turns true after Advanced edits. */
  easy: z.object({
    style: z.string().max(40),
    duration: z.number().int().min(5).max(120),
    aspect: z.enum(ASPECTS),
    musicAssetId: uuid.nullable(),
    showBranding: z.boolean(),
    aiEffects: z.boolean(),
    customized: z.boolean(),
    /** Photo order and photos left out, as chosen in Easy Mode. */
    order: z.array(uuid).max(60).optional(),
    skipped: z.array(uuid).max(60).optional(),
  }).optional(),
}).superRefine((p, ctx) => {
  const sceneIds = new Set(p.scenes.map((s) => s.id));
  if (sceneIds.size !== p.scenes.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Scene ids must be unique", path: ["scenes"] });
  const textIds = new Set(p.texts.map((t) => t.id));
  if (textIds.size !== p.texts.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Text ids must be unique", path: ["texts"] });
  p.texts.forEach((t, i) => {
    if (t.sceneId !== FIRST_SCENE && t.sceneId !== LAST_SCENE && !sceneIds.has(t.sceneId)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Text points to a missing scene", path: ["texts", i, "sceneId"] });
  });
});

export type Scene = z.infer<typeof sceneSchema>;
export type TextOverlay = z.infer<typeof textSchema>;
export type EditPlan = z.infer<typeof planSchema>;

export interface PlanPhoto { id: string; storage_path: string; file_name: string; width: number | null; height: number | null; thumbnail_path?: string | null }
export interface PlanMusic { id: string; storage_path: string; file_name: string; duration_seconds: number | null }
/** The brand kit logo (brand-assets). */
export interface PlanLogo { id: string; storage_path: string; width: number | null; height: number | null }
/** An AI camera clip (video) made from one of the listing's photos. */
export interface PlanClip { id: string; storage_path: string; file_name: string; width: number | null; height: number | null; duration_seconds: number | null; source_asset_id: string | null }
export interface PlanBrand { primary_color: string; heading_font: string; body_font: string }

const round = (n: number) => Math.round(n * 1000) / 1000;

/** The scene a text is shown on (resolving "@first" / "@last"). */
export function resolveScene(plan: Pick<EditPlan, "scenes">, ref: string): Scene | undefined {
  if (ref === FIRST_SCENE) return plan.scenes[0];
  if (ref === LAST_SCENE) return plan.scenes[plan.scenes.length - 1];
  return plan.scenes.find((s) => s.id === ref);
}

export function totalDuration(plan: Pick<EditPlan, "scenes">): number {
  return round(plan.scenes.reduce((s, x) => s + x.duration, 0));
}

/** Start time of each scene on the timeline. */
export function sceneStarts(plan: Pick<EditPlan, "scenes">): Map<string, number> {
  const out = new Map<string, number>();
  let t = 0;
  for (const s of plan.scenes) { out.set(s.id, round(t)); t += s.duration; }
  return out;
}

/** Spread `target` seconds evenly across the scenes (within allowed lengths). */
export function fitToDuration<T extends Pick<EditPlan, "scenes">>(plan: T, target = TARGET_SECONDS): T {
  const n = plan.scenes.length;
  if (n === 0) return plan;
  const each = Math.min(MAX_SCENE_SECONDS, Math.max(MIN_SCENE_SECONDS, Math.floor((target / n) * 100) / 100));
  const scenes = plan.scenes.map((s) => ({ ...s, duration: each }));
  // put any rounding remainder on the last scene so the total is exact when possible
  const rest = round(target - each * n);
  const last = scenes[n - 1]!;
  const lastLen = round(last.duration + rest);
  if (rest !== 0 && lastLen >= MIN_SCENE_SECONDS && lastLen <= MAX_SCENE_SECONDS) last.duration = lastLen;
  return { ...plan, scenes };
}

export interface InitialPlanInput {
  photos: { id: string }[];
  coverId: string | null;
  aspect: Aspect;
  address: string;
  cityState: string;
  priceLine: string;
  specsLine: string;
  openHouse: string | null;
  agentLine: string;
  contactLine: string;
  musicAssetId?: string | null;
}

const FREE_MOVES = CAMERA_MOVES.filter((m) => !m.aiOnly).map((m) => m.id);

/** The automatic first timeline: every photo (main photo first), varied camera moves, ~30 seconds, title cards. */
export function initialPlan(input: InitialPlanInput): EditPlan {
  const ordered = input.coverId && input.photos.some((p) => p.id === input.coverId)
    ? [input.photos.find((p) => p.id === input.coverId)!, ...input.photos.filter((p) => p.id !== input.coverId)]
    : input.photos;
  const scenes: Scene[] = ordered.slice(0, MAX_SCENES).map((p, i) => ({
    id: `s${i + 1}`, assetId: p.id, move: FREE_MOVES[i % FREE_MOVES.length]!, duration: 2,
  }));
  const texts: TextOverlay[] = [];
  const at = (i: number) => scenes[Math.min(i, scenes.length - 1)]!.id;
  const title = [input.address, input.cityState].filter(Boolean).join("\n");
  if (title) texts.push({ id: "t_address", text: title, sceneId: FIRST_SCENE, style: "title", position: "bottom", duration: null });
  const details = [input.priceLine, input.specsLine].filter(Boolean).join("\n");
  if (details && scenes.length > 2) texts.push({ id: "t_details", text: details, sceneId: at(2), style: "caption", position: "bottom", duration: null });
  if (input.openHouse && scenes.length > 4) texts.push({ id: "t_open_house", text: `OPEN HOUSE\n${input.openHouse}`, sceneId: at(scenes.length - 3), style: "banner", position: "center", duration: null });
  const outro = [input.agentLine, input.contactLine].filter(Boolean).join("\n");
  if (outro && scenes.length > 1) texts.push({ id: "t_outro", text: outro, sceneId: LAST_SCENE, style: "caption", position: "center", duration: null });
  return fitToDuration({
    version: 1,
    aspect: input.aspect,
    transition: "fade",
    scenes,
    texts,
    music: { assetId: input.musicAssetId ?? null, volume: 0.8, fadeOut: true },
  });
}

/** Safe file name FableCut sees inside its media folder ("/media/<name>"). */
export function mediaFileName(storagePath: string): string {
  const base = storagePath.split("/").pop() ?? "";
  if (!/^[0-9a-f-]{36}\.(jpg|jpeg|png|webp|heic|heif|mp3|m4a|aac|wav|mp4)$/i.test(base)) {
    throw new Error("Unexpected media file name");
  }
  return base;
}

export const mediaIdFor = (assetId: string) => `m_${assetId.replace(/-/g, "").slice(0, 20)}`;

function textProps(t: TextOverlay, canvas: { width: number; height: number }, brand: PlanBrand | null, look?: PlanLook) {
  const short = Math.min(canvas.width, canvas.height);
  const y = t.position === "top" ? -Math.round(canvas.height * 0.32) : t.position === "bottom" ? Math.round(canvas.height * 0.3) : 0;
  const color = look?.accent ?? brand?.primary_color ?? "#1D4ED8";
  const heading = look?.headingFont ?? brand?.heading_font ?? "Montserrat";
  const body = look?.bodyFont ?? brand?.body_font ?? "Inter";
  const ink = look?.text ?? "#ffffff";
  const caps = (s: string) => (look?.uppercase ? s.toUpperCase() : s);
  const boxW = Math.round(canvas.width * 0.86);
  if (t.style === "title") {
    // big titles keep tight spacing so long addresses still fit their box
    return { text: caps(t.text), font: heading, fontSize: Math.round(short * 0.075), bold: true, color: ink, letterSpacing: Math.min(3, look?.letterSpacing ?? 0),
      y, textShadow: 16, textAnim: look?.titleAnim ?? "rise-mask", boxW, boxFit: true, boxH: Math.round(canvas.height * 0.3), vAlign: "middle" };
  }
  if (t.style === "banner") {
    return { text: caps(t.text), font: heading, fontSize: Math.round(short * 0.06), bold: true, color: ink, letterSpacing: look?.letterSpacing ?? 0,
      bgColor: color, bgOpacity: 0.92, y, textAnim: look?.bannerAnim ?? "zoom-in", boxW, boxFit: true, boxH: Math.round(canvas.height * 0.3), vAlign: "middle" };
  }
  return { text: t.text, font: body, fontSize: Math.round(short * 0.045), color: ink,
    bgColor: look?.panel ?? "#000000", bgOpacity: 0.6, y, textAnim: look?.captionAnim ?? "word-slide", boxW, boxFit: true, boxH: Math.round(canvas.height * 0.3), vAlign: "middle" };
}

/**
 * The camera keyframes of one scene (also used by the browser preview, so the
 * preview moves exactly like the export): a Camera Studio move if set,
 * otherwise the scene's simple move, or nothing for "Hold Still".
 */
export interface SceneCamera {
  keyframes: Partial<CameraChannels>;
  props?: Record<string, number | string>;
  /** Show Entire Photo / Smart Fit: what fills the frame around the photo. */
  background?: FrameBackground | null;
}

export function sceneCamera(
  s: Pick<Scene, "move" | "camera"> & Partial<Pick<Scene, "segment" | "position">>, length: number, canvas: { width: number; height: number },
  photo?: { width: number | null; height: number | null } | null,
): SceneCamera | null {
  // after a split, each part shows its share of the whole move (same path, no jump)
  const seg = s.segment && s.segment.to > s.segment.from ? s.segment : null;
  const full = seg ? length / Math.max(0.05, seg.to - seg.from) : length;
  let out: SceneCamera | null = null;
  if (s.camera) {
    const size = photo?.width && photo.height ? { width: photo.width, height: photo.height } : null;
    const r = cameraKeyframes(s.camera, full, canvas, size);
    out = { keyframes: r.keyframes, props: r.props, background: r.background };
  } else if (s.move !== STILL) {
    out = { keyframes: kenBurnsKeyframes(s.move, full, canvas) };
  } else if (s.position) {
    // a still photo placed by hand
    const z = s.position.zoom;
    return { keyframes: {}, props: { x: round(-s.position.x * canvas.width * z), y: round(-s.position.y * canvas.height * z), scale: z, rotation: s.position.rotation } };
  }
  if (!out || !seg) return out;
  const from = seg.from * full, steps = 8;
  const cut: Partial<CameraChannels> = {};
  for (const [name, keys] of Object.entries(out.keyframes) as [keyof CameraChannels, CameraChannels[keyof CameraChannels]][]) {
    if (!keys?.length) continue;
    cut[name] = Array.from({ length: steps + 1 }, (_, k) => ({ t: round((length * k) / steps), v: round(evalChannel(keys, from + ((seg.to - seg.from) * full * k) / steps, 0)), ...(k ? { ease: "linear" as const } : {}) }));
  }
  return { keyframes: cut, props: out.props, background: out.background };
}

/**
 * The layer behind a Show Entire Photo / Smart Fit scene, on track V0 (under the photo), for the
 * scene's whole time and with its transitions, so it never leaves a black gap while the photo
 * moves. Blurred photo: the same photo, cover-fitted, softened and slightly darkened.
 */
export function backgroundClips(
  bg: FrameBackground, scene: { id: string; mediaId: string; start: number; duration: number; transitionIn?: unknown; transitionOut?: unknown; filterPreset?: string },
  canvas: { width: number; height: number },
): Record<string, unknown>[] {
  const base = {
    id: `c_bg_${scene.id}`, track: "V0", start: scene.start, in: 0, duration: scene.duration, name: "Background",
    ...(scene.transitionIn ? { transitionIn: scene.transitionIn } : {}), ...(scene.transitionOut ? { transitionOut: scene.transitionOut } : {}),
  };
  const { width: W, height: H } = canvas;
  if (bg.kind === "color") {
    return [{ ...base, mediaId: null, kind: "shape", props: { shapes: [{ type: "rect", w: W, h: H, fill: bg.color }] } }];
  }
  if (bg.kind === "gradient") {
    const n = BACKGROUND_LOOK.gradientBands, bh = H / n;
    const shapes = Array.from({ length: n }, (_, i) => ({ type: "rect", y: round(-H / 2 + bh * (i + 0.5)), w: W, h: round(bh + 2), fill: mixHex(bg.color, bg.color2, i / (n - 1)) }));
    return [{ ...base, mediaId: null, kind: "shape", props: { shapes } }];
  }
  // blurred photo ("AI extended" uses it too until an extended picture exists)
  return [{
    ...base, mediaId: scene.mediaId, kind: "image",
    props: {
      fit: "cover", scale: BACKGROUND_LOOK.scale, brightness: BACKGROUND_LOOK.brightness,
      blur: Math.round(Math.min(W, H) * BACKGROUND_LOOK.blurOfShortSide),
      ...(scene.filterPreset ? { filterPreset: scene.filterPreset } : {}),
    },
  }];
}

/** Transition into scene i (none for the first) and its length. */
export function sceneTransition(plan: Pick<EditPlan, "scenes" | "transition">, i: number): { type: Transition; seconds: number } {
  if (i <= 0 || i >= plan.scenes.length) return { type: "none", seconds: 0 };
  const s = plan.scenes[i]!;
  const type = s.transition ?? plan.transition;
  return { type, seconds: type === "none" ? 0 : (s.transitionSeconds ?? TRANSITION_SECONDS) };
}

/**
 * Plan → FableCut project.json. Throws if a scene or the music points at an
 * asset that isn't in `photos` / `music` (callers pass only assets the person may use).
 */
export function composeDocument(input: {
  plan: EditPlan;
  title: string;
  photos: PlanPhoto[];
  music: PlanMusic[];
  brand: PlanBrand | null;
  aspect?: Aspect;
  /** AI camera clips the plan may use. */
  clips?: PlanClip[];
  /** The brand logo, when the plan shows it. */
  logo?: PlanLogo | null;
  /** Brand images the plan's branding uses (company logo, brokerage logo, agent headshot). */
  brandImages?: BrandImage[];
}): Record<string, unknown> {
  const plan = input.plan;
  const aspect = input.aspect ?? plan.aspect;
  const canvas = CANVAS_1080[aspect];
  const photoById = new Map(input.photos.map((p) => [p.id, p]));
  const usedPhotos = [...new Set(plan.scenes.map((s) => s.assetId))].map((idv) => {
    const p = photoById.get(idv);
    if (!p) throw new Error(`Scene photo ${idv} is not available`);
    return p;
  });
  const music = plan.music.assetId ? input.music.find((m) => m.id === plan.music.assetId) : null;
  if (plan.music.assetId && !music) throw new Error("The chosen music is not available");
  const voice = plan.voiceover ? input.music.find((m) => m.id === plan.voiceover!.assetId) : null;
  if (plan.voiceover && !voice) throw new Error("The narration audio is not available");
  const clipById = new Map((input.clips ?? []).map((c) => [c.id, c]));
  const usedClips = [...new Set(plan.scenes.flatMap((s) => (s.clipAssetId ? [s.clipAssetId] : [])))].map((idv) => {
    const c = clipById.get(idv);
    if (!c) throw new Error(`AI clip ${idv} is not available`);
    return c;
  });

  const media: Record<string, unknown>[] = usedPhotos.map((p) => ({
    id: mediaIdFor(p.id), assetId: p.id, name: p.file_name, kind: "image", src: `/media/${mediaFileName(p.storage_path)}`,
    ...(p.width && p.height ? { width: p.width, height: p.height } : {}),
  }));
  const logo = plan.logoAssetId ? input.logo : null;
  if (plan.logoAssetId && (!logo || logo.id !== plan.logoAssetId)) throw new Error("The brand logo is not available");
  if (logo) {
    media.push({ id: mediaIdFor(logo.id), assetId: logo.id, name: "Logo", kind: "image", src: `/media/${mediaFileName(logo.storage_path)}`,
      ...(logo.width && logo.height ? { width: logo.width, height: logo.height } : {}) });
  }
  // branding images (intro/outro logo, brokerage logo, headshot)
  const brandImageById = new Map((input.brandImages ?? []).map((b) => [b.id, b]));
  if (logo) brandImageById.set(logo.id, logo);
  const b = plan.branding;
  const brandIds = b ? [...new Set([b.logoAssetId, b.brokerageLogoAssetId, b.agent?.headshotAssetId].filter((x): x is string => !!x))] : [];
  for (const idv of brandIds) {
    const img = brandImageById.get(idv);
    if (!img) throw new Error("A branding image is not available");
    if (!media.some((m) => m.assetId === idv)) {
      media.push({ id: mediaIdFor(img.id), assetId: img.id, name: "Brand image", kind: "image", src: `/media/${mediaFileName(img.storage_path)}`,
        ...(img.width && img.height ? { width: img.width, height: img.height } : {}) });
    }
  }
  for (const c of usedClips) {
    media.push({
      id: mediaIdFor(c.id), assetId: c.id, name: c.file_name, kind: "video", src: `/media/${mediaFileName(c.storage_path)}`,
      ...(c.width && c.height ? { width: c.width, height: c.height } : {}),
      ...(c.duration_seconds ? { duration: Number(c.duration_seconds) } : {}),
    });
  }
  for (const a of [music, voice]) {
    if (!a || media.some((m) => m.assetId === a.id)) continue;
    media.push({
      id: mediaIdFor(a.id), assetId: a.id, name: a.file_name, kind: "audio", src: `/media/${mediaFileName(a.storage_path)}`,
      ...(a.duration_seconds ? { duration: Number(a.duration_seconds) } : {}),
    });
  }

  const total = totalDuration(plan);
  const starts = sceneStarts(plan);
  const backgrounds: Record<string, unknown>[] = [];
  const clips: Record<string, unknown>[] = plan.scenes.map((s, i) => {
    const last = i === plan.scenes.length - 1;
    const into = sceneTransition(plan, i), next = sceneTransition(plan, i + 1);
    const length = round(s.duration + (last ? 0 : next.seconds));
    const aiClip = s.clipAssetId ? clipById.get(s.clipAssetId)! : null;
    let bg: FrameBackground | null = null;
    const clip: Record<string, unknown> = {
      id: `c_${s.id}`,
      mediaId: mediaIdFor(aiClip ? aiClip.id : s.assetId),
      kind: aiClip ? "video" : "image",
      track: "V1",
      start: starts.get(s.id)!,
      in: aiClip ? round(s.clipIn ?? 0) : 0,
      // an AI clip can't play longer than it is
      duration: aiClip?.duration_seconds ? round(Math.max(0.5, Math.min(length, Number(aiClip.duration_seconds) - (s.clipIn ?? 0)))) : length,
      name: `Scene ${i + 1}`,
      cameraMove: aiClip ? `ai:${s.camera?.move ?? s.move}` : s.camera ? `studio:${s.camera.move}` : s.move,
      props: aiClip ? { fit: "cover", volume: 0 } : { fit: "cover", ...(plan.look && plan.look.filter !== "none" ? { filterPreset: plan.look.filter } : {}) },
    };
    if (!aiClip) {
      const photo = photoById.get(s.assetId);
      const cam = sceneCamera(s, length, canvas, photo);
      bg = cam?.background ?? null;
      if (cam) {
        clip.keyframes = cam.keyframes;
        if (cam.props) clip.props = { ...(clip.props as object), ...cam.props };
      }
    }
    if (into.seconds > 0) clip.transitionIn = { type: into.type, duration: into.seconds };
    if (last && plan.transition !== "none") clip.transitionOut = { type: "fade", duration: Math.min(1, s.duration / 2) };
    if (!aiClip && bg) {
      backgrounds.push(...backgroundClips(bg, {
        id: s.id, mediaId: clip.mediaId as string, start: clip.start as number, duration: clip.duration as number,
        transitionIn: clip.transitionIn, transitionOut: clip.transitionOut,
        filterPreset: plan.look && plan.look.filter !== "none" ? plan.look.filter : undefined,
      }, canvas));
    }
    return clip;
  });
  clips.push(...backgrounds);

  plan.texts.forEach((t, i) => {
    const scene = resolveScene(plan, t.sceneId);
    const sceneStart = scene ? starts.get(scene.id) : undefined;
    if (sceneStart == null || !scene) return;
    const start = round(sceneStart + Math.min(t.offset ?? 0, Math.max(0, scene.duration - 1)));
    const duration = round(Math.min(t.duration ?? scene.duration - (start - sceneStart), Math.max(0.5, total - start)));
    const props: Record<string, unknown> = textProps(t, canvas, input.brand, plan.look);
    if (t.x != null) props.x = round(t.x * canvas.width);
    if (t.y != null) props.y = round(t.y * canvas.height);
    const kf = t.keys?.length ? itemKeyframes({ keys: t.keys, base: { x: t.x ?? 0, y: t.y ?? 0, scale: 1, rotation: 0, opacity: 1 }, canvas, duration }) : undefined;
    clips.push({
      id: `c_text_${t.id}`, mediaId: null, kind: "text", track: i % 2 === 0 ? "V2" : "V3",
      start, in: 0, duration, name: t.text.split("\n")[0]!.slice(0, 40),
      props,
      ...(kf ? { keyframes: kf } : {}),
      transitionOut: { type: "fade", duration: Math.min(0.4, duration / 3) },
    });
  });

  if (logo) {
    // small, top-right, for the whole video (contain-fit, then scaled to ~18% of the short side)
    const lw = logo.width || 1, lh = logo.height || 1;
    const f = Math.min(canvas.width / lw, canvas.height / lh);
    const target = Math.min(canvas.width, canvas.height) * 0.18;
    const scale = round(Math.min(target / (lw * f), (target * 0.6) / (lh * f)));
    const w = lw * f * scale, h = lh * f * scale, pad = Math.round(Math.min(canvas.width, canvas.height) * 0.04);
    clips.push({
      id: "c_logo", mediaId: mediaIdFor(logo.id), kind: "image", track: "V4", start: 0, in: 0, duration: total, name: "Logo",
      props: { fit: "contain", scale, opacity: 0.92, x: round(canvas.width / 2 - pad - w / 2), y: round(-canvas.height / 2 + pad + h / 2) },
    });
  }
  if (plan.look?.letterbox) {
    const barH = Math.round(canvas.height * (canvas.width > canvas.height ? 0.1 : 0.07));
    for (const [idv, y] of [["c_bars_top", -canvas.height / 2 + barH / 2], ["c_bars_bottom", canvas.height / 2 - barH / 2]] as const) {
      clips.push({ id: idv, mediaId: null, kind: "shape", track: "V5", start: 0, in: 0, duration: total, name: "Cinema bar",
        props: { y: round(y), shapes: [{ type: "rect", w: canvas.width, h: barH, fill: "#000000" }] } });
    }
  }
  clips.push(...brandLayerClips({ plan, canvas, images: brandImageById, brandColor: input.brand?.primary_color ?? "#1D4ED8" }));

  for (const [i, o] of (plan.overlays ?? []).entries()) {
    if (o.start >= total) continue;
    clips.push(...overlayClips({ ...o, duration: round(Math.min(o.duration, total - o.start)) }, canvas, plan.look ?? null, i));
  }
  clips.push(...captionClips(plan, canvas, plan.look ?? { bodyFont: (input.brand?.body_font ?? "Inter") as PlanLook["bodyFont"], headingFont: (input.brand?.heading_font ?? "Montserrat") as PlanLook["headingFont"], accent: input.brand?.primary_color ?? "#FFD166" }, total));
  if (voice) { const c = voiceClip(plan, voice, total); if (c) clips.push(c); }
  if (music) { const c = musicClip(plan, music, total); if (c) clips.push(c); }

  return {
    name: input.title,
    width: canvas.width,
    height: canvas.height,
    fps: 30,
    background: "#000000",
    revision: 1,
    panSchema: 1,
    markers: [],
    tracks: [
      ...(plan.captions?.enabled && plan.captions.cues.length ? [{ id: "V10", kind: "video" }] : []),
      ...(plan.branding || plan.look?.letterbox || plan.captions?.enabled ? ["V9", "V8", "V7", "V6", "V5"].map((idv) => ({ id: idv, kind: "video" })) : []),
      { id: "V4", kind: "video" }, { id: "V3", kind: "video" }, { id: "V2", kind: "video" }, { id: "V1", kind: "video" },
      ...(backgrounds.length ? [{ id: "V0", kind: "video" }] : []),
      { id: "A1", kind: "audio" }, { id: "A2", kind: "audio" },
    ],
    media,
    clips,
    meta: { generator: "lvs-plan@1", aspect, duration: total },
  };
}
