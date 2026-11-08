/*
 * AI Camera Control: plain-English camera directions → structured camera instructions → a
 * CameraSpec the existing engine renders (the same one Move camera, Easy camera and the
 * export use).
 *
 *   1. Claude (the company's key, the AI Director's client) reads the request (and the photo,
 *      when it can be sent) and fills a fixed JSON schema — the API enforces the schema, and
 *      it's validated again here.
 *   2. Without Claude, a small keyword reader fills the same instructions (free, labelled
 *      "basic" in the app).
 *   3. instructionsToSpec() is the only way instructions become camera settings. It is
 *      deterministic, clamps everything, and enforces Full Image Visibility: when it's on, the
 *      photo is drawn whole (contain) whatever the instructions say, and any part of the request
 *      that conflicts is reported back, never silently dropped.
 */
import * as z from "zod/v4";
import {
  DEFAULT_BACKGROUND, DEFAULT_GIMBAL, INTENSITY_STRENGTH, ZERO_MANUAL, applyMovePreset, defaultSpec, getStudioMove, normalizeSpec,
  type CameraSpec, type Easing, type Intensity, type StudioMoveId,
} from "@lvs/camera-presets";
import type { Aspect } from "@/lib/video/plan";

/* ── Movements ─────────────────────────────────────────────────────────── */

/** Easy movements (Move camera presets and gentle studio moves) and every Advanced studio move. */
export const AI_EASY_MOVES = [
  "move_closer", "move_back", "move_left", "move_right", "move_up", "move_down", "cinematic_reveal", "luxury", "full_property_showcase",
] as const;
export const AI_ADVANCED_MOVES = [
  "push_in", "pull_out", "pan_left", "pan_right", "tilt_up", "tilt_down", "dolly_in", "dolly_out", "truck_left", "truck_right",
  "crane_up", "crane_down", "orbit_left", "orbit_right", "arc_left", "arc_right", "parallax", "drone_reveal", "zoom",
] as const satisfies readonly StudioMoveId[];
export const AI_MOVEMENTS = [...AI_EASY_MOVES, ...AI_ADVANCED_MOVES] as const;
export type AiMovement = (typeof AI_MOVEMENTS)[number];

export const AI_EASY_LABELS: Record<(typeof AI_EASY_MOVES)[number], { name: string; description: string }> = {
  move_closer: { name: "Move Closer", description: "Glides toward the home (or the point you name)." },
  move_back: { name: "Move Back", description: "Starts close and backs away to show more." },
  move_left: { name: "Move Left", description: "Glides to the left." },
  move_right: { name: "Move Right", description: "Glides to the right." },
  move_up: { name: "Move Up", description: "Rises slowly, e.g. up to the roofline." },
  move_down: { name: "Move Down", description: "Lowers slowly, e.g. down to the entrance." },
  cinematic_reveal: { name: "Cinematic Reveal", description: "Starts close, then backs away to reveal the whole property." },
  luxury: { name: "Luxury Camera Movement", description: "A slow, smooth diagonal glide that moves a little closer." },
  full_property_showcase: { name: "Full Property Showcase", description: "The whole property with a barely-there drift." },
};

/* ── The structured instructions ───────────────────────────────────────── */

export const cameraInstructionsSchema = z.object({
  movement: z.enum(AI_MOVEMENTS),
  framing: z.enum(["contain", "cover", "smart"]),
  preserveEntireImage: z.boolean(),
  duration: z.number(),
  intensity: z.enum(["gentle", "normal", "dramatic"]),
  aspectRatio: z.enum(["16:9", "9:16", "1:1", "4:5"]),
  background: z.enum(["blur", "color", "gradient"]),
  easing: z.enum(["linear", "easeIn", "easeOut", "easeInOut"]),
  feel: z.enum(["steady", "gimbal"]),
  /** What the camera moves toward / around, as a point in the photo (fractions from the centre, −0.45…0.45). */
  focus: z.object({ x: z.number(), y: z.number(), label: z.string() }).nullable(),
  /** The method the request is really asking for (perspective, orbit, aerial → AI). */
  suggestedMethod: z.enum(["standard", "ai_depth", "ai_generative"]),
  /** One or two plain sentences: what the camera will do. */
  explanation: z.string(),
  /** Anything asked for that can't be done as asked (and what is done instead). */
  conflicts: z.array(z.string()),
});
export type CameraInstructions = z.infer<typeof cameraInstructionsSchema>;

export interface InterpretContext {
  aspect: Aspect;
  /** Full Image Visibility, as the person set it. Instructions can't turn it off. */
  preserveEntireImage: boolean;
  duration: number;
  /** The photo's size, when known (landscape / portrait matters for the advice). */
  photo?: { width: number | null; height: number | null } | null;
}

/* ── Without Claude: a small keyword reader ────────────────────────────── */

export function basicInstructions(prompt: string, ctx: InterpretContext): CameraInstructions {
  const p = ` ${prompt.toLowerCase().replace(/[^a-z0-9 ]+/g, " ")} `;
  const has = (...w: string[]) => w.some((x) => p.includes(` ${x} `) || p.includes(` ${x}`));
  const movement: AiMovement =
    has("orbit", "circle around") ? (has("right") ? "orbit_right" : "orbit_left")
    : has("drone", "aerial", "bird") ? "drone_reveal"
    : has("parallax") ? "parallax"
    : has("reveal") ? "cinematic_reveal"
    : has("luxury", "elegant", "upscale") ? "luxury"
    : has("left to right", "to the right", "move right", "pan right", "slide right", "rightward") ? "move_right"
    : has("right to left", "to the left", "move left", "pan left", "slide left", "leftward") ? "move_left"
    : has("upward", "move up", "rise", "raise", "up to", "tilt up", "roof") ? "move_up"
    : has("downward", "move down", "lower", "down to", "tilt down") ? "move_down"
    : has("away", "back", "pull out", "zoom out", "pull back") ? "move_back"
    : has("closer", "toward", "towards", "push in", "zoom in", "zoom", "approach") ? "move_closer"
    : has("whole", "entire", "full", "showcase") ? "full_property_showcase"
    : has("cinematic", "instagram", "reel", "tiktok") ? "luxury"
    : "move_closer";
  const fill = has("fill the screen", "fill screen", "edge to edge", "full screen", "crop");
  const intensity: Intensity = has("dramatic", "fast", "bold", "strong", "quick") ? "dramatic" : has("normal", "medium") ? "normal" : "gentle";
  const slow = has("slow", "slowly", "gentle", "gently", "subtle");
  const ai = (["orbit_left", "orbit_right", "drone_reveal", "parallax"] as AiMovement[]).includes(movement);
  return {
    movement,
    framing: ctx.preserveEntireImage || !fill ? "contain" : "cover",
    preserveEntireImage: !fill,
    duration: slow ? Math.max(ctx.duration, 7) : ctx.duration,
    intensity,
    aspectRatio: has("reel", "instagram", "tiktok", "vertical", "story", "stories") ? "9:16" : has("youtube", "horizontal", "landscape video") ? "16:9" : has("square") ? "1:1" : ctx.aspect,
    background: "blur",
    easing: "easeInOut",
    feel: has("steady", "tripod", "locked") ? "steady" : "gimbal",
    focus: null,
    suggestedMethod: movement === "drone_reveal" ? "ai_generative" : ai ? "ai_depth" : "standard",
    explanation: "",
    conflicts: [],
  };
}

/* ── Instructions → camera settings (validated, Full Image enforced) ───── */

export interface InterpretedMove {
  instructions: CameraInstructions;
  spec: CameraSpec;
  aspect: Aspect;
  duration: number;
  /** Plain-English notes for the person: what was understood, and anything changed to respect their settings. */
  notes: string[];
  source: "claude" | "basic";
}

const EASING: Record<CameraInstructions["easing"], Easing> = { linear: "linear", easeIn: "ease-in", easeOut: "ease-out", easeInOut: "ease-in-out" };
const SCALE: Record<Intensity, number> = { gentle: 0.6, normal: 1, dramatic: 1.6 };
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, Number.isFinite(v) ? v : a));
const r1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Turns (validated) instructions into a CameraSpec. `base` keeps what the person already chose
 * (background colours, Smart Fit area). Full Image Visibility, when the person has it on,
 * always wins: the photo is drawn whole, and the request's conflicting parts are listed in notes.
 */
export function instructionsToSpec(ins: CameraInstructions, ctx: InterpretContext, base?: CameraSpec | null, source: "claude" | "basic" = "claude"): InterpretedMove {
  const notes: string[] = [];
  const intensity = ins.intensity;
  const k = SCALE[intensity];
  const focus = ins.focus ? { x: clamp(ins.focus.x, -0.45, 0.45), y: clamp(ins.focus.y, -0.45, 0.45) } : { x: 0, y: 0 };
  const strength = INTENSITY_STRENGTH[intensity];
  let spec: CameraSpec;
  const studio = (move: StudioMoveId, patch: Partial<CameraSpec> = {}) => defaultSpec(move, { strength, target: focus, ...patch });
  const manual = (m: Partial<typeof ZERO_MANUAL>) => ({ ...defaultSpec("push_in"), manual: { ...ZERO_MANUAL, ...Object.fromEntries(Object.entries(m).map(([a, v]) => [a, r1(clamp(v * k, -10, 10))])) } });
  switch (ins.movement) {
    case "move_closer": spec = studio("push_in"); break;
    case "move_back": spec = studio("pull_out"); break;
    case "move_left": spec = manual({ horizontal: -4 }); break;
    case "move_right": spec = manual({ horizontal: 4 }); break;
    case "move_up": spec = manual({ vertical: 4 }); break;
    case "move_down": spec = manual({ vertical: -4 }); break;
    case "cinematic_reveal": spec = applyMovePreset(defaultSpec("push_in"), "cinematic_reveal"); break;
    case "luxury": spec = { ...manual({ horizontal: 2.5, zoom: 2 }), easing: "ease-in-out" }; break;
    case "full_property_showcase": spec = applyMovePreset(defaultSpec("push_in"), "full_view"); break;
    default: spec = studio(ins.movement);
  }

  // Full Image Visibility: the person's switch decides; the instructions can't silently undo it
  let fit: CameraSpec["fit"] = ins.framing;
  if (ctx.preserveEntireImage) {
    if (ins.framing !== "contain" || !ins.preserveEntireImage) {
      notes.push(ins.framing === "smart"
        ? "Smart Fit would trim the edges of the photo, so the whole photo is kept visible (Show Entire Photo is on)."
        : "Your request asked to fill the screen, but Show Entire Photo is on, so the whole photo stays visible. Turn it off to fill the screen.");
    }
    fit = "contain";
  }
  const move = getStudioMove(spec.move);
  if (!spec.manual && move?.requiresAI) {
    notes.push(`A flat photo can't really ${move.name.toLowerCase()}: the standard version is a 2D stand-in. ${fit === "contain" ? "AI versions fill the frame, so they can't keep the whole photo visible." : "Use an AI method for real perspective."}`);
  }
  if (ins.suggestedMethod !== "standard" && fit === "contain") {
    notes.push(`For real perspective, try "${ins.suggestedMethod === "ai_depth" ? "AI depth" : "Generative AI"}" — it fills the frame, so part of the photo is cropped, and it's reviewed against your photo before use.`);
  }

  spec = normalizeSpec({
    ...spec,
    fit,
    background: fit === "cover" ? base?.background ?? null : { ...DEFAULT_BACKGROUND, ...(base?.background ?? {}), kind: ins.background },
    safeArea: fit === "smart" ? base?.safeArea ?? null : null,
    easing: EASING[ins.easing],
    gimbal: ins.feel === "gimbal" ? DEFAULT_GIMBAL : 0,
    motionBlur: 0,
  });
  for (const c of ins.conflicts.slice(0, 4)) notes.push(c.slice(0, 240));
  return {
    instructions: { ...ins, framing: fit ?? "cover", preserveEntireImage: ctx.preserveEntireImage || ins.preserveEntireImage },
    spec,
    aspect: ins.aspectRatio,
    duration: Math.round(clamp(ins.duration, 2, 10)),
    notes,
    source,
  };
}
