import { z } from "zod";
import { ASPECTS } from "@/lib/video/plan";
import { cameraSpecSchema } from "@/lib/video/camera";

export const clipRequestSchema = z.object({
  assetId: z.string().uuid(),
  camera: cameraSpecSchema,
  duration: z.number().min(2).max(10),
  aspect: z.enum(ASPECTS),
});
export const aiRequestSchema = clipRequestSchema.extend({ method: z.enum(["depth", "generative"]) });
export const applySchema = z.object({
  projectId: z.string().uuid(),
  sceneId: z.string().regex(/^[a-z0-9_-]{1,40}$/i),
  camera: cameraSpecSchema.nullable(),
  clipAssetId: z.string().uuid().nullable(),
});
export const photoCameraSchema = z.object({ camera: cameraSpecSchema.nullable() });
export const reviewSchema = z.object({ decision: z.enum(["approved", "problem"]), note: z.string().trim().max(500).optional() });
export const interpretSchema = z.object({
  assetId: z.string().uuid(),
  prompt: z.string().trim().min(3).max(1000),
  aspect: z.enum(ASPECTS),
  duration: z.number().min(2).max(10),
  preserveEntireImage: z.boolean(),
  current: cameraSpecSchema.nullable(),
});
