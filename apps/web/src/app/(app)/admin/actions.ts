"use server";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { isDirectorModel } from "@/lib/director/claude";
import { decryptSecret, encryptSecret, secretsConfigured } from "@/lib/secrets";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authorizeAction, type ActionResult } from "@/lib/auth/session";
import { assignableRoles } from "@/lib/auth/roles";
import { publicEnv } from "@/lib/env";
import {
  assignProjectSchema, brandKitSchema, createUserSchema, editUserSchema, fieldErrors, formDataToObject, orgSettingsSchema,
  unassignProjectSchema, userStatusSchema,
} from "@/lib/validation";
import { BUCKETS, cleanFileName, isBrandLogoPathFor, isUuid } from "@/lib/storage";
import { ensureBrandImage } from "@/lib/music";

/** Turns Supabase Auth sign-in off/on for an account (in addition to the database status). */
async function setAuthBan(userId: string, banned: boolean) {
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: banned ? "876000h" : "none" });
  return !error;
}

function friendly(error: { message?: string } | null, fallback: string): string {
  const msg = error?.message ?? "";
  // Messages raised by our database functions are written for people; anything else is generic.
  return /^(Only|You cannot|The Super Admin|User not found|User or project|This account|This person|First and last|Activate the|Unknown)/.test(msg)
    ? msg
    : fallback;
}

/**
 * Create User: Supabase Auth sends a secure invitation link (the person sets
 * their own password — no password is ever emailed), then the database function
 * create_user_profile() re-checks the administrator's rights and writes the audit entry.
 */
export async function createUser(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("users.manage");
  if (!auth.ok) return auth.result;
  const parsed = createUserSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return { ok: false, message: "Please check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  const input = parsed.data;
  if (!assignableRoles(auth.ctx.profile.role).includes(input.role)) {
    return { ok: false, message: "You can't give that role.", fieldErrors: { role: "Not allowed for your role." } };
  }

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.inviteUserByEmail(input.email, {
    redirectTo: `${publicEnv().NEXT_PUBLIC_SITE_URL}/auth/confirm?next=/account/password`,
    data: { first_name: input.first_name, last_name: input.last_name },
  });
  if (error || !data.user) {
    return { ok: false, message: "We couldn't invite that email. The person may already have an account.", fieldErrors: { email: "Already in use or not deliverable." } };
  }

  const { error: profileError } = await admin.rpc("create_user_profile", {
    p_actor: auth.ctx.userId,
    p_user_id: data.user.id,
    p_email: input.email,
    p_first_name: input.first_name,
    p_last_name: input.last_name,
    p_job_title: input.job_title,
    p_role: input.role,
    p_can_download: input.can_download,
    p_can_use_ai: input.can_use_ai,
    p_max_videos: input.max_videos_per_month,
    p_max_ai: input.max_ai_generations_per_month,
  });
  if (profileError) {
    await admin.auth.admin.deleteUser(data.user.id);
    return { ok: false, message: friendly(profileError, "We couldn't finish creating the account. Please try again.") };
  }

  revalidatePath("/admin/users");
  redirect(`/admin/users/${data.user.id}?created=1`);
}

/** Edit User / Assign Role / Change Permissions / usage limits — one database call, audited per change. */
export async function updateUser(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("users.manage");
  if (!auth.ok) return auth.result;
  const parsed = editUserSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return { ok: false, message: "Please check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  const input = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_update_user", {
    p_user_id: input.user_id,
    p_first_name: input.first_name,
    p_last_name: input.last_name,
    p_job_title: input.job_title,
    p_role: input.role,
    p_can_download: input.can_download,
    p_can_use_ai: input.can_use_ai,
    p_max_videos: input.max_videos_per_month,
    p_max_ai: input.max_ai_generations_per_month,
  });
  if (error) return { ok: false, message: friendly(error, "That change isn't allowed.") };
  revalidatePath(`/admin/users/${input.user_id}`);
  revalidatePath("/admin/users");
  return { ok: true, message: "Changes saved." };
}

/** Activate / Suspend / Deactivate. The database blocks data access; Supabase Auth also blocks sign-in. */
export async function setUserStatus(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("users.manage");
  if (!auth.ok) return auth.result;
  const parsed = userStatusSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return { ok: false, message: "That change wasn't valid." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_user_status", { p_user_id: parsed.data.user_id, p_status: parsed.data.status });
  if (error) return { ok: false, message: friendly(error, "That change isn't allowed.") };

  const signInBlocked = await setAuthBan(parsed.data.user_id, parsed.data.status !== "active");
  revalidatePath(`/admin/users/${parsed.data.user_id}`);
  revalidatePath("/admin/users");
  const done = { active: "Account activated.", suspended: "Account suspended.", deactivated: "Account deactivated." }[parsed.data.status];
  return signInBlocked
    ? { ok: true, message: done }
    : { ok: true, message: `${done} (Access to data changed, but the sign-in setting could not be updated — try again.)` };
}

/** Reset Access: emails a fresh, single-use link to set a new password. No password is ever sent. */
export async function resetUserAccess(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("users.manage");
  if (!auth.ok) return auth.result;
  const userId = String(formData.get("user_id") ?? "");
  if (!isUuid(userId)) return { ok: false, message: "User not found." };
  const supabase = await createClient();
  const { data: target } = await supabase.from("profiles").select("email").eq("id", userId).maybeSingle();
  if (!target) return { ok: false, message: "User not found." };
  const { error } = await supabase.rpc("admin_record_access_reset", { p_user_id: userId });
  if (error) return { ok: false, message: friendly(error, "That isn't allowed.") };

  const { error: mailError } = await supabase.auth.resetPasswordForEmail(target.email, {
    redirectTo: `${publicEnv().NEXT_PUBLIC_SITE_URL}/auth/confirm?next=/account/password`,
  });
  if (mailError) return { ok: false, message: "The reset email couldn't be sent. Please try again in a minute." };
  return { ok: true, message: `A secure link to set a new password was sent to ${target.email}.` };
}

export async function assignProject(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("projects.assign");
  if (!auth.ok) return auth.result;
  const parsed = assignProjectSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return { ok: false, message: "Please choose a project.", fieldErrors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_assign_project", {
    p_project_id: parsed.data.project_id, p_user_id: parsed.data.user_id, p_access: parsed.data.access,
  });
  if (error) return { ok: false, message: friendly(error, "That project couldn't be assigned.") };
  revalidatePath(`/admin/users/${parsed.data.user_id}`);
  revalidatePath("/admin/projects");
  return { ok: true, message: "Project assigned." };
}

export async function unassignProject(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("projects.assign");
  if (!auth.ok) return auth.result;
  const parsed = unassignProjectSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return { ok: false, message: "That change wasn't valid." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_unassign_project", { p_project_id: parsed.data.project_id, p_user_id: parsed.data.user_id });
  if (error) return { ok: false, message: friendly(error, "That project couldn't be removed.") };
  revalidatePath(`/admin/users/${parsed.data.user_id}`);
  revalidatePath("/admin/projects");
  return { ok: true, message: "Project removed from this person." };
}

/** Super Admin: AI on/off, budget, default limits. */
export async function saveOrgSettings(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("settings.manage");
  if (!auth.ok) return auth.result;
  const parsed = orgSettingsSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return { ok: false, message: "Please check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  const { data, error } = await supabase.from("organization_settings").update({
    ai_enabled: parsed.data.ai_enabled,
    viewers_can_download_by_default: parsed.data.viewers_can_download_by_default,
    monthly_ai_budget_cents: parsed.data.monthly_ai_budget_dollars,
    default_max_videos_per_month: parsed.data.default_max_videos_per_month,
    default_max_ai_generations_per_month: parsed.data.default_max_ai_generations_per_month,
    max_batch_size: parsed.data.max_batch_size,
    concurrent_render_limit: parsed.data.concurrent_render_limit,
    daily_video_limit: parsed.data.daily_video_limit,
    updated_by: auth.ctx.userId,
  }).eq("organization_id", auth.ctx.organization.id).select("organization_id");
  if (error || !data || data.length === 0) return { ok: false, message: "Only the Super Admin can change these settings." };
  await createAdminClient().from("audit_log").insert({
    organization_id: auth.ctx.organization.id, actor_id: auth.ctx.userId, action: "settings.updated",
    target_type: "organization", target_id: auth.ctx.organization.id, metadata: parsed.data,
  });
  revalidatePath("/admin/settings");
  return { ok: true, message: "Settings saved." };
}

export async function saveBrandKit(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("branding.manage");
  if (!auth.ok) return auth.result;
  const parsed = brandKitSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return { ok: false, message: "Please check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  const kit = auth.ctx.brandKit;
  const { error } = kit
    ? await supabase.from("brand_kits").update(parsed.data).eq("id", kit.id)
    : await supabase.from("brand_kits").insert({
        ...parsed.data, organization_id: auth.ctx.organization.id, name: "Company brand", is_default: true, created_by: auth.ctx.userId,
      });
  if (error) return { ok: false, message: "We couldn't save the branding. Please try again." };
  revalidatePath("/", "layout");
  return { ok: true, message: "Branding saved. New videos will use it." };
}

/** Called after the browser uploaded a logo to private storage (company logo or brokerage logo; Super Admin). */
export async function setBrandLogo(path: string, which: "logo" | "brokerage" = "logo"): Promise<ActionResult> {
  const auth = await authorizeAction("branding.manage");
  if (!auth.ok) return auth.result;
  const kit = auth.ctx.brandKit;
  if (!kit) return { ok: false, message: "Save the brand kit form first." };
  if (!isBrandLogoPathFor(path, auth.ctx.organization.id)) return { ok: false, message: "Upload location was not valid." };

  const supabase = await createClient();
  const folder = `${auth.ctx.organization.id}/brand`;
  const { data: objects } = await supabase.storage.from(BUCKETS.brandAssets).list(folder, { limit: 1000 });
  if (!(objects ?? []).some((o) => `${folder}/${o.name}` === path)) return { ok: false, message: "The logo didn't finish uploading." };

  const column = which === "brokerage" ? "brokerage_logo_path" : "logo_path";
  const old = which === "brokerage" ? kit.brokerage_logo_path : kit.logo_path;
  const { error } = await supabase.from("brand_kits").update(column === "logo_path" ? { logo_path: path } : { brokerage_logo_path: path }).eq("id", kit.id);
  if (error) return { ok: false, message: "We couldn't save the logo." };
  // register it with its real size, so videos can use it right away
  await ensureBrandImage(auth.ctx.organization.id, path, "logo");
  // the old file stays if earlier videos use it
  if (old && old !== path) {
    const { data: used } = await supabase.from("media_assets").select("id").eq("bucket", BUCKETS.brandAssets).eq("storage_path", old).limit(1);
    if (!used?.length) await supabase.storage.from(BUCKETS.brandAssets).remove([old]);
  }
  revalidatePath("/", "layout");
  return { ok: true, message: which === "brokerage" ? "Brokerage logo updated." : "Logo updated." };
}

/** Administrators: branding requirements applied to every video (checked again in the database function). */
export async function saveBrandRules(input: { requireLogo: boolean; requireDisclosure: boolean; requireAgentCard: boolean; lockFonts: boolean; lockColors: boolean }): Promise<ActionResult> {
  const auth = await authorizeAction("templates.manage");
  if (!auth.ok) return auth.result;
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_brand_rules", {
    p_require_logo: !!input.requireLogo, p_require_disclosure: !!input.requireDisclosure, p_require_agent_card: !!input.requireAgentCard,
    p_lock_fonts: !!input.lockFonts, p_lock_colors: !!input.lockColors,
  });
  if (error) return { ok: false, message: friendly(error, "We couldn't save the branding rules.") };
  revalidatePath("/admin/templates");
  return { ok: true, message: "Branding rules saved. Every new or re-rendered video follows them." };
}

/** Super Admin: allow or stop one person from using Generate 6 Videos (checked again in the database). */
export async function setBatchPermission(userId: string, allowed: boolean): Promise<ActionResult> {
  const auth = await authorizeAction("settings.manage");
  if (!auth.ok) return auth.result;
  if (!isUuid(userId)) return { ok: false, message: "Person not found." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_batch_permission", { p_user_id: userId, p_allowed: allowed });
  if (error) return { ok: false, message: "Only the Super Admin can change this." };
  revalidatePath(`/admin/users/${userId}`);
  return { ok: true };
}

/* ── AI Director (Claude) — Super Admin only ─────────────────────────────── */

const claudeSettingsSchema = z.object({
  claude_enabled: z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean()),
  claude_model: z.string().refine(isDirectorModel, "Choose a model."),
  claude_monthly_run_limit: z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().int().min(0).max(100000).nullable()),
  claude_daily_runs_per_user: z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().int().min(0).max(1000).nullable()),
});

export async function saveClaudeSettings(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("settings.manage");
  if (!auth.ok) return auth.result;
  const parsed = claudeSettingsSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return { ok: false, message: "Please check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  const { data } = await supabase.from("organization_settings").update({ ...parsed.data, updated_by: auth.ctx.userId })
    .eq("organization_id", auth.ctx.organization.id).select("organization_id");
  if (!data?.length) return { ok: false, message: "Only the Super Admin can change these settings." };
  await createAdminClient().from("audit_log").insert({
    organization_id: auth.ctx.organization.id, actor_id: auth.ctx.userId, action: "claude.settings_updated",
    target_type: "organization", target_id: auth.ctx.organization.id, metadata: parsed.data,
  });
  revalidatePath("/admin/settings");
  return { ok: true, message: "AI Director settings saved." };
}

/** Stores the Claude API key encrypted (server key LVS_SECRETS_KEY). It can't be read back — only replaced or removed. */
export async function saveClaudeKey(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("settings.manage");
  if (!auth.ok) return auth.result;
  const key = String(formData.get("api_key") ?? "").trim();
  if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key)) return { ok: false, message: "That doesn't look like a Claude API key (it starts with sk-ant-).", fieldErrors: { api_key: "Paste the full key." } };
  if (!secretsConfigured()) return { ok: false, message: "The server can't store secrets yet: set LVS_SECRETS_KEY (32 random bytes, base64) on the server, or set ANTHROPIC_API_KEY there instead." };
  const admin = createAdminClient();
  const { error } = await admin.from("organization_secrets").upsert({
    organization_id: auth.ctx.organization.id, name: "anthropic_api_key", ciphertext: encryptSecret(key), last4: key.slice(-4),
    updated_by: auth.ctx.userId, updated_at: new Date().toISOString(),
  });
  if (error) return { ok: false, message: "The key couldn't be saved. Please try again." };
  await admin.from("audit_log").insert({ organization_id: auth.ctx.organization.id, actor_id: auth.ctx.userId, action: "claude.key_set", target_type: "organization", target_id: auth.ctx.organization.id, metadata: { last4: key.slice(-4) } });
  revalidatePath("/admin/settings");
  return { ok: true, message: `Claude API key saved (ends in ${key.slice(-4)}).` };
}

export async function removeClaudeKey(): Promise<ActionResult> {
  const auth = await authorizeAction("settings.manage");
  if (!auth.ok) return auth.result;
  const admin = createAdminClient();
  await admin.from("organization_secrets").delete().eq("organization_id", auth.ctx.organization.id).eq("name", "anthropic_api_key");
  await admin.from("audit_log").insert({ organization_id: auth.ctx.organization.id, actor_id: auth.ctx.userId, action: "claude.key_removed", target_type: "organization", target_id: auth.ctx.organization.id, metadata: {} });
  revalidatePath("/admin/settings");
  return { ok: true, message: "Claude API key removed." };
}

/** Checks the key and model with a free Models API call (no tokens used). */
export async function testClaudeConnection(): Promise<ActionResult> {
  const auth = await authorizeAction("settings.manage");
  if (!auth.ok) return auth.result;
  const supabase = await createClient();
  const { data: s } = await supabase.from("organization_settings").select("claude_model").eq("organization_id", auth.ctx.organization.id).maybeSingle();
  const { data: secret } = await createAdminClient().from("organization_secrets").select("ciphertext").eq("organization_id", auth.ctx.organization.id).eq("name", "anthropic_api_key").maybeSingle();
  const apiKey = secret?.ciphertext ? decryptSecret(secret.ciphertext) : process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, message: "No Claude API key is set." };
  try {
    const model = await new Anthropic({ apiKey, maxRetries: 0, timeout: 20_000 }).models.retrieve(s?.claude_model ?? "claude-opus-5-5");
    return { ok: true, message: `Connected. ${model.display_name} is available to this key.` };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return { ok: false, message: "Claude rejected this key." };
    if (e instanceof Anthropic.NotFoundError) return { ok: false, message: "This key can't use the selected model." };
    if (e instanceof Anthropic.APIError) return { ok: false, message: `Claude answered with an error (${e.status ?? "network"}).` };
    return { ok: false, message: "Couldn't reach Claude from the server." };
  }
}

/* ── Music library (admins) ──────────────────────────────────────────────── */

const MUSIC_LICENSES = ["royalty_free", "licensed", "company_owned"] as const;
const addTrackSchema = z.object({
  path: z.string().max(300),
  file_name: z.string().min(1).max(200),
  mime_type: z.enum(["audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/aac", "audio/wav", "audio/x-wav"]),
  size_bytes: z.number().int().positive().max(25 * 1024 * 1024),
  duration_seconds: z.number().positive().max(3600).nullable(),
  title: z.string().trim().min(1, "Give the track a title.").max(120),
  artist: z.string().trim().max(120).optional(),
  mood: z.enum(["elegant", "calm", "upbeat", "warm", "inspiring"]),
  license_type: z.enum(MUSIC_LICENSES),
  license_details: z.string().trim().min(3, "Describe the licence (who granted it, for what use).").max(1000),
  license_url: z.string().trim().url("Use a full link, or leave it empty.").max(500).optional().or(z.literal("")),
  verified: z.boolean(),
});

/** Registers an uploaded track (the browser uploaded the file to the company's music folder). */
export async function addMusicTrack(input: unknown): Promise<ActionResult> {
  const auth = await authorizeAction("admin.access");
  if (!auth.ok) return auth.result;
  const parsed = addTrackSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Please check the track details.", fieldErrors: fieldErrors(parsed.error) };
  const d = parsed.data;
  const org = auth.ctx.organization.id;
  if (!new RegExp(`^${org}/music/[0-9a-f-]{36}\\.(mp3|m4a|aac|wav)$`).test(d.path)) return { ok: false, message: "That upload isn't in the music library folder." };
  const supabase = await createClient();
  const { data: asset, error } = await supabase.from("media_assets").insert({
    organization_id: org, uploaded_by: auth.ctx.userId, kind: "audio", bucket: BUCKETS.musicLibrary, storage_path: d.path,
    file_name: cleanFileName(d.file_name), mime_type: d.mime_type, size_bytes: d.size_bytes, duration_seconds: d.duration_seconds,
  }).select("id").single();
  if (error || !asset) return { ok: false, message: "Only administrators can add music." };
  const now = new Date().toISOString();
  const { error: te } = await supabase.from("music_tracks").insert({
    organization_id: org, asset_id: asset.id, title: d.title, artist: d.artist || null, mood: d.mood, license_type: d.license_type,
    license_details: d.license_details, license_url: d.license_url || null,
    commercial_use_verified: d.verified, verified_by: d.verified ? auth.ctx.userId : null, verified_at: d.verified ? now : null,
  });
  if (te) { await supabase.from("media_assets").delete().eq("id", asset.id); return { ok: false, message: "The track couldn't be saved." }; }
  await createAdminClient().from("audit_log").insert({ organization_id: org, actor_id: auth.ctx.userId, action: "music.added", target_type: "media_asset", target_id: asset.id, metadata: { title: d.title, license_type: d.license_type, verified: d.verified } });
  revalidatePath("/admin/music");
  return { ok: true, message: `“${d.title}” added${d.verified ? " and cleared for use" : " — it won't be offered until its licence is verified"}.` };
}

export async function setMusicVerified(assetId: string, verified: boolean): Promise<ActionResult> {
  const auth = await authorizeAction("admin.access");
  if (!auth.ok) return auth.result;
  if (!isUuid(assetId)) return { ok: false, message: "Track not found." };
  const supabase = await createClient();
  const { data } = await supabase.from("music_tracks").update({
    commercial_use_verified: verified, verified_by: verified ? auth.ctx.userId : null, verified_at: verified ? new Date().toISOString() : null,
  }).eq("asset_id", assetId).select("title");
  if (!data?.length) return { ok: false, message: "Built-in tracks can't be changed; only administrators can verify." };
  await createAdminClient().from("audit_log").insert({ organization_id: auth.ctx.organization.id, actor_id: auth.ctx.userId, action: verified ? "music.verified" : "music.unverified", target_type: "media_asset", target_id: assetId, metadata: {} });
  revalidatePath("/admin/music");
  return { ok: true };
}

export async function deleteMusicTrack(assetId: string): Promise<ActionResult> {
  const auth = await authorizeAction("admin.access");
  if (!auth.ok) return auth.result;
  if (!isUuid(assetId)) return { ok: false, message: "Track not found." };
  const supabase = await createClient();
  const { data } = await supabase.from("media_assets").delete().eq("id", assetId).eq("bucket", BUCKETS.musicLibrary).select("storage_path");
  if (!data?.length) return { ok: false, message: "This track can't be removed." };
  await supabase.storage.from(BUCKETS.musicLibrary).remove([data[0]!.storage_path]);
  revalidatePath("/admin/music");
  return { ok: true };
}
