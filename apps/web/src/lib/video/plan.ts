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
import { CAMERA_MOVES, cameraKeyframes, getMove, kenBurnsKeyframes, type CameraChannels } from "@lvs/camera-presets";
import { cameraSpecSchema } from "./camera";
import { brandLayerClips, type BrandImage } from "./brand-layers";

export const ASPECTS = ["16:9", "9:16", "1:1"] as const;
export type Aspect = (typeof ASPECTS)[number];

export const ASPECT_LABELS: Record<Aspect, string> = {
  "16:9": "Horizontal 16:9",
  "9:16": "Vertical 9:16",
  "1:1": "Square 1:1",
};

/** 1080p canvas for each format. */
export const CANVAS_1080: Record<Aspect, { width: number; height: number }> = {
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
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

export const sceneSchema = z.object({
  id,
  assetId: uuid,
  move: z.string().refine((m) => m === STILL || !!getMove(m), "Unknown camera move"),
  duration: z.number().min(MIN_SCENE_SECONDS).max(MAX_SCENE_SECONDS),
  /** A Camera Studio move (replaces `move` when set). */
  camera: cameraSpecSchema.optional(),
  /** An AI camera clip made from this scene's photo, played instead of the photo. */
  clipAssetId: uuid.optional(),
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
  }),
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
export function sceneCamera(
  s: Pick<Scene, "move" | "camera">, length: number, canvas: { width: number; height: number },
  photo?: { width: number | null; height: number | null } | null,
): { keyframes: Partial<CameraChannels>; props?: Record<string, number> } | null {
  if (s.camera) {
    const size = photo?.width && photo.height ? { width: photo.width, height: photo.height } : null;
    const r = cameraKeyframes(s.camera, length, canvas, size);
    return { keyframes: r.keyframes, props: r.props };
  }
  if (s.move === STILL) return null;
  return { keyframes: kenBurnsKeyframes(s.move, length, canvas) };
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
  if (music) {
    media.push({
      id: mediaIdFor(music.id), assetId: music.id, name: music.file_name, kind: "audio", src: `/media/${mediaFileName(music.storage_path)}`,
      ...(music.duration_seconds ? { duration: Number(music.duration_seconds) } : {}),
    });
  }

  const total = totalDuration(plan);
  const starts = sceneStarts(plan);
  const T = plan.transition === "none" ? 0 : TRANSITION_SECONDS;
  const clips: Record<string, unknown>[] = plan.scenes.map((s, i) => {
    const last = i === plan.scenes.length - 1;
    const length = round(s.duration + (last ? 0 : T));
    const aiClip = s.clipAssetId ? clipById.get(s.clipAssetId)! : null;
    const clip: Record<string, unknown> = {
      id: `c_${s.id}`,
      mediaId: mediaIdFor(aiClip ? aiClip.id : s.assetId),
      kind: aiClip ? "video" : "image",
      track: "V1",
      start: starts.get(s.id)!,
      in: 0,
      // an AI clip can't play longer than it is
      duration: aiClip?.duration_seconds ? round(Math.min(length, Number(aiClip.duration_seconds))) : length,
      name: `Scene ${i + 1}`,
      cameraMove: aiClip ? `ai:${s.camera?.move ?? s.move}` : s.camera ? `studio:${s.camera.move}` : s.move,
      props: aiClip ? { fit: "cover", volume: 0 } : { fit: "cover", ...(plan.look && plan.look.filter !== "none" ? { filterPreset: plan.look.filter } : {}) },
    };
    if (!aiClip) {
      const photo = photoById.get(s.assetId);
      const cam = sceneCamera(s, length, canvas, photo);
      if (cam) {
        clip.keyframes = cam.keyframes;
        if (cam.props) clip.props = { ...(clip.props as object), ...cam.props };
      }
    }
    if (i > 0 && T > 0) clip.transitionIn = { type: plan.transition, duration: T };
    if (last && T > 0) clip.transitionOut = { type: "fade", duration: Math.min(1, s.duration / 2) };
    return clip;
  });

  plan.texts.forEach((t, i) => {
    const scene = resolveScene(plan, t.sceneId);
    const sceneStart = scene ? starts.get(scene.id) : undefined;
    if (sceneStart == null || !scene) return;
    const start = round(sceneStart + Math.min(t.offset ?? 0, Math.max(0, scene.duration - 1)));
    const duration = round(Math.min(t.duration ?? scene.duration - (start - sceneStart), Math.max(0.5, total - start)));
    clips.push({
      id: `c_text_${t.id}`, mediaId: null, kind: "text", track: i % 2 === 0 ? "V2" : "V3",
      start, in: 0, duration, name: t.text.split("\n")[0]!.slice(0, 40),
      props: textProps(t, canvas, input.brand, plan.look),
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

  if (music) {
    const len = round(Math.min(total, music.duration_seconds ? Number(music.duration_seconds) : total));
    const clip: Record<string, unknown> = {
      id: "c_music", mediaId: mediaIdFor(music.id), kind: "audio", track: "A1", start: 0, in: 0, duration: len,
      name: "Music", props: { volume: plan.music.volume },
    };
    if (plan.music.fadeOut && len > 3) {
      clip.keyframes = { volume: [{ t: 0, v: plan.music.volume }, { t: round(len - 2), v: plan.music.volume }, { t: len, v: 0, ease: "linear" }] };
    }
    clips.push(clip);
  }

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
      ...(plan.branding || plan.look?.letterbox ? ["V9", "V8", "V7", "V6", "V5"].map((idv) => ({ id: idv, kind: "video" })) : []),
      { id: "V4", kind: "video" }, { id: "V3", kind: "video" }, { id: "V2", kind: "video" }, { id: "V1", kind: "video" },
      { id: "A1", kind: "audio" }, { id: "A2", kind: "audio" },
    ],
    media,
    clips,
    meta: { generator: "lvs-plan@1", aspect, duration: total },
  };
}
