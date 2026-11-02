import { z } from "zod";
import { normalizeSetupCode } from "@/lib/setup-code";
import { ROLES } from "@/lib/auth/roles";
import { PROPERTY_TYPES } from "@/lib/listings";

const trimmed = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) =>
  z.string().trim().max(max).optional().transform((v) => (v ? v : null));

/** "" → null, "450,000" / "$450000" → 450000 */
const optionalNumber = (opts: { min?: number; max?: number; int?: boolean } = {}) =>
  z
    .union([z.string(), z.number()])
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v === "") return null;
      const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
      if (!Number.isFinite(n)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Please enter a number." });
        return z.NEVER;
      }
      if (opts.int && !Number.isInteger(n)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Please enter a whole number." });
        return z.NEVER;
      }
      if (opts.min !== undefined && n < opts.min) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Must be at least ${opts.min}.` });
        return z.NEVER;
      }
      if (opts.max !== undefined && n > opts.max) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Must be at most ${opts.max}.` });
        return z.NEVER;
      }
      return n;
    });

export const emailSchema = z.string().trim().toLowerCase().email("Please enter a valid email address.").max(254);

/** Matches supabase/config.toml: 12+ chars with upper, lower and a digit. */
export const passwordSchema = z
  .string()
  .min(12, "Use at least 12 characters.")
  .max(128, "Use 128 characters or fewer.")
  .regex(/[a-z]/, "Add a lowercase letter.")
  .regex(/[A-Z]/, "Add an uppercase letter.")
  .regex(/[0-9]/, "Add a number.");

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Please enter your password.").max(128),
  next: z.string().optional(),
});

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const newPasswordSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((d) => d.password === d.confirm, { message: "The passwords do not match.", path: ["confirm"] });

export const setupSchema = z
  .object({
    code: z.string().transform((v, ctx) => {
      const n = normalizeSetupCode(v);
      if (!n) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "That setup code doesn't look right." });
        return z.NEVER;
      }
      return n;
    }),
    companyName: trimmed(120).min(2, "Please enter your company name."),
    fullName: trimmed(120).min(2, "Please enter your name."),
    email: emailSchema,
    password: passwordSchema,
    confirm: z.string(),
  })
  .refine((d) => d.password === d.confirm, { message: "The passwords do not match.", path: ["confirm"] });

export const LISTING_STATUSES = ["coming_soon", "for_sale", "open_house", "pending", "sold", "for_rent"] as const;
export const LISTING_STATUS_LABELS: Record<(typeof LISTING_STATUSES)[number], string> = {
  coming_soon: "Coming soon",
  for_sale: "For sale",
  open_house: "Open house",
  pending: "Pending",
  sold: "Sold",
  for_rent: "For rent",
};

/** Everything is optional so a draft can be saved at any moment; values that are present must be valid. */
export const listingDraftSchema = z.object({
  address_line: z.string().trim().max(200).optional().transform((v) => v ?? ""),
  city: optionalText(100),
  state: optionalText(60),
  postal_code: z.string().trim().max(20).optional().transform((v, ctx) => {
    if (!v) return null;
    if (!/^\d{5}(-\d{4})?$/.test(v)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Use a 5-digit ZIP, like 97403." });
      return z.NEVER;
    }
    return v;
  }),
  price: optionalNumber({ min: 0, max: 1_000_000_000 }),
  bedrooms: optionalNumber({ min: 0, max: 99 }),
  bathrooms: optionalNumber({ min: 0, max: 99 }),
  square_feet: optionalNumber({ min: 0, max: 10_000_000, int: true }),
  property_type: z.union([z.enum(PROPERTY_TYPES), z.literal("")]).optional().transform((v) => (v ? v : null)),
  description: optionalText(5000),
  mls_number: optionalText(40),
  status: z.enum(LISTING_STATUSES).optional().default("for_sale"),
  agent_name: optionalText(120),
  brokerage: optionalText(160),
  contact_phone: z.string().trim().max(40).optional().transform((v, ctx) => {
    if (!v) return null;
    if (!/^[+()\-.\s\d]{7,40}$/.test(v)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Use a phone number like 555-123-4567." });
      return z.NEVER;
    }
    return v;
  }),
  contact_email: z.string().trim().max(254).optional().transform((v, ctx) => {
    if (!v) return null;
    if (!z.string().email().safeParse(v).success) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Please enter a valid email address." });
      return z.NEVER;
    }
    return v.toLowerCase();
  }),
  open_house_date: z.string().optional().transform((v, ctx) => {
    if (!v) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(new Date(`${v}T12:00:00`).getTime())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Please pick a date." });
      return z.NEVER;
    }
    return v;
  }),
  open_house_start: z.string().optional().transform((v) => (v && /^\d{2}:\d{2}(:\d{2})?$/.test(v) ? v.slice(0, 5) : null)),
  open_house_end: z.string().optional().transform((v) => (v && /^\d{2}:\d{2}(:\d{2})?$/.test(v) ? v.slice(0, 5) : null)),
}).superRefine((d, ctx) => {
  if (d.open_house_start && d.open_house_end && d.open_house_end <= d.open_house_start) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "The end time must be after the start time.", path: ["open_house_end"] });
  }
});

/** The listing details Easy Mode step 3 can change (same rules as the listing form). */
export const EASY_DETAIL_FIELDS = ["address_line", "city", "state", "price", "agent_name", "brokerage", "contact_phone", "contact_email"] as const;
export const easyDetailsSchema = listingDraftSchema.innerType().pick({
  address_line: true, city: true, state: true, price: true, agent_name: true, brokerage: true, contact_phone: true, contact_email: true,
});
export type EasyDetailsInput = z.input<typeof easyDetailsSchema>;

/** Kept for code that still validates a complete listing. */
export const listingSchema = listingDraftSchema;
export type ListingInput = z.infer<typeof listingSchema>;

export const ASPECT_RATIOS = ["16:9", "9:16", "1:1"] as const;
export const ASPECT_RATIO_LABELS: Record<(typeof ASPECT_RATIOS)[number], string> = {
  "16:9": "Wide (YouTube, website)",
  "9:16": "Vertical (Reels, TikTok, Shorts)",
  "1:1": "Square (feed posts)",
};

export const createVideoSchema = z.object({
  listing_id: z.string().uuid("Please choose a listing."),
  template_id: z.string().uuid("Please choose a style."),
  title: trimmed(160).optional().transform((v) => v || null),
  aspect_ratios: z.array(z.enum(ASPECT_RATIOS)).min(1, "Pick at least one video shape.").max(3),
});

const hexColor = z.string().trim().regex(/^#[0-9A-Fa-f]{6}$/, "Use a color like #1D4ED8.");

export const brandKitSchema = z.object({
  company_name: optionalText(120),
  tagline: optionalText(160),
  primary_color: hexColor,
  secondary_color: hexColor,
  accent_color: hexColor,
  heading_font: trimmed(60).min(1),
  body_font: trimmed(60).min(1),
  outro_text: optionalText(280),
  disclaimer: optionalText(500),
});

/** "" → null (no limit); otherwise a whole number in range. */
const optionalLimit = (max: number) =>
  z.union([z.string(), z.number()]).optional().transform((v, ctx) => {
    if (v === undefined || v === "") return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > max) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Use a whole number from 0 to ${max}, or leave empty for no limit.` });
      return z.NEVER;
    }
    return n;
  });

const checkbox = z.union([z.literal("on"), z.literal("true"), z.literal("false"), z.undefined()]).transform((v) => v === "on" || v === "true");

const userFields = {
  first_name: trimmed(60).min(1, "Please enter a first name."),
  last_name: trimmed(60).min(1, "Please enter a last name."),
  job_title: optionalText(100),
  role: z.enum(ROLES).refine((r) => r !== "super_admin", "That role can't be given out."),
  can_download: checkbox,
  can_use_ai: checkbox,
  max_videos_per_month: optionalLimit(10_000),
  max_ai_generations_per_month: optionalLimit(100_000),
};

export const createUserSchema = z.object({ ...userFields, email: emailSchema });
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const editUserSchema = z.object({ ...userFields, user_id: z.string().uuid() });

export const userStatusSchema = z.object({
  user_id: z.string().uuid(),
  status: z.enum(["active", "suspended", "deactivated"]),
});

export const assignProjectSchema = z.object({
  user_id: z.string().uuid(),
  project_id: z.string().uuid("Please choose a project."),
  access: z.enum(["viewer", "editor"]),
});

export const unassignProjectSchema = z.object({ user_id: z.string().uuid(), project_id: z.string().uuid() });

export const orgSettingsSchema = z.object({
  ai_enabled: checkbox,
  viewers_can_download_by_default: checkbox,
  monthly_ai_budget_dollars: z.union([z.string(), z.number()]).optional().transform((v, ctx) => {
    if (v === undefined || v === "") return null;
    const n = Number(String(v).replace(/[$,\s]/g, ""));
    if (!Number.isFinite(n) || n < 0 || n > 10_000_000) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a dollar amount, or leave empty for no budget." });
      return z.NEVER;
    }
    return Math.round(n * 100);
  }),
  default_max_videos_per_month: optionalLimit(10_000),
  default_max_ai_generations_per_month: optionalLimit(100_000),
});

export const profileSchema = z.object({
  first_name: trimmed(60).min(1, "Please enter your first name."),
  last_name: trimmed(60).min(1, "Please enter your last name."),
});

export const uiModeSchema = z.enum(["easy", "advanced"]);

export const replacePhotoSchema = z.object({
  asset_id: z.string().uuid(),
  thumb_path: z.string().max(300).nullable().optional(),
  path: z.string().max(300),
  file_name: z.string().max(260),
  mime_type: z.string().max(100),
  size_bytes: z.number().int().nonnegative(),
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
});

export const reorderSchema = z.object({ listing_id: z.string().uuid(), asset_ids: z.array(z.string().uuid()).max(30) });

export const assignListingSchema = z.object({
  user_id: z.string().uuid(),
  listing_id: z.string().uuid("Please choose a listing."),
  access: z.enum(["viewer", "editor"]),
});

export const registerPhotosSchema = z.object({
  listing_id: z.string().uuid(),
  files: z
    .array(
      z.object({
        path: z.string().max(300),
        file_name: z.string().max(260),
        mime_type: z.string().max(100),
        size_bytes: z.number().int().nonnegative(),
        width: z.number().int().positive().nullable().optional(),
        height: z.number().int().positive().nullable().optional(),
        thumb_path: z.string().max(300).nullable().optional(),
      }),
    )
    .min(1)
    .max(30),
});

/** First error message per field, for showing under inputs. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

export function formDataToObject(fd: FormData, arrays: string[] = []): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const key of new Set(fd.keys())) {
    if (key.startsWith("$ACTION")) continue;
    const values = fd.getAll(key).filter((v): v is string => typeof v === "string");
    obj[key] = arrays.includes(key) ? values : values[0];
  }
  for (const key of arrays) if (!(key in obj)) obj[key] = [];
  return obj;
}
