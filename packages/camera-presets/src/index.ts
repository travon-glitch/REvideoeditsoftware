/*
 * Camera moves for listing photos.
 *
 * Two parts:
 *  1. Lens "looks" — re-exported unchanged from Open-Generative-AI's promptUtils.js
 *     (Anil-matcha/Open-Generative-AI @ 84b29a5, MIT; see ../upstream/LICENSE).
 *  2. Real-estate camera moves (ours) — each move has plain-language copy for
 *     Easy Mode, a motion prompt for AI image-to-video models, and a Ken Burns
 *     fallback written as FableCut keyframes, used when AI is off or fails.
 */
import {
  APERTURE_EFFECT,
  CAMERA_MAP,
  FOCAL_PERSPECTIVE,
  LENS_MAP,
  buildNanoBananaPrompt,
} from "../upstream/promptUtils.js";

export { APERTURE_EFFECT, CAMERA_MAP, FOCAL_PERSPECTIVE, LENS_MAP, buildNanoBananaPrompt };

export const UPSTREAM_SOURCE = {
  repository: "https://github.com/Anil-matcha/Open-Generative-AI",
  commit: "84b29a55ff8bd536c7fdda5d80e2f120cac9d6e1",
  path: "src/lib/promptUtils.js",
  license: "MIT",
} as const;

export type RoomType = "exterior" | "interior" | "any";

export interface CameraMove {
  id: string;
  /** Short name shown on buttons. */
  name: string;
  /** One plain-language sentence for Easy Mode. */
  description: string;
  bestFor: RoomType;
  /** Camera direction phrase for AI image-to-video prompts. */
  motionPrompt: string;
  /** Ken Burns fallback: start/end scale and pan in % of the canvas. */
  kenBurns: { scaleFrom: number; scaleTo: number; panX: number; panY: number };
  /** Needs an AI model (true) or can be done for free with Ken Burns only (false). */
  aiOnly: boolean;
}

export const CAMERA_MOVES: readonly CameraMove[] = [
  {
    id: "push_in", name: "Push in", bestFor: "interior", aiOnly: false,
    description: "Slowly moves toward the room, like walking in.",
    motionPrompt: "slow smooth dolly forward into the room, steady gimbal, constant speed",
    kenBurns: { scaleFrom: 1, scaleTo: 1.18, panX: 0, panY: 0 },
  },
  {
    id: "pull_out", name: "Pull out", bestFor: "any", aiOnly: false,
    description: "Starts close and backs away to show the whole space.",
    motionPrompt: "slow smooth dolly backward revealing the full space, steady gimbal",
    kenBurns: { scaleFrom: 1.18, scaleTo: 1, panX: 0, panY: 0 },
  },
  {
    id: "pan_left", name: "Pan left", bestFor: "any", aiOnly: false,
    description: "Glides sideways from right to left.",
    motionPrompt: "slow lateral truck to the left, level horizon, steady",
    kenBurns: { scaleFrom: 1.12, scaleTo: 1.12, panX: -6, panY: 0 },
  },
  {
    id: "pan_right", name: "Pan right", bestFor: "any", aiOnly: false,
    description: "Glides sideways from left to right.",
    motionPrompt: "slow lateral truck to the right, level horizon, steady",
    kenBurns: { scaleFrom: 1.12, scaleTo: 1.12, panX: 6, panY: 0 },
  },
  {
    id: "orbit", name: "Orbit", bestFor: "interior", aiOnly: true,
    description: "Circles around the room's main feature.",
    motionPrompt: "slow orbiting arc around the center of the room, parallax between foreground and background",
    kenBurns: { scaleFrom: 1.08, scaleTo: 1.15, panX: 4, panY: 0 },
  },
  {
    id: "crane_up", name: "Rise up", bestFor: "any", aiOnly: true,
    description: "Lifts up smoothly to show the layout.",
    motionPrompt: "smooth vertical crane up with slight downward tilt, steady",
    kenBurns: { scaleFrom: 1.1, scaleTo: 1.1, panX: 0, panY: -5 },
  },
  {
    id: "drone_reveal", name: "Drone reveal", bestFor: "exterior", aiOnly: true,
    description: "Flies up and back to reveal the home and its surroundings.",
    motionPrompt: "aerial drone shot rising and pulling back to reveal the house and its lot, smooth and stable",
    kenBurns: { scaleFrom: 1.2, scaleTo: 1, panX: 0, panY: -3 },
  },
  {
    id: "walkthrough", name: "Walk through", bestFor: "interior", aiOnly: true,
    description: "Moves forward as if walking into the next room.",
    motionPrompt: "first-person walkthrough moving forward at walking pace, stabilized, natural perspective",
    kenBurns: { scaleFrom: 1, scaleTo: 1.25, panX: 0, panY: 0 },
  },
] as const;

/** Guardrail added to every AI prompt so the property is not altered. */
export const FIDELITY_GUARDRAIL =
  "keep the property exactly as photographed: do not add, remove or change furniture, fixtures, walls, windows, views or landscaping";

export function getMove(id: string): CameraMove | undefined {
  return CAMERA_MOVES.find((m) => m.id === id);
}

export interface LensLook {
  camera?: keyof typeof CAMERA_MAP | string;
  lens?: keyof typeof LENS_MAP | string;
  focalLength?: number;
  aperture?: keyof typeof APERTURE_EFFECT | string;
}

/** Builds the motion prompt for an AI image-to-video request. */
export function buildMotionPrompt(moveId: string, look: LensLook = {}, roomLabel?: string): string {
  const move = getMove(moveId);
  if (!move) throw new Error(`Unknown camera move: ${moveId}`);
  const parts: string[] = [];
  if (roomLabel) parts.push(`real estate video of the ${roomLabel.trim()}`);
  else parts.push("real estate video");
  parts.push(move.motionPrompt);
  if (look.camera) parts.push(`shot on a ${CAMERA_MAP[look.camera] ?? look.camera}`);
  if (look.lens) parts.push(`using a ${LENS_MAP[look.lens] ?? look.lens}`);
  if (look.focalLength) {
    const perspective = FOCAL_PERSPECTIVE[look.focalLength];
    parts.push(`${look.focalLength}mm${perspective ? ` (${perspective})` : ""}`);
  }
  if (look.aperture) {
    const effect = APERTURE_EFFECT[look.aperture];
    parts.push(`aperture ${look.aperture}${effect ? `, ${effect}` : ""}`);
  }
  parts.push("natural light, true-to-life colors");
  parts.push(FIDELITY_GUARDRAIL);
  return parts.join(", ");
}

export interface FableCutKeyframe {
  t: number;
  v: number;
  ease?: "linear" | "ease-in" | "ease-out" | "ease-in-out";
}

/**
 * Ken Burns fallback as FableCut clip keyframes (times relative to clip start,
 * x/y in px from the canvas center — see FableCut CLAUDE.md "project.json schema").
 */
export function kenBurnsKeyframes(
  moveId: string,
  durationSec: number,
  canvas: { width: number; height: number },
): Record<"scale" | "x" | "y", FableCutKeyframe[]> {
  const move = getMove(moveId);
  if (!move) throw new Error(`Unknown camera move: ${moveId}`);
  if (!(durationSec > 0)) throw new Error("Duration must be greater than 0");
  const kb = move.kenBurns;
  const round = (n: number) => Math.round(n * 1000) / 1000;
  const dx = round((kb.panX / 100) * canvas.width);
  const dy = round((kb.panY / 100) * canvas.height);
  const end = round(durationSec);
  return {
    scale: [{ t: 0, v: kb.scaleFrom }, { t: end, v: kb.scaleTo, ease: "ease-in-out" }],
    x: [{ t: 0, v: 0 }, { t: end, v: dx, ease: "ease-in-out" }],
    y: [{ t: 0, v: 0 }, { t: end, v: dy, ease: "ease-in-out" }],
  };
}
