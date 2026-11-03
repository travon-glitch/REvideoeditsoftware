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

/** Start and end views of a hand-set movement (before the lens zoom and edge guard). */
export function manualViews(m: ManualMove, baseZoom = 1): [CameraView, CameraView] {
  const k = MANUAL_SCALE;
  const zIn = 1 + Math.abs(m.zoom) * k.zoom;
  const start: CameraView = { x: 0, y: 0, zoom: baseZoom * (m.zoom < 0 ? zIn : 1), rotation: 0 };
  const end: CameraView = {
    x: clamp(m.horizontal * k.slide + m.pan * k.turnSlide, -0.5, 0.5),
    // + is up, which is towards the top of the photo (negative y)
    y: clamp(-(m.vertical * k.slide + m.tilt * k.turnSlide), -0.5, 0.5),
    zoom: baseZoom * (m.zoom > 0 ? zIn : 1),
    rotation: m.rotate * k.rollDeg,
  };
  return [start, end];
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
  };
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
  const [from, to] = s.manual && !isManualZero(s.manual)
    ? manualViews(s.manual, s.zoom * lensZoom)
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
  props: { motionBlur?: number; motionBlurSamples?: number };
  /** Extra zoom added so no black edges show (1 = none needed). */
  edgeGuard: number;
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

function toChannels(path: CameraKey[], canvas: Canvas, k: number): CameraChannels {
  const ch: CameraChannels = { x: [], y: [], scale: [], rotation: [] };
  for (const key of path) {
    const z = key.zoom * k;
    const e = key.ease ? { ease: key.ease } : {};
    ch.scale.push({ t: key.t, v: r4(z), ...e });
    ch.x.push({ t: key.t, v: r4(-z * key.x * canvas.width), ...e });
    ch.y.push({ t: key.t, v: r4(-z * key.y * canvas.height), ...e });
    ch.rotation.push({ t: key.t, v: r4(key.rotation), ...e });
  }
  return ch;
}

/**
 * The STANDARD method: FableCut keyframes for this camera spec.
 * If any moment would show past the photo's edge, the whole move is zoomed in
 * just enough (keeping the same view centre) — no black borders, ever.
 */
export function cameraKeyframes(spec: CameraSpec, duration: number, canvas: Canvas, photo?: { width: number; height: number } | null): CameraRender {
  if (!(duration > 0)) throw new Error("Duration must be greater than 0");
  const s = normalizeSpec(spec);
  const path = cameraPath(s, duration);
  const samples = 48;
  const fits = (k: number) => {
    const ch = toChannels(path, canvas, k);
    for (let i = 0; i <= samples; i++) if (!coversFrame(transformAt(ch, (duration * i) / samples), canvas, photo)) return false;
    return true;
  };
  let k = 1;
  if (!fits(1)) {
    let lo = 1, hi = 1.5;
    while (!fits(hi) && hi < 8) { lo = hi; hi *= 1.5; }
    for (let i = 0; i < 20; i++) { const mid = (lo + hi) / 2; if (fits(mid)) hi = mid; else lo = mid; }
    k = hi * 1.002;
  }
  const keyframes = toChannels(path, canvas, k);
  // drop channels that never change (smaller documents)
  for (const name of ["rotation", "x", "y"] as const) {
    if (keyframes[name].every((x) => x.v === 0)) delete (keyframes as Partial<CameraChannels>)[name];
  }
  const props = s.motionBlur > 0 ? { motionBlur: Math.round(s.motionBlur), motionBlurSamples: 8 } : {};
  return { keyframes, props, edgeGuard: r4(k) };
}

/** Plain-English summary, e.g. "Push In · 5 s · gentle". */
export function describeSpec(spec: CameraSpec, duration?: number): string {
  if (spec.manual && !isManualZero(spec.manual)) {
    const parts = MANUAL_AXES.filter((a) => spec.manual![a] !== 0).map((a) => `${MANUAL_LABELS[a].label} ${spec.manual![a] > 0 ? "+" : ""}${spec.manual![a]}`);
    return ["Custom movement", duration ? `${duration} s` : null, parts.join(", ")].filter(Boolean).join(" · ");
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
