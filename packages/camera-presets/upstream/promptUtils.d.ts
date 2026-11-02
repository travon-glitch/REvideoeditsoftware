/* Type declarations for the verbatim upstream file promptUtils.js
 * (Anil-matcha/Open-Generative-AI @ 84b29a55ff8bd536c7fdda5d80e2f120cac9d6e1, src/lib/promptUtils.js, MIT). */
export const ENHANCE_TAGS: Record<"quality" | "lighting" | "mood" | "style", string[]>;
export const QUICK_PROMPTS: { label: string; prompt: string }[];
export const CAMERA_MAP: Record<string, string>;
export const LENS_MAP: Record<string, string>;
export const FOCAL_PERSPECTIVE: Record<number, string>;
export const APERTURE_EFFECT: Record<string, string>;
export function buildNanoBananaPrompt(
  basePrompt: string,
  camera: string,
  lens: string,
  focalLength: number,
  aperture: string,
): string;
