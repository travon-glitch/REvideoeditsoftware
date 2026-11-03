/*
 * Admin control center: input rules and display helpers shared by the admin pages,
 * server actions and tests. Every rule here is checked again by the database.
 */
import { z } from "zod";
import { ROLES } from "@/lib/auth/roles";

const checkbox = z.union([z.literal("on"), z.literal("true"), z.literal("false"), z.undefined()]).transform((v) => v === "on" || v === "true");

/** "" → null; "$1,250.50" → 125050 cents */
const dollarsToCents = (max: number, message: string) => z.union([z.string(), z.number(), z.undefined()]).transform((v, ctx) => {
  if (v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || n < 0 || n > max) { ctx.addIssue({ code: z.ZodIssueCode.custom, message }); return z.NEVER; }
  return Math.round(n * 100);
});
const optionalCount = (max: number) => z.union([z.string(), z.number(), z.undefined(), z.null()]).transform((v, ctx) => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > max) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: `A whole number from 0 to ${max.toLocaleString()}, or empty for no limit.` }); return z.NEVER; }
  return n;
});

/** MuAPI model ids look like "kling-v2.1-standard-i2v". */
export const VIDEO_MODEL_PATTERN = /^[a-z0-9][a-z0-9._-]{1,79}$/;
export const VIDEO_MODELS = [
  { id: "kling-v2.1-standard-i2v", label: "Kling 2.1 Standard (image to video)" },
  { id: "kling-v2.1-pro-i2v", label: "Kling 2.1 Pro (image to video)" },
  { id: "seedance-lite-i2v", label: "Seedance Lite (image to video)" },
  { id: "wan2.1-image-to-video", label: "Wan 2.1 (image to video)" },
] as const;

/** The Super Admin's AI switches, ceilings and defaults (Admin → AI control panel). */
export const aiControlsSchema = z.object({
  ai_enabled: checkbox,
  ai_depth_motion_enabled: checkbox,
  ai_voiceover_enabled: checkbox,
  ai_captions_enabled: checkbox,
  video_ai_model: z.string().trim().regex(VIDEO_MODEL_PATTERN, "Use the provider's model id, for example kling-v2.1-standard-i2v."),
  video_ai_clip_cost_dollars: dollarsToCents(100, "Enter the price of one clip in dollars (up to $100)."),
  monthly_ai_budget_dollars: dollarsToCents(10_000_000, "Enter a dollar amount, or leave empty for no monthly ceiling."),
  daily_ai_budget_dollars: dollarsToCents(1_000_000, "Enter a dollar amount, or leave empty for no daily ceiling."),
  ai_budget_alert_percent: z.coerce.number({ invalid_type_error: "Enter a percentage." }).int("A whole number.").min(10, "At least 10%.").max(100, "At most 100%."),
  default_max_ai_generations_per_month: optionalCount(100_000),
}).superRefine((v, ctx) => {
  if (v.monthly_ai_budget_dollars != null && v.daily_ai_budget_dollars != null && v.daily_ai_budget_dollars > v.monthly_ai_budget_dollars) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["daily_ai_budget_dollars"], message: "The daily ceiling can't be higher than the monthly one." });
  }
});
export type AiControls = z.output<typeof aiControlsSchema>;

export const PROVIDER_KEYS = {
  muapi: { secret: "muapi_api_key", label: "MuAPI (generative AI video)", pattern: /^[A-Za-z0-9_\-.]{20,200}$/, hint: "The API key from your MuAPI dashboard." },
} as const;
export type ProviderKeyId = keyof typeof PROVIDER_KEYS;
export function isProviderKeyId(v: unknown): v is ProviderKeyId { return typeof v === "string" && v in PROVIDER_KEYS; }

/** Only the last four characters of a saved secret are ever shown. */
export function maskSecret(last4: string | null | undefined): string {
  return last4 ? `•••• •••• ${last4}` : "Not set";
}

/** Quick changes from the people table. */
export const quickUserSchema = z.object({
  role: z.enum(ROLES).refine((r) => r !== "super_admin", "That role can't be given out.").optional(),
  can_download: z.boolean().optional(),
  can_use_ai: z.boolean().optional(),
  max_videos_per_month: optionalCount(10_000).optional(),
  max_ai_generations_per_month: optionalCount(100_000).optional(),
}).strict();

export const LIBRARY_PAGE_SIZE = 30;
export const librarySearchSchema = z.object({
  q: z.string().trim().max(120).optional().transform((v) => v || undefined),
  owner: z.string().uuid().optional().catch(undefined),
  template: z.string().uuid().optional().catch(undefined),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
  show: z.enum(["active", "archived", "all"]).catch("active").default("active"),
  page: z.coerce.number().int().min(1).max(1000).catch(1).default(1),
});
export type LibrarySearch = z.output<typeof librarySearchSchema>;

/** Characters that change a PostgREST filter: never let a search string build one. */
export function safeSearch(q: string): string {
  return q.replace(/[%_,()*\\:."']/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
}

export function formatBytes(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  if (v < 1024) return `${v} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let x = v / 1024, i = 0;
  while (x >= 1024 && i < units.length - 1) { x /= 1024; i++; }
  return `${x >= 100 ? x.toFixed(0) : x.toFixed(1)} ${units[i]}`;
}

export function formatCents(c: number | null | undefined): string {
  const v = Number(c ?? 0) / 100;
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** 0–100, or null when there's no ceiling. */
export function percentOf(used: number, limit: number | null | undefined): number | null {
  if (limit == null) return null;
  if (limit <= 0) return 100;
  return Math.min(100, Math.round((used / limit) * 100));
}

export type HealthLevel = "ok" | "warn" | "down" | "off";
export function workerLevel(secondsSinceSeen: number): HealthLevel {
  if (secondsSinceSeen <= 90) return "ok";
  if (secondsSinceSeen <= 600) return "warn";
  return "down";
}

export function queueLevel(q: { queued: number; stuck: number; oldest_queued_seconds: number; failed_24h: number }, workersOnline: number): HealthLevel {
  if (q.stuck > 0 || (q.queued > 0 && workersOnline === 0)) return "down";
  if (q.oldest_queued_seconds > 600 || q.failed_24h > 0) return "warn";
  return "ok";
}

export const AI_KIND_LABELS: Record<string, string> = {
  video_clip: "Generative AI clip", depth_clip: "AI depth clip", director: "AI Director", voiceover: "AI narration", transcription: "Automatic captions",
};

const ACTIVITY: Record<string, string> = {
  "video_projects.insert": "Created a video", "video_projects.delete": "Deleted a video", "listings.insert": "Added a listing",
  "render.succeeded": "Rendered a video", "render.failed": "A render failed", "director.started": "Used the AI Director",
  "project.assigned": "Assigned a project", "project.unassigned": "Removed a project assignment", "project.reassigned": "Reassigned a video",
  "project.archived": "Archived a video", "project.unarchived": "Restored a video", "project.deleted": "Deleted a video",
  "project.access_changed": "Changed who can open a video", "user.created": "Added a person", "user.updated": "Changed a person's settings",
  "user.suspended": "Suspended a person", "user.activated": "Activated a person", "user.deactivated": "Deactivated a person",
  "settings.updated": "Changed company settings", "ai.controls_updated": "Changed AI controls", "provider.key_set": "Saved a provider key",
  "provider.key_removed": "Removed a provider key", "narration.upload": "Uploaded narration", "music.upload": "Uploaded music",
};
export function activityLabel(action: string | null | undefined): string {
  if (!action) return "No activity yet";
  return ACTIVITY[action] ?? action.replace(/[._]/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}
