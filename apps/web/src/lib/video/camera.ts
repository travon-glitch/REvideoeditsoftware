/* Validation for camera specs coming from the browser (the engine itself lives in @lvs/camera-presets). */
import { z } from "zod";
import { EASINGS, LENS_STYLES, STUDIO_MOVE_IDS, normalizeSpec, type CameraSpec } from "@lvs/camera-presets";

const num = (min: number, max: number) => z.number().finite().min(min).max(max);
const view = z.object({ x: num(-0.5, 0.5), y: num(-0.5, 0.5), zoom: num(1, 4), rotation: num(-30, 30) });
const easing = z.enum(EASINGS as unknown as [string, ...string[]]);

export const cameraSpecSchema = z.object({
  move: z.enum(STUDIO_MOVE_IDS),
  strength: num(0, 1),
  speed: num(0.5, 2),
  direction: num(-180, 180),
  reverse: z.boolean(),
  distance: num(0.02, 0.4),
  zoom: num(1, 2),
  rotation: num(-15, 15),
  depth: num(0, 1),
  easing,
  motionBlur: num(0, 360),
  target: z.object({ x: num(-0.45, 0.45), y: num(-0.45, 0.45) }),
  lens: z.union([z.literal(14), z.literal(24), z.literal(35), z.literal(50), z.literal(85)]).nullable(),
  startFrame: view.nullable(),
  endFrame: view.nullable(),
  keyframes: z.array(view.extend({ t: num(0, 1), ease: easing.optional() })).min(2).max(24).nullable(),
}).transform((s) => normalizeSpec(s as CameraSpec));

export const LENS_OPTIONS = LENS_STYLES;
export type { CameraSpec };
