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

const mediaIdFor = (assetId: string) => `m_${assetId.replace(/-/g, "").slice(0, 20)}`;

function textProps(t: TextOverlay, canvas: { width: number; height: number }, brand: PlanBrand | null) {
  const short = Math.min(canvas.width, canvas.height);
  const y = t.position === "top" ? -Math.round(canvas.height * 0.32) : t.position === "bottom" ? Math.round(canvas.height * 0.3) : 0;
  const color = brand?.primary_color ?? "#1D4ED8";
  const boxW = Math.round(canvas.width * 0.86);
  if (t.style === "title") {
    return { text: t.text, font: brand?.heading_font ?? "Montserrat", fontSize: Math.round(short * 0.075), bold: true, color: "#ffffff",
      y, textShadow: 16, textAnim: "rise-mask", boxW, boxFit: true, boxH: Math.round(canvas.height * 0.3), vAlign: "middle" };
  }
  if (t.style === "banner") {
    return { text: t.text, font: brand?.heading_font ?? "Montserrat", fontSize: Math.round(short * 0.06), bold: true, color: "#ffffff",
      bgColor: color, bgOpacity: 0.92, y, textAnim: "zoom-in", boxW, boxFit: true, boxH: Math.round(canvas.height * 0.3), vAlign: "middle" };
  }
  return { text: t.text, font: brand?.body_font ?? "Inter", fontSize: Math.round(short * 0.045), color: "#ffffff",
    bgColor: "#000000", bgOpacity: 0.6, y, textAnim: "word-slide", boxW, boxFit: true, boxH: Math.round(canvas.height * 0.3), vAlign: "middle" };
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
      props: aiClip ? { fit: "cover", volume: 0 } : { fit: "cover" },
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
    const start = scene ? starts.get(scene.id) : undefined;
    if (start == null || !scene) return;
    const duration = round(Math.min(t.duration ?? scene.duration, Math.max(0.5, total - start)));
    clips.push({
      id: `c_text_${t.id}`, mediaId: null, kind: "text", track: i % 2 === 0 ? "V2" : "V3",
      start, in: 0, duration, name: t.text.split("\n")[0]!.slice(0, 40),
      props: textProps(t, canvas, input.brand),
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
      { id: "V4", kind: "video" }, { id: "V3", kind: "video" }, { id: "V2", kind: "video" }, { id: "V1", kind: "video" },
      { id: "A1", kind: "audio" }, { id: "A2", kind: "audio" },
    ],
    media,
    clips,
    meta: { generator: "lvs-plan@1", aspect, duration: total },
  };
}
