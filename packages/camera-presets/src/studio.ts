/*
 * Cinematic Camera Control Studio — the camera engine.
 *
 * One description of a camera move (CameraSpec) drives three things:
 *   1. FableCut keyframes (x, y, scale, rotation + motion blur) for the
 *      STANDARD method — deterministic 2D photo transforms, rendered by FableCut.
 *   2. The live browser preview, which evaluates exactly those keyframes with
 *      FableCut's own interpolation (see evalChannel), so preview = export.
 *   3. Camera poses for the AI DEPTH method (packages/ai-motion), which moves a
 *      virtual camera through a depth map estimated by a neural network.
 *
 * Honesty rules (Stage 7):
 *   - Every move says which method can do it for real. A 2D transform can
 *     zoom, pan and slide a photo; it cannot show the side of a building, so
 *     orbit / arc / parallax / drone moves are labelled "needs AI" and their
 *     standard version is called a 2D stand-in, never a 3D move.
 *   - Lens styles are simulated framing and motion feel. They are never written
 *     as capture metadata of the photo.
 */

export type Easing = "linear" | "ease-in" | "ease-out" | "ease-in-out";
export const EASINGS: readonly Easing[] = ["linear", "ease-in", "ease-out", "ease-in-out"];
export const EASING_LABELS: Record<Easing, string> = {
  linear: "Steady", "ease-in": "Slow start", "ease-out": "Slow finish", "ease-in-out": "Smooth start and finish",
};

/** FableCut's easing curves (motion.js / app.js — identical formulas). */
export const EASE_FN: Record<Easing, (u: number) => number> = {
  linear: (u) => u,
  "ease-in": (u) => u * u,
  "ease-out": (u) => 1 - (1 - u) * (1 - u),
  "ease-in-out": (u) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2),
};

/* ── Moves ─────────────────────────────────────────────────────────────── */

export const STUDIO_MOVE_IDS = [
  "push_in", "pull_out", "dolly_in", "dolly_out", "truck_left", "truck_right", "pan_left", "pan_right",
  "tilt_up", "tilt_down", "crane_up", "crane_down", "orbit_left", "orbit_right", "arc_left", "arc_right",
  "zoom", "parallax", "drone_reveal",
] as const;
export type StudioMoveId = (typeof STUDIO_MOVE_IDS)[number];

/**
 * How each method handles a move:
 *  - standard "exact": a 2D photo transform IS this move (zoom, push).
 *  - standard "close": a 2D transform is a good match for small moves (pan, tilt).
 *  - standard "stand-in": only a flat imitation; the real move needs depth/AI.
 *  - ai "depth": a real parallax version is made from the photo's depth map (our server).
 *  - ai "generative": needs an image-to-video AI model (external provider) for a convincing result.
 */
export type StandardQuality = "exact" | "close" | "stand-in";
export type AiMethod = "depth" | "generative";

export interface StudioMove {
  id: StudioMoveId;
  name: string;
  description: string;
  group: "Forward and back" | "Sideways" | "Turn" | "Up and down" | "Around" | "Lens" | "Aerial";
  standard: StandardQuality;
  /** AI methods that can make the true version, best first. */
  ai: AiMethod[];
  /** True when only an AI method gives the real move (the standard version is a 2D stand-in). */
  requiresAI: boolean;
  /** Has a lateral travel direction (Direction angle applies). */
  lateral: boolean;
  /** Moves toward / away from a point (Target applies). */
  targeted: boolean;
}

export const STUDIO_MOVES: readonly StudioMove[] = [
  { id: "push_in", name: "Push In", group: "Forward and back", standard: "exact", ai: ["depth"], requiresAI: false, lateral: false, targeted: true,
    description: "Moves steadily toward a point in the photo." },
  { id: "pull_out", name: "Pull Out", group: "Forward and back", standard: "exact", ai: ["depth"], requiresAI: false, lateral: false, targeted: true,
    description: "Starts close and backs away to show more." },
  { id: "dolly_in", name: "Dolly In", group: "Forward and back", standard: "stand-in", ai: ["depth", "generative"], requiresAI: false, lateral: false, targeted: true,
    description: "Camera travels forward; near things grow faster than far things. Standard method scales the photo only." },
  { id: "dolly_out", name: "Dolly Out", group: "Forward and back", standard: "stand-in", ai: ["depth", "generative"], requiresAI: false, lateral: false, targeted: true,
    description: "Camera travels backward with real perspective change (AI depth). Standard method scales the photo only." },
  { id: "truck_left", name: "Truck Left", group: "Sideways", standard: "stand-in", ai: ["depth"], requiresAI: false, lateral: true, targeted: false,
    description: "Camera slides left. Real parallax needs AI depth; standard slides the whole photo." },
  { id: "truck_right", name: "Truck Right", group: "Sideways", standard: "stand-in", ai: ["depth"], requiresAI: false, lateral: true, targeted: false,
    description: "Camera slides right. Real parallax needs AI depth; standard slides the whole photo." },
  { id: "pan_left", name: "Pan Left", group: "Turn", standard: "close", ai: ["depth"], requiresAI: false, lateral: true, targeted: false,
    description: "Camera turns to the left, like turning your head." },
  { id: "pan_right", name: "Pan Right", group: "Turn", standard: "close", ai: ["depth"], requiresAI: false, lateral: true, targeted: false,
    description: "Camera turns to the right, like turning your head." },
  { id: "tilt_up", name: "Tilt Up", group: "Turn", standard: "close", ai: ["depth"], requiresAI: false, lateral: true, targeted: false,
    description: "Camera tips upward, e.g. from the floor to the ceiling." },
  { id: "tilt_down", name: "Tilt Down", group: "Turn", standard: "close", ai: ["depth"], requiresAI: false, lateral: true, targeted: false,
    description: "Camera tips downward." },
  { id: "crane_up", name: "Crane Up", group: "Up and down", standard: "stand-in", ai: ["depth", "generative"], requiresAI: false, lateral: false, targeted: false,
    description: "Camera rises. Real height change needs AI; standard moves the frame up." },
  { id: "crane_down", name: "Crane Down", group: "Up and down", standard: "stand-in", ai: ["depth", "generative"], requiresAI: false, lateral: false, targeted: false,
    description: "Camera lowers. Real height change needs AI; standard moves the frame down." },
  { id: "orbit_left", name: "Orbit Left", group: "Around", standard: "stand-in", ai: ["depth", "generative"], requiresAI: true, lateral: false, targeted: true,
    description: "Circles left around a point. Needs AI: a flat photo can't show new sides." },
  { id: "orbit_right", name: "Orbit Right", group: "Around", standard: "stand-in", ai: ["depth", "generative"], requiresAI: true, lateral: false, targeted: true,
    description: "Circles right around a point. Needs AI: a flat photo can't show new sides." },
  { id: "arc_left", name: "Arc Left", group: "Around", standard: "stand-in", ai: ["depth", "generative"], requiresAI: true, lateral: false, targeted: true,
    description: "A short curved move to the left while moving in. Needs AI." },
  { id: "arc_right", name: "Arc Right", group: "Around", standard: "stand-in", ai: ["depth", "generative"], requiresAI: true, lateral: false, targeted: true,
    description: "A short curved move to the right while moving in. Needs AI." },
  { id: "zoom", name: "Zoom", group: "Lens", standard: "exact", ai: [], requiresAI: false, lateral: false, targeted: true,
    description: "Lens zoom: magnifies without moving the camera. A 2D zoom is the real thing." },
  { id: "parallax", name: "Parallax", group: "Sideways", standard: "stand-in", ai: ["depth"], requiresAI: true, lateral: true, targeted: false,
    description: "Near and far things move at different speeds, giving depth. Needs AI depth." },
  { id: "drone_reveal", name: "Simulated Drone Reveal", group: "Aerial", standard: "stand-in", ai: ["generative", "depth"], requiresAI: true, lateral: false, targeted: false,
    description: "Rises and pulls back like a drone. Simulated — no aerial footage is created without generative AI." },
];

export function getStudioMove(id: string): StudioMove | undefined {
  return STUDIO_MOVES.find((m) => m.id === id);
}

export const STANDARD_QUALITY_LABELS: Record<StandardQuality, string> = {
  exact: "Standard — exact",
  close: "Standard — close match",
  "stand-in": "Standard — 2D stand-in only",
};
export const AI_METHOD_LABELS: Record<AiMethod, string> = {
  depth: "AI depth (on our server)",
  generative: "Generative AI video",
};

/* ── Easy camera mode ──────────────────────────────────────────────────── */

export const EASY_CAMERA_IDS = ["closer", "back", "left", "right", "look_around", "reveal"] as const;
export type EasyCameraId = (typeof EASY_CAMERA_IDS)[number];
export const INTENSITIES = ["gentle", "normal", "dramatic"] as const;
export type Intensity = (typeof INTENSITIES)[number];
export const INTENSITY_STRENGTH: Record<Intensity, number> = { gentle: 0.3, normal: 0.55, dramatic: 0.9 };
export const EASY_DURATIONS = [3, 5, 8] as const;

export interface EasyCamera { id: EasyCameraId; name: string; description: string; move: StudioMoveId; easing: Easing; aiNote?: string }

export const EASY_CAMERAS: readonly EasyCamera[] = [
  { id: "closer", name: "Move Closer", description: "Glides toward the home.", move: "push_in", easing: "ease-in-out" },
  { id: "back", name: "Move Back", description: "Backs away to show it all.", move: "pull_out", easing: "ease-in-out" },
  { id: "left", name: "Move Left", description: "Slides gently to the left.", move: "truck_left", easing: "ease-in-out" },
  { id: "right", name: "Move Right", description: "Slides gently to the right.", move: "truck_right", easing: "ease-in-out" },
  { id: "look_around", name: "Look Around", description: "Turns slowly across the scene.", move: "pan_right", easing: "ease-in-out" },
  { id: "reveal", name: "Reveal Property", description: "Starts close, then rises back to reveal the home.", move: "drone_reveal", easing: "ease-out",
    aiNote: "Without AI this is a 2D reveal (zoom out and rise), not real aerial footage." },
];

/* ── Lens-inspired styles ──────────────────────────────────────────────── */

export const LENS_STYLES = [14, 24, 35, 50, 85] as const;
export type LensStyle = (typeof LENS_STYLES)[number];
/**
 * Simulated lens feel: how tight the framing starts and how big moves feel.
 * Not capture metadata — the photo's real lens is unknown and unchanged.
 */
export const LENS_FEEL: Record<LensStyle, { label: string; zoom: number; motion: number; fovDeg: number }> = {
  14: { label: "14mm-style ultra wide", zoom: 1.0, motion: 1.25, fovDeg: 104 },
  24: { label: "24mm-style wide", zoom: 1.04, motion: 1.1, fovDeg: 74 },
  35: { label: "35mm-style natural", zoom: 1.1, motion: 1.0, fovDeg: 54 },
  50: { label: "50mm-style standard", zoom: 1.22, motion: 0.85, fovDeg: 40 },
  85: { label: "85mm-style close-up", zoom: 1.45, motion: 0.7, fovDeg: 24 },
};
export const LENS_DISCLAIMER = "Lens styles are simulated framing and motion. They don't change or claim the photo's real lens.";

/* ── The spec ──────────────────────────────────────────────────────────── */

/** What you see: the view centre in the photo (fractions of width/height from the centre), zoom ≥ 1 and roll in degrees. */
export interface CameraView { x: number; y: number; zoom: number; rotation: number }
/** A custom keyframe: `t` is 0…1 of the clip. */
export interface CameraKey extends CameraView { t: number; ease?: Easing }

export interface CameraSpec {
  move: StudioMoveId;
  /** Motion strength 0…1. */
  strength: number;
  /** 0.5…2. Below 1 the camera covers less ground; above 1 it arrives sooner and holds. */
  speed: number;
  /** Degrees; turns the travel direction of sideways / turn moves (0 = as named). */
  direction: number;
  /** Swap start and end. */
  reverse: boolean;
  /** Movement distance, fraction of the frame (0.02…0.4). */
  distance: number;
  /** Extra starting zoom (1…2). */
  zoom: number;
  /** Roll over the move, degrees (−15…15). */
  rotation: number;
  /** Depth intensity 0…1 — used by the AI depth method (how strong parallax is). */
  depth: number;
  easing: Easing;
  /** Motion blur as a shutter angle in degrees (0 = off, 180 = film look). */
  motionBlur: number;
  /** Point to move toward / around (fractions from the centre). */
  target: { x: number; y: number };
  lens: LensStyle | null;
  /** Optional exact start and end framing (overrides the move's path). */
  startFrame: CameraView | null;
  endFrame: CameraView | null;
  /** Optional custom keyframes (override everything above except easing defaults, blur and lens zoom). */
  keyframes: CameraKey[] | null;
  /** Optional hand-set movement (the "Move camera" sliders / frame). Overrides the move's path. */
  manual?: ManualMove | null;
  /** Where a hand-set movement starts (the sliders then say how far it travels from here). */
  manualStart?: ManualStart | null;
  /**
   * How the photo sits in the video frame. Missing = "cover" (how every spec saved before
   * framing modes existed renders, so old videos don't change).
   */
  fit?: PhotoFit;
  /** What fills the frame around the photo in "contain" and "smart" framing. */
  background?: FrameBackground | null;
  /** Smart Fit: the part of the photo to keep in view (fractions of the photo, 0…1). */
  safeArea?: SafeArea | null;
}

/* ── Photo framing ─────────────────────────────────────────────────────── */

/**
 *  - contain ("Show Entire Photo"): the whole photo is inside the frame at every moment; any
 *    space around it shows the background. Its size at rest (the photo just touching two
 *    edges) is 1.0×. Movement never crops it: if a move would push it past an edge, the whole
 *    move is scaled down (smaller photo, shorter travel) until it fits.
 *  - cover ("Fill Screen"): the photo fills the frame and the overflow is cut off; movement is
 *    zoomed in just enough that no edge ever shows (the edge guard).
 *  - smart ("Smart Fit"): frames the safe area (the home) as large as it fits, never larger
 *    than Fill Screen; the rest of the photo may be cut, the safe area never is.
 */
export const PHOTO_FITS = ["contain", "cover", "smart"] as const;
export type PhotoFit = (typeof PHOTO_FITS)[number];
export const PHOTO_FIT_LABELS: Record<PhotoFit, { label: string; hint: string }> = {
  contain: { label: "Show Entire Photo", hint: "The whole photo stays in view. Space around it is filled with the background." },
  cover: { label: "Fill Screen", hint: "The photo fills the frame edge to edge. Parts of it are cut off." },
  smart: { label: "Smart Fit", hint: "Finds the most detailed part of the photo (usually the home) and keeps all of it in view." },
};
export const BACKGROUND_KINDS = ["blur", "color", "gradient", "ai"] as const;
export type BackgroundKind = (typeof BACKGROUND_KINDS)[number];
export const BACKGROUND_LABELS: Record<BackgroundKind, string> = {
  blur: "Blurred photo", color: "Solid color", gradient: "Gradient", ai: "AI extended",
};
export interface FrameBackground { kind: BackgroundKind; color: string; color2: string }
export const DEFAULT_BACKGROUND: FrameBackground = { kind: "blur", color: "#111827", color2: "#4B5563" };
export interface SafeArea { x0: number; y0: number; x1: number; y1: number }
/** Used by Smart Fit until the photo has been analysed. */
export const DEFAULT_SAFE_AREA: SafeArea = { x0: 0.08, y0: 0.04, x1: 0.92, y1: 0.98 };
/** Start of a hand-set movement: view centre (fractions of the frame) and zoom (1 = the framing's rest size). */
export interface ManualStart { x: number; y: number; zoom: number }

/** How the backgrounds look — shared by the export (FableCut) and every browser preview. */
export const BACKGROUND_LOOK = {
  /** Blur radius as a share of the frame's short side (≈38 px at 1080p). */
  blurOfShortSide: 0.035,
  /** The blurred copy is drawn a little larger so its softened edges stay outside the frame. */
  scale: 1.12,
  brightness: 82,
  /** Gradient: top colour → bottom colour in this many bands (FableCut allows 64 shapes per layer). */
  gradientBands: 64,
} as const;

/** a → b at t (0…1), "#rrggbb". */
export function mixHex(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const A = p(a), B = p(b);
  return "#" + A.map((v, i) => Math.round(v + (B[i]! - v) * clamp(t, 0, 1)).toString(16).padStart(2, "0")).join("");
}

export function specFit(spec: Pick<CameraSpec, "fit">): PhotoFit {
  return spec.fit && (PHOTO_FITS as readonly string[]).includes(spec.fit) ? spec.fit : "cover";
}
/** The background actually drawn (none for Fill Screen; AI extended draws the blurred photo until generated). */
export function specBackground(spec: Pick<CameraSpec, "fit" | "background">): FrameBackground | null {
  if (specFit(spec) === "cover") return null;
  return spec.background ?? DEFAULT_BACKGROUND;
}

/* ── Hand-set movement ("Move camera") ─────────────────────────────────── */

/**
 * Six sliders, each −10…10 (0 = no change), describing how the camera travels from the start to the end
 * of the clip. Positive values: right, up, closer, turn right, look up, roll clockwise.
 *   Standard method: horizontal/vertical slide the frame, zoom scales it, rotate rolls it.
 *     Pan and tilt are approximated by a slide (a flat photo can't really turn) — labelled as such.
 *   AI depth method: real camera travel (tx, ty, tz) and real turns (yaw, pitch, roll).
 */
export interface ManualMove { horizontal: number; vertical: number; zoom: number; pan: number; tilt: number; rotate: number }
export const MANUAL_AXES = ["horizontal", "vertical", "zoom", "pan", "tilt", "rotate"] as const;
export type ManualAxis = (typeof MANUAL_AXES)[number];
export const MANUAL_LABELS: Record<ManualAxis, { label: string; hint: string }> = {
  horizontal: { label: "Horizontal", hint: "Slide the camera left (−) or right (+)" },
  vertical: { label: "Vertical", hint: "Lower (−) or raise (+) the camera" },
  zoom: { label: "Zoom", hint: "Pull back (−) or move closer (+)" },
  pan: { label: "Pan", hint: "Turn left (−) or right (+)" },
  tilt: { label: "Tilt", hint: "Look down (−) or up (+)" },
  rotate: { label: "Rotate", hint: "Roll counter-clockwise (−) or clockwise (+)" },
};
export const ZERO_MANUAL: ManualMove = { horizontal: 0, vertical: 0, zoom: 0, pan: 0, tilt: 0, rotate: 0 };
/** Per slider unit, in view terms (fraction of the frame / zoom factor / degrees). */
export const MANUAL_SCALE = { slide: 0.025, turnSlide: 0.02, zoom: 0.06, rollDeg: 1.5, depthTravel: 0.012, depthTurnDeg: 1.5 } as const;

export function isManualZero(m: ManualMove | null | undefined): boolean {
  return !m || MANUAL_AXES.every((a) => m[a] === 0);
}

/** Start and end views of a hand-set movement (before the lens zoom and edge guard). The sliders travel from `start`. */
export function manualViews(m: ManualMove, baseZoom = 1, start?: ManualStart | null): [CameraView, CameraView] {
  const k = MANUAL_SCALE;
  const st = start ?? { x: 0, y: 0, zoom: 1 };
  const zIn = 1 + Math.abs(m.zoom) * k.zoom;
  const from: CameraView = { x: st.x, y: st.y, zoom: baseZoom * st.zoom * (m.zoom < 0 ? zIn : 1), rotation: 0 };
  const end: CameraView = {
    x: clamp(st.x + m.horizontal * k.slide + m.pan * k.turnSlide, -0.5, 0.5),
    // + is up, which is towards the top of the photo (negative y)
    y: clamp(st.y - (m.vertical * k.slide + m.tilt * k.turnSlide), -0.5, 0.5),
    zoom: baseZoom * st.zoom * (m.zoom > 0 ? zIn : 1),
    rotation: m.rotate * k.rollDeg,
  };
  return [from, end];
}

/** True when the spec is a hand-set movement (sliders moved, or a start frame placed). */
export function hasManual(spec: Pick<CameraSpec, "manual" | "manualStart">): boolean {
  return !isManualZero(spec.manual) || !!spec.manualStart;
}

/** The start and end frames of the hand-set movement, as the "Move camera" frame editor shows them. */
export function manualFrames(spec: Pick<CameraSpec, "manual" | "manualStart">): { start: CameraView; end: CameraView } {
  const [start, end] = manualViews(spec.manual ?? ZERO_MANUAL, 1, spec.manualStart);
  return { start, end };
}

/**
 * Places one frame of the hand-set movement and keeps the other where it is: the start frame
 * becomes `manualStart`, the travel between them becomes the sliders (pan, tilt and roll stay).
 */
export function withManualFrame(spec: CameraSpec, which: "start" | "end", v: { x: number; y: number; zoom: number }): CameraSpec {
  const k = MANUAL_SCALE;
  const cur = manualFrames(spec);
  const want = { x: clamp(v.x, -0.5, 0.5), y: clamp(v.y, -0.5, 0.5), zoom: clamp(v.zoom, 0.5, 3) };
  const s = which === "start" ? want : { x: cur.start.x, y: cur.start.y, zoom: cur.start.zoom };
  const e = which === "end" ? want : { x: cur.end.x, y: cur.end.y, zoom: cur.end.zoom };
  const m = { ...(spec.manual ?? ZERO_MANUAL) };
  const r1 = (n: number) => Math.round(clamp(n, -10, 10) * 10) / 10;
  m.horizontal = r1((e.x - s.x - m.pan * k.turnSlide) / k.slide);
  m.vertical = r1((-(e.y - s.y) - m.tilt * k.turnSlide) / k.slide);
  const lo = Math.min(s.zoom, e.zoom);
  m.zoom = r1(e.zoom >= s.zoom ? (e.zoom / s.zoom - 1) / k.zoom : -(s.zoom / e.zoom - 1) / k.zoom);
  const start: ManualStart = { x: Math.round(s.x * 10000) / 10000, y: Math.round(s.y * 10000) / 10000, zoom: Math.round(clamp(lo, 0.5, 3) * 1000) / 1000 };
  const isRest = start.x === 0 && start.y === 0 && start.zoom === 1;
  return { ...spec, manual: m, manualStart: isRest ? null : start, startFrame: null, endFrame: null, keyframes: null };
}

/* ── "Move camera" presets ─────────────────────────────────────────────── */

export interface MovePreset { id: string; name: string; description: string; manual: Partial<ManualMove>; start?: ManualStart }
export const MOVE_PRESETS: readonly MovePreset[] = [
  { id: "gentle_zoom", name: "Gentle Zoom", description: "Slowly moves a little closer.", manual: { zoom: 2 } },
  { id: "move_left", name: "Move Left", description: "Glides to the left.", manual: { horizontal: -4 } },
  { id: "move_right", name: "Move Right", description: "Glides to the right.", manual: { horizontal: 4 } },
  { id: "move_up", name: "Move Up", description: "Rises slowly.", manual: { vertical: 4 } },
  { id: "move_down", name: "Move Down", description: "Lowers slowly.", manual: { vertical: -4 } },
  { id: "cinematic_reveal", name: "Cinematic Reveal", description: "Starts close and backs away to show the whole home.", manual: { zoom: -5, vertical: 1 }, start: { x: 0, y: 0.03, zoom: 1 } },
  { id: "full_view", name: "Full Property View", description: "Shows the whole property with a barely-there drift.", manual: { zoom: 0.8 } },
];

export function applyMovePreset(spec: CameraSpec, id: string): CameraSpec {
  const p = MOVE_PRESETS.find((x) => x.id === id);
  if (!p) return spec;
  return { ...spec, manual: { ...ZERO_MANUAL, ...p.manual }, manualStart: p.start && (p.start.x || p.start.y || p.start.zoom !== 1) ? { ...p.start } : null,
    startFrame: null, endFrame: null, keyframes: null, easing: "ease-in-out" };
}

export function defaultSpec(move: StudioMoveId = "push_in", patch: Partial<CameraSpec> = {}): CameraSpec {
  return {
    move, strength: 0.55, speed: 1, direction: 0, reverse: false, distance: 0.1, zoom: 1, rotation: 0, depth: 0.5,
    easing: "ease-in-out", motionBlur: 0, target: { x: 0, y: 0 }, lens: null, startFrame: null, endFrame: null, keyframes: null,
    ...patch,
  };
}

export function easySpec(id: EasyCameraId, intensity: Intensity): CameraSpec {
  const e = EASY_CAMERAS.find((c) => c.id === id)!;
  return defaultSpec(e.move, { strength: INTENSITY_STRENGTH[intensity], easing: e.easing, motionBlur: intensity === "dramatic" ? 120 : 0 });
}

/* ── Cinematic presets (studied from Open Generative AI's Cinema Studio: camera body + lens + focal
      length + aperture as one look; here each look is lens feel + move + timing) ── */

export interface CinematicPreset { id: string; name: string; description: string; spec: Partial<CameraSpec> & { move: StudioMoveId } }

export const CINEMATIC_PRESETS: readonly CinematicPreset[] = [
  { id: "architectural-wide", name: "Architectural Wide Angle", description: "Wide, level and slow — straight lines stay straight.",
    spec: { move: "truck_right", lens: 14, strength: 0.35, easing: "ease-in-out", rotation: 0, distance: 0.08 } },
  { id: "luxury-cinematic", name: "Luxury Cinematic", description: "Slow push with a film-like motion blur.",
    spec: { move: "push_in", lens: 35, strength: 0.45, easing: "ease-in-out", motionBlur: 180, distance: 0.1 } },
  { id: "smooth-interior", name: "Smooth Interior Tour", description: "Steady glide across a room, like a gimbal.",
    spec: { move: "truck_left", lens: 24, strength: 0.5, easing: "linear", distance: 0.12 } },
  { id: "exterior-reveal", name: "Exterior Reveal", description: "Starts on a detail and backs away to the whole home.",
    spec: { move: "pull_out", lens: 24, strength: 0.7, easing: "ease-out", distance: 0.12 } },
  { id: "slow-drone", name: "Slow Drone-Style Reveal", description: "Rises and pulls back slowly. Best with AI; otherwise a 2D stand-in.",
    spec: { move: "drone_reveal", lens: 24, strength: 0.6, easing: "ease-out", motionBlur: 90, distance: 0.12 } },
  { id: "room-focus", name: "Detailed Room Focus", description: "Tighter framing that eases in on one feature.",
    spec: { move: "push_in", lens: 85, strength: 0.4, easing: "ease-in-out", distance: 0.08 } },
];

export function presetSpec(id: string): CameraSpec | undefined {
  const p = CINEMATIC_PRESETS.find((x) => x.id === id);
  return p ? defaultSpec(p.spec.move, p.spec) : undefined;
}

/* ── Spec → views ──────────────────────────────────────────────────────── */

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const r4 = (n: number) => Math.round(n * 10000) / 10000;

/** Keeps a spec inside safe ranges (also protects against bad input). */
export function normalizeSpec(s: CameraSpec): CameraSpec {
  const view = (v: CameraView | null) => (v ? {
    x: clamp(v.x, -0.5, 0.5), y: clamp(v.y, -0.5, 0.5), zoom: clamp(v.zoom, 1, 4), rotation: clamp(v.rotation, -30, 30),
  } : null);
  return {
    ...s,
    strength: clamp(s.strength, 0, 1), speed: clamp(s.speed, 0.5, 2), direction: clamp(s.direction, -180, 180),
    distance: clamp(s.distance, 0.02, 0.4), zoom: clamp(s.zoom, 1, 2), rotation: clamp(s.rotation, -15, 15),
    depth: clamp(s.depth, 0, 1), motionBlur: clamp(s.motionBlur, 0, 360),
    target: { x: clamp(s.target.x, -0.45, 0.45), y: clamp(s.target.y, -0.45, 0.45) },
    startFrame: view(s.startFrame), endFrame: view(s.endFrame),
    keyframes: s.keyframes
      ? s.keyframes.slice(0, 24).map((k) => ({ ...view(k)!, t: clamp(k.t, 0, 1), ...(k.ease ? { ease: k.ease } : {}) })).sort((a, b) => a.t - b.t)
      : null,
    manual: s.manual
      ? Object.fromEntries(MANUAL_AXES.map((a) => [a, Math.round(clamp(Number(s.manual![a]) || 0, -10, 10) * 10) / 10])) as unknown as ManualMove
      : null,
    manualStart: s.manualStart
      ? { x: clamp(Number(s.manualStart.x) || 0, -0.5, 0.5), y: clamp(Number(s.manualStart.y) || 0, -0.5, 0.5), zoom: clamp(Number(s.manualStart.zoom) || 1, 0.5, 3) }
      : null,
    ...(s.fit ? { fit: specFit(s) } : {}),
    ...(s.background ? { background: {
      kind: (BACKGROUND_KINDS as readonly string[]).includes(s.background.kind) ? s.background.kind : "blur",
      color: HEX.test(s.background.color) ? s.background.color : DEFAULT_BACKGROUND.color,
      color2: HEX.test(s.background.color2) ? s.background.color2 : DEFAULT_BACKGROUND.color2,
    } } : {}),
    ...(s.safeArea ? { safeArea: normalizeSafeArea(s.safeArea) } : {}),
  };
}

const HEX = /^#[0-9a-fA-F]{6}$/;
function normalizeSafeArea(a: SafeArea): SafeArea {
  const x0 = clamp(Number(a.x0) || 0, 0, 0.9), y0 = clamp(Number(a.y0) || 0, 0, 0.9);
  return { x0, y0, x1: clamp(Number(a.x1) || 1, x0 + 0.1, 1), y1: clamp(Number(a.y1) || 1, y0 + 0.1, 1) };
}

/** Zoom toward a point: the target stays where it is on screen while the zoom changes. */
function zoomAbout(target: { x: number; y: number }, from: CameraView, toZoom: number): CameraView {
  const k = from.zoom / toZoom;
  return { ...from, zoom: toZoom, x: target.x - k * (target.x - from.x), y: target.y - k * (target.y - from.y) };
}

/** Start and end views of the generated (non-custom) path. */
export function moveViews(spec: CameraSpec): [CameraView, CameraView] {
  const s = normalizeSpec(spec);
  const lens = s.lens ? LENS_FEEL[s.lens] : LENS_FEEL[35];
  const z0 = s.zoom * (s.lens ? lens.zoom : 1);
  const a = Math.min(0.45, s.distance * (0.5 + s.strength) * lens.motion * Math.min(1, s.speed));
  const base: CameraView = { x: 0, y: 0, zoom: z0, rotation: 0 };
  const t = s.target;
  const rad = (s.direction * Math.PI) / 180;
  const dir = (dx: number, dy: number): [number, number] => [dx * Math.cos(rad) - dy * Math.sin(rad), dx * Math.sin(rad) + dy * Math.cos(rad)];
  const slide = (dx: number, dy: number, zoomEnd = 1): [CameraView, CameraView] => {
    const [ux, uy] = dir(dx, dy);
    return [{ ...base, x: -ux / 2, y: -uy / 2 }, { ...base, x: ux / 2, y: uy / 2, zoom: z0 * zoomEnd }];
  };
  let pair: [CameraView, CameraView];
  switch (s.move) {
    case "push_in": pair = [base, zoomAbout(t, base, z0 * (1 + 2 * a))]; break;
    case "pull_out": { const near = zoomAbout(t, base, z0 * (1 + 2 * a)); pair = [near, base]; break; }
    case "dolly_in": pair = [base, zoomAbout(t, base, z0 * (1 + 2.6 * a))]; break;
    case "dolly_out": { const near = zoomAbout(t, base, z0 * (1 + 2.6 * a)); pair = [near, base]; break; }
    case "zoom": pair = [base, zoomAbout(t, base, z0 * (1 + 4 * a))]; break;
    // the view centre moves the way the camera travels
    case "truck_left": pair = slide(-a, 0); break;
    case "truck_right": pair = slide(a, 0); break;
    case "pan_left": pair = slide(-1.2 * a, 0); break;
    case "pan_right": pair = slide(1.2 * a, 0); break;
    case "tilt_up": pair = slide(0, -1.2 * a); break;
    case "tilt_down": pair = slide(0, 1.2 * a); break;
    case "crane_up": pair = slide(0, -a, 1 - 0.3 * a); break;
    case "crane_down": pair = slide(0, a, 1 + 0.3 * a); break;
    case "parallax": pair = slide(a, 0, 1 + 0.4 * a); break;
    // 2D stand-ins for moves that need depth: a slide + slight zoom + roll suggests the motion, nothing more
    case "orbit_left": case "orbit_right": case "arc_left": case "arc_right": {
      const sign = s.move.endsWith("left") ? -1 : 1;
      const arc = s.move.startsWith("arc");
      pair = [
        { ...base, x: t.x - (sign * a) / 2, y: t.y * 0.5, rotation: sign * 1.2 * s.strength },
        { ...base, x: t.x + (sign * a) / 2, y: t.y * 0.5, zoom: z0 * (1 + (arc ? 1.4 : 0.5) * a), rotation: -sign * 1.2 * s.strength },
      ];
      break;
    }
    case "drone_reveal": pair = [{ ...base, zoom: z0 * (1 + 2.4 * a), y: 0.6 * a }, { ...base, y: -0.2 * a }]; break;
  }
  if (s.rotation) pair = [{ ...pair[0], rotation: pair[0].rotation }, { ...pair[1], rotation: pair[1].rotation + s.rotation }];
  return s.reverse ? [pair[1], pair[0]] : pair;
}

/** The keys the camera follows, in view terms, with `t` in seconds. */
export function cameraPath(spec: CameraSpec, duration: number): CameraKey[] {
  const s = normalizeSpec(spec);
  const lensZoom = s.lens ? LENS_FEEL[s.lens].zoom : 1;
  if (s.keyframes && s.keyframes.length >= 2) {
    return s.keyframes.map((k, i) => ({
      t: r4(k.t * duration), x: k.x, y: k.y, zoom: k.zoom * lensZoom, rotation: k.rotation,
      ...(i > 0 ? { ease: k.ease ?? s.easing } : {}),
    }));
  }
  const [from, to] = hasManual(s)
    ? manualViews(s.manual ?? ZERO_MANUAL, s.zoom * lensZoom, s.manualStart)
    : s.startFrame && s.endFrame
      ? [{ ...s.startFrame, zoom: s.startFrame.zoom * lensZoom }, { ...s.endFrame, zoom: s.endFrame.zoom * lensZoom }]
      : moveViews(s);
  const arrive = r4(duration / Math.max(1, s.speed));
  const keys: CameraKey[] = [{ t: 0, ...from }, { t: arrive, ...to, ease: s.easing }];
  if (arrive < duration - 0.01) keys.push({ t: r4(duration), ...to, ease: "linear" });
  return keys;
}

/* ── Views → FableCut keyframes ────────────────────────────────────────── */

export interface Canvas { width: number; height: number }
export interface Kf { t: number; v: number; ease?: Easing }
export type CameraChannels = Record<"x" | "y" | "scale" | "rotation", Kf[]>;
export interface CameraRender {
  keyframes: CameraChannels;
  /** Clip props to set with the keyframes: FableCut's `fit` for the photo, plus motion blur. */
  props: { fit: "contain" | "cover"; motionBlur?: number; motionBlurSamples?: number };
  /** Fill Screen: extra zoom added so no edge of the photo shows (1 = none needed). */
  edgeGuard: number;
  /** The framing mode used. */
  mode: PhotoFit;
  /**
   * Show Entire Photo / Smart Fit: how much the whole move was scaled down so the photo
   * (or the safe area) stays fully in view (1 = not at all).
   */
  fitScale: number;
  /** What fills the space around the photo (null for Fill Screen). */
  background: FrameBackground | null;
  /** The framing the keyframes were made with. */
  framing: Framing;
}

/** FableCut's keyframe interpolation (app.js kfChannel): ease on the destination key, held outside. */
export function evalChannel(keys: Kf[] | undefined, t: number, fallback: number): number {
  if (!keys || keys.length === 0) return fallback;
  if (t <= keys[0]!.t) return keys[0]!.v;
  const last = keys[keys.length - 1]!;
  if (t >= last.t) return last.v;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i]!, b = keys[i + 1]!;
    if (t >= a.t && t <= b.t) {
      const u = (t - a.t) / Math.max(1e-6, b.t - a.t);
      return a.v + (b.v - a.v) * EASE_FN[b.ease ?? "ease-in-out"](u);
    }
  }
  return fallback;
}

export interface Transform { x: number; y: number; scale: number; rotation: number }

export function transformAt(ch: Partial<CameraChannels> | undefined, t: number): Transform {
  return {
    x: evalChannel(ch?.x, t, 0), y: evalChannel(ch?.y, t, 0),
    scale: evalChannel(ch?.scale, t, 1), rotation: evalChannel(ch?.rotation, t, 0),
  };
}

/**
 * Does the photo cover the whole frame? The photo is drawn "cover"-fitted
 * (at least canvas size; `photo` gives its real proportions when known), then
 * moved by x/y, rotated and scaled about the centre — FableCut's order.
 */
export function coversFrame(tr: Transform, canvas: Canvas, photo?: { width: number; height: number } | null): boolean {
  const W = canvas.width, H = canvas.height;
  let iw = W, ih = H;
  if (photo && photo.width > 0 && photo.height > 0) {
    const f = Math.max(W / photo.width, H / photo.height);
    iw = photo.width * f; ih = photo.height * f;
  }
  const th = (-tr.rotation * Math.PI) / 180, c = Math.cos(th), s = Math.sin(th);
  for (const [cx, cy] of [[-W / 2, -H / 2], [W / 2, -H / 2], [W / 2, H / 2], [-W / 2, H / 2]] as const) {
    const dx = cx - tr.x, dy = cy - tr.y;
    const qx = (dx * c - dy * s) / tr.scale, qy = (dx * s + dy * c) / tr.scale;
    if (Math.abs(qx) > iw / 2 + 0.5 || Math.abs(qy) > ih / 2 + 0.5) return false;
  }
  return true;
}

/**
 * Where the photo sits before any camera move. Sizes are in canvas px with the photo drawn by
 * FableCut's `fit` at scale 1; `zoom` and `cx`/`cy` (a photo point, px from its centre, put in
 * the middle of the frame) are Smart Fit's framing. `region` is what must stay in view
 * (the whole photo for Show Entire Photo, the safe area for Smart Fit; null for Fill Screen).
 */
export interface Framing {
  mode: PhotoFit;
  fit: "contain" | "cover";
  iw: number; ih: number;
  zoom: number; cx: number; cy: number;
  region: { cx: number; cy: number; w: number; h: number } | null;
  /** Fill Screen: the share of the photo's width and height the frame shows at rest (1 = all of it). */
  visible: { w: number; h: number };
}

export function photoFraming(spec: Pick<CameraSpec, "fit" | "safeArea">, canvas: Canvas, photo?: { width: number; height: number } | null): Framing {
  const W = canvas.width, H = canvas.height;
  const pw = photo && photo.width > 0 && photo.height > 0 ? photo.width : W;
  const ph = photo && photo.width > 0 && photo.height > 0 ? photo.height : H;
  const fCover = Math.max(W / pw, H / ph), fContain = Math.min(W / pw, H / ph);
  const visible = { w: Math.min(1, W / (pw * fCover)), h: Math.min(1, H / (ph * fCover)) };
  const mode = specFit(spec);
  if (mode === "cover") return { mode, fit: "cover", iw: pw * fCover, ih: ph * fCover, zoom: 1, cx: 0, cy: 0, region: null, visible };
  const iw = pw * fContain, ih = ph * fContain;
  if (mode === "contain") return { mode, fit: "contain", iw, ih, zoom: 1, cx: 0, cy: 0, region: { cx: 0, cy: 0, w: iw, h: ih }, visible };
  const a = normalizeSafeArea(spec.safeArea ?? DEFAULT_SAFE_AREA);
  const sw = (a.x1 - a.x0) * iw, sh = (a.y1 - a.y0) * ih;
  const zoom = clamp(Math.min(W / sw, H / sh), 1, fCover / fContain);
  const rx = ((a.x0 + a.x1) / 2 - 0.5) * iw, ry = ((a.y0 + a.y1) / 2 - 0.5) * ih;
  // centre on the safe area, but never leave a gap on a side the photo could still fill
  const centre = (r: number, size: number, frame: number) => {
    const room = (zoom * size - frame) / (2 * zoom);
    return room <= 0 ? 0 : clamp(r, -room, room);
  };
  return { mode, fit: "contain", iw, ih, zoom, cx: centre(rx, iw, W), cy: centre(ry, ih, H), region: { cx: rx, cy: ry, w: sw, h: sh }, visible };
}

/** Is the framing's region (whole photo / safe area) fully inside the frame at this transform? */
export function regionInFrame(tr: Transform, canvas: Canvas, region: { cx: number; cy: number; w: number; h: number }): boolean {
  const th = (tr.rotation * Math.PI) / 180, c = Math.cos(th), s = Math.sin(th);
  const hw = canvas.width / 2 + 0.5, hh = canvas.height / 2 + 0.5;
  for (const [ux, uy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
    const px = (region.cx + (ux * region.w) / 2) * tr.scale, py = (region.cy + (uy * region.h) / 2) * tr.scale;
    const sx = tr.x + px * c - py * s, sy = tr.y + px * s + py * c;
    if (Math.abs(sx) > hw || Math.abs(sy) > hh) return false;
  }
  return true;
}

/** Views → FableCut channels. `k` scales the whole move (edge guard ≥ 1, fit limit ≤ 1). */
function toChannels(path: CameraKey[], canvas: Canvas, k: number, fr: Pick<Framing, "zoom" | "cx" | "cy"> = { zoom: 1, cx: 0, cy: 0 }): CameraChannels {
  const ch: CameraChannels = { x: [], y: [], scale: [], rotation: [] };
  for (const key of path) {
    const z = key.zoom * k;
    const e = key.ease ? { ease: key.ease } : {};
    ch.scale.push({ t: key.t, v: r4(z * fr.zoom), ...e });
    ch.x.push({ t: key.t, v: r4(-z * (fr.zoom * fr.cx + key.x * canvas.width)), ...e });
    ch.y.push({ t: key.t, v: r4(-z * (fr.zoom * fr.cy + key.y * canvas.height)), ...e });
    ch.rotation.push({ t: key.t, v: r4(key.rotation), ...e });
  }
  return ch;
}

/**
 * The STANDARD method: FableCut keyframes for this camera spec, in its framing mode.
 *  - Fill Screen: if any moment would show past the photo's edge, the whole move is zoomed in
 *    just enough (keeping the same view centre) — no black borders, ever.
 *  - Show Entire Photo / Smart Fit: if any moment would push the photo (or its safe area)
 *    past the frame's edge, the whole move is scaled down just enough — nothing is cropped,
 *    the movement still happens, only smaller.
 */
export function cameraKeyframes(spec: CameraSpec, duration: number, canvas: Canvas, photo?: { width: number; height: number } | null): CameraRender {
  if (!(duration > 0)) throw new Error("Duration must be greater than 0");
  const s = normalizeSpec(spec);
  const path = cameraPath(s, duration);
  const fr = photoFraming(s, canvas, photo);
  const samples = 48;
  const ok = (tr: Transform) => (fr.region ? regionInFrame(tr, canvas, fr.region) : coversFrame(tr, canvas, photo));
  const fits = (k: number) => {
    const ch = toChannels(path, canvas, k, fr);
    for (let i = 0; i <= samples; i++) if (!ok(transformAt(ch, (duration * i) / samples))) return false;
    return true;
  };
  let k = 1;
  if (!fits(1)) {
    if (!fr.region) {
      let lo = 1, hi = 1.5;
      while (!fits(hi) && hi < 8) { lo = hi; hi *= 1.5; }
      for (let i = 0; i < 20; i++) { const mid = (lo + hi) / 2; if (fits(mid)) hi = mid; else lo = mid; }
      k = hi * 1.002;
    } else {
      // positions and sizes both scale with k about the frame's centre, so smaller always fits
      let lo = 0.05, hi = 1;
      for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (fits(mid)) lo = mid; else hi = mid; }
      k = lo * 0.999;
    }
  }
  const keyframes = toChannels(path, canvas, k, fr);
  // drop channels that never change (smaller documents)
  for (const name of ["rotation", "x", "y"] as const) {
    if (keyframes[name].every((x) => x.v === 0)) delete (keyframes as Partial<CameraChannels>)[name];
  }
  const props = { fit: fr.fit, ...(s.motionBlur > 0 ? { motionBlur: Math.round(s.motionBlur), motionBlurSamples: 8 } : {}) };
  return {
    keyframes, props, mode: fr.mode, framing: fr,
    edgeGuard: fr.region ? 1 : r4(k), fitScale: fr.region ? r4(k) : 1, background: specBackground(s),
  };
}

/** How big the photo is drawn at a transform, relative to "the whole photo just fits" (1.0×). */
export function photoScale(framing: Pick<Framing, "iw" | "ih">, tr: Pick<Transform, "scale">, canvas: Canvas): number {
  return r4(tr.scale / Math.min(canvas.width / framing.iw, canvas.height / framing.ih));
}

/**
 * Smart Fit's safe area from a small greyscale copy of the photo (0…255, row by row): the
 * smallest box holding most of the photo's detail (edges), which on a listing photo is
 * usually the home — roof line, doors, windows, garage. Flat sky and plain lawn have little
 * detail and are left to the edges. A heuristic, not an object detector.
 */
export function safeAreaFromPixels(gray: ArrayLike<number>, w: number, h: number): SafeArea {
  if (w < 8 || h < 8 || gray.length < w * h) return { ...DEFAULT_SAFE_AREA };
  const col = new Float64Array(w), row = new Float64Array(h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = gray[i + 1]! - gray[i - 1]!, gy = gray[i + w]! - gray[i - w]!;
      const g = Math.sqrt(gx * gx + gy * gy);
      col[x] = col[x]! + g; row[y] = row[y]! + g;
    }
  }
  const span = (e: Float64Array, share: number): [number, number] => {
    const n = e.length;
    // a gentle pull to the middle: the subject of a listing photo is rarely at the very edge
    const v = Array.from(e, (x, i) => x * (1 - 0.25 * Math.abs((i + 0.5) / n - 0.5) * 2));
    const total = v.reduce((a, b) => a + b, 0);
    if (total <= 0) return [0, n];
    let best: [number, number] = [0, n], sum = 0, lo = 0;
    for (let hi = 0; hi < n; hi++) {
      sum += v[hi]!;
      while (lo < hi && sum - v[lo]! >= share * total) { sum -= v[lo]!; lo++; }
      if (sum >= share * total && hi + 1 - lo < best[1] - best[0]) best = [lo, hi + 1];
    }
    return best;
  };
  const [cx0, cx1] = span(col, 0.85), [cy0, cy1] = span(row, 0.85);
  const pad = 0.05;
  let x0 = cx0 / w - pad, x1 = cx1 / w + pad, y0 = cy0 / h - pad, y1 = cy1 / h + pad;
  // at least half the photo each way, and keep the ground in front (driveway, yard)
  const grow = (a: number, b: number, min: number): [number, number] => {
    const d = min - (b - a);
    return d > 0 ? [a - d / 2, b + d / 2] : [a, b];
  };
  [x0, x1] = grow(x0, x1, 0.5); [y0, y1] = grow(y0, y1, 0.5);
  y1 = Math.max(y1, 0.9);
  const r3 = (n: number) => Math.round(clamp(n, 0, 1) * 1000) / 1000;
  return normalizeSafeArea({ x0: r3(x0), y0: r3(y0), x1: r3(x1), y1: r3(y1) });
}

/** Plain-English summary, e.g. "Push In · 5 s · gentle". */
export function describeSpec(spec: CameraSpec, duration?: number): string {
  if (hasManual(spec)) {
    const parts = MANUAL_AXES.filter((a) => spec.manual && spec.manual[a] !== 0).map((a) => `${MANUAL_LABELS[a].label} ${spec.manual![a] > 0 ? "+" : ""}${spec.manual![a]}`);
    return ["Custom movement", duration ? `${duration} s` : null, parts.join(", ") || "custom start frame", spec.fit ? PHOTO_FIT_LABELS[specFit(spec)].label : null].filter(Boolean).join(" · ");
  }
  const m = getStudioMove(spec.move);
  const feel = spec.strength < 0.4 ? "gentle" : spec.strength < 0.75 ? "normal" : "dramatic";
  return [m?.name ?? spec.move, duration ? `${duration} s` : null, feel, spec.lens ? `${spec.lens}mm-style` : null,
    spec.keyframes ? "custom keyframes" : null].filter(Boolean).join(" · ");
}

/* ── AI depth method: camera poses ─────────────────────────────────────── */

/**
 * A virtual camera for the depth renderer, at progress u (0…1, already eased).
 * Units: the scene's middle depth is 1. tx/ty/tz move the camera (x right, y down, z forward);
 * yaw/pitch/roll in degrees; fovDeg is the simulated field of view.
 */
export interface DepthPose { tx: number; ty: number; tz: number; yaw: number; pitch: number; roll: number; fovDeg: number; pivot: { x: number; y: number } }

export function depthPose(spec: CameraSpec, u: number): DepthPose {
  const s = normalizeSpec(spec);
  const lens = s.lens ? LENS_FEEL[s.lens] : LENS_FEEL[35];
  const a = Math.min(0.45, s.distance * (0.5 + s.strength) * lens.motion * Math.min(1, s.speed));
  const p = s.reverse ? 1 - u : u;
  const c = p - 0.5; // centred progress for sideways moves
  const rad = (s.direction * Math.PI) / 180;
  const lat = (d: number) => ({ tx: d * Math.cos(rad), ty: d * Math.sin(rad) });
  const pose: DepthPose = { tx: 0, ty: 0, tz: 0, yaw: 0, pitch: 0, roll: s.rotation * p, fovDeg: lens.fovDeg, pivot: s.target };
  if (s.manual && !isManualZero(s.manual)) {
    const m = s.manual, k = MANUAL_SCALE;
    // real travel and real turns through the depth map
    pose.tx = m.horizontal * k.depthTravel * p;
    pose.ty = -m.vertical * k.depthTravel * p;
    pose.tz = m.zoom * k.depthTravel * 1.5 * p;
    pose.yaw = m.pan * k.depthTurnDeg * p;
    pose.pitch = m.tilt * k.depthTurnDeg * p;
    pose.roll = m.rotate * k.rollDeg * p;
    return pose;
  }
  // Small, natural amounts (a few % of the scene depth): bigger moves expose what a single photo can't show.
  switch (s.move) {
    case "push_in": case "dolly_in": pose.tz = 0.8 * a * p; break;
    case "pull_out": case "dolly_out": pose.tz = 0.8 * a * (1 - p); break;
    case "zoom": pose.fovDeg = lens.fovDeg / (1 + 4 * a * p); break;
    case "truck_left": Object.assign(pose, lat(-0.25 * a * c * 2)); break;
    case "truck_right": Object.assign(pose, lat(0.25 * a * c * 2)); break;
    case "parallax": Object.assign(pose, lat(0.3 * a * c * 2)); pose.tz = 0.15 * a * p; break;
    case "pan_left": pose.yaw = -40 * a * c * 2; break;
    case "pan_right": pose.yaw = 40 * a * c * 2; break;
    case "tilt_up": pose.pitch = 40 * a * c * 2; break;
    case "tilt_down": pose.pitch = -40 * a * c * 2; break;
    case "crane_up": pose.ty = -0.3 * a * c * 2; pose.pitch = -6 * a * c * 2; break;
    case "crane_down": pose.ty = 0.3 * a * c * 2; pose.pitch = 6 * a * c * 2; break;
    case "orbit_left": case "orbit_right": pose.yaw = (s.move === "orbit_left" ? -1 : 1) * (2 + 15 * a) * c * 2; break;
    case "arc_left": case "arc_right":
      pose.yaw = (s.move === "arc_left" ? -1 : 1) * (1.5 + 10 * a) * c * 2; pose.tz = 0.5 * a * p; break;
    case "drone_reveal": pose.ty = -0.35 * a * p; pose.tz = 0.6 * a * (1 - p); pose.pitch = -4 * a * p; break;
  }
  return pose;
}

/** Orbit/yaw moves turn around the pivot (true for orbit and arc, false for a pan which turns in place). */
export function poseTurnsAroundPivot(move: StudioMoveId): boolean {
  return move.startsWith("orbit") || move.startsWith("arc");
}
