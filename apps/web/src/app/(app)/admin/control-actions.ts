"use server";
/*
 * Admin control center actions. Each one checks the person's role here (for a
 * clear message) and the database checks it again, so a request crafted outside
 * the app gets the same answer.
 */
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authorizeAction, type ActionResult } from "@/lib/auth/session";
import { encryptSecret, secretsConfigured } from "@/lib/secrets";
import { isUuid } from "@/lib/storage";
import { fieldErrors, formDataToObject } from "@/lib/validation";
import { PROVIDER_KEYS, aiControlsSchema, isProviderKeyId, quickUserSchema } from "@/lib/admin/control";
import type { Json } from "@/lib/database.types";
import { setUserStatus } from "./actions";

/** Messages our database functions raise are written for people; anything else gets a plain fallback. */
function friendly(error: { message?: string } | null, fallback: string): string {
  const msg = error?.message ?? "";
  return /^(Only|You cannot|The Super Admin|User not found|Video not found|This account|This person|Type the video|Unknown)/.test(msg) ? msg : fallback;
}

/* ── People ──────────────────────────────────────────────────────────────── */

/** Change one thing about a person from the people table (role, downloads, AI, limits). */
export async function quickUpdateUser(userId: string, patch: unknown): Promise<ActionResult> {
  const auth = await authorizeAction("users.manage");
  if (!auth.ok) return auth.result;
  if (!isUuid(userId)) return { ok: false, message: "User not found." };
  const parsed = quickUserSchema.safeParse(patch);
  if (!parsed.success) return { ok: false, message: Object.values(fieldErrors(parsed.error))[0] ?? "That change wasn't valid." };
  const supabase = await createClient();
  const { data: u } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (!u) return { ok: false, message: "User not found." };
  const p = parsed.data;
  const { error } = await supabase.rpc("admin_update_user", {
    p_user_id: u.id, p_first_name: u.first_name, p_last_name: u.last_name, p_job_title: u.job_title,
    p_role: p.role ?? u.role, p_can_download: p.can_download ?? u.can_download, p_can_use_ai: p.can_use_ai ?? u.can_use_ai,
    p_max_videos: p.max_videos_per_month !== undefined ? p.max_videos_per_month : u.max_videos_per_month,
    p_max_ai: p.max_ai_generations_per_month !== undefined ? p.max_ai_generations_per_month : u.max_ai_generations_per_month,
  });
  if (error) return { ok: false, message: friendly(error, "That change isn't allowed.") };
  revalidatePath("/admin/users");
  revalidatePath("/admin/ai");
  return { ok: true, message: "Saved." };
}

/** Suspend or re-activate from the people table (the database blocks access; sign-in is blocked too). */
export async function quickSetStatus(userId: string, status: "active" | "suspended"): Promise<ActionResult> {
  if (status !== "active" && status !== "suspended") return { ok: false, message: "That change wasn't valid." };
  const fd = new FormData();
  fd.set("user_id", userId); fd.set("status", status);
  return setUserStatus(null, fd);
}

/* ── AI control panel (Super Admin) ─────────────────────────────────────── */

export async function saveAiControls(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("settings.manage");
  if (!auth.ok) return auth.result;
  const parsed = aiControlsSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return { ok: false, message: "Please check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  const d = parsed.data;
  const supabase = await createClient();
  const { data } = await supabase.from("organization_settings").update({
    ai_enabled: d.ai_enabled, ai_depth_motion_enabled: d.ai_depth_motion_enabled, ai_voiceover_enabled: d.ai_voiceover_enabled,
    ai_captions_enabled: d.ai_captions_enabled, video_ai_model: d.video_ai_model, video_ai_clip_cost_cents: d.video_ai_clip_cost_dollars ?? 0,
    monthly_ai_budget_cents: d.monthly_ai_budget_dollars, daily_ai_budget_cents: d.daily_ai_budget_dollars,
    ai_budget_alert_percent: d.ai_budget_alert_percent, default_max_ai_generations_per_month: d.default_max_ai_generations_per_month,
    updated_by: auth.ctx.userId,
  }).eq("organization_id", auth.ctx.organization.id).select("organization_id");
  if (!data?.length) return { ok: false, message: "Only the Super Admin can change AI controls." };
  await supabase.rpc("record_admin_action", { p_action: "ai.controls_updated", p_meta: d as unknown as Json });
  revalidatePath("/admin/ai");
  revalidatePath("/admin");
  return { ok: true, message: "AI controls saved. They apply to new AI requests right away." };
}

/**
 * Saves a provider key encrypted with the server's LVS_SECRETS_KEY. It's never shown again —
 * only its last 4 characters — and it can only be replaced or removed.
 */
export async function saveProviderKey(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("settings.manage");
  if (!auth.ok) return auth.result;
  const provider = formData.get("provider");
  if (!isProviderKeyId(provider)) return { ok: false, message: "Unknown provider." };
  const spec = PROVIDER_KEYS[provider];
  const key = String(formData.get("api_key") ?? "").trim();
  if (!spec.pattern.test(key)) return { ok: false, message: "That doesn't look like a complete API key.", fieldErrors: { api_key: "Paste the full key." } };
  if (!secretsConfigured()) return { ok: false, message: "The server can't store secrets yet: set LVS_SECRETS_KEY (32 random bytes, base64) on the web server and the AI worker." };
  // the database confirms the caller is the Super Admin (and logs it) before anything is stored
  const supabase = await createClient();
  const { error: denied } = await supabase.rpc("record_admin_action", { p_action: "provider.key_set", p_meta: { provider, last4: key.slice(-4) } });
  if (denied) return { ok: false, message: "Only the Super Admin can save provider keys." };
  const { error } = await createAdminClient().from("organization_secrets").upsert({
    organization_id: auth.ctx.organization.id, name: spec.secret, ciphertext: encryptSecret(key), last4: key.slice(-4),
    updated_by: auth.ctx.userId, updated_at: new Date().toISOString(),
  });
  if (error) return { ok: false, message: "The key couldn't be saved. Please try again." };
  revalidatePath("/admin/ai");
  return { ok: true, message: `${spec.label} key saved (ends in ${key.slice(-4)}).` };
}

export async function removeProviderKey(provider: string): Promise<ActionResult> {
  const auth = await authorizeAction("settings.manage");
  if (!auth.ok) return auth.result;
  if (!isProviderKeyId(provider)) return { ok: false, message: "Unknown provider." };
  const supabase = await createClient();
  const { error: denied } = await supabase.rpc("record_admin_action", { p_action: "provider.key_removed", p_meta: { provider } });
  if (denied) return { ok: false, message: "Only the Super Admin can remove provider keys." };
  await createAdminClient().from("organization_secrets").delete().eq("organization_id", auth.ctx.organization.id).eq("name", PROVIDER_KEYS[provider].secret);
  revalidatePath("/admin/ai");
  return { ok: true, message: "Key removed. New generative AI clips will stop until a key is saved again." };
}

/* ── Company video library ──────────────────────────────────────────────── */

function revalidateLibrary(id?: string) {
  revalidatePath("/admin/library");
  revalidatePath("/admin");
  revalidatePath("/videos");
  if (id) revalidatePath(`/videos/${id}`);
}

export async function setVideoArchived(projectId: string, archived: boolean): Promise<ActionResult> {
  const auth = await authorizeAction("projects.all");
  if (!auth.ok) return auth.result;
  if (!isUuid(projectId)) return { ok: false, message: "Video not found." };
  const { error } = await (await createClient()).rpc("admin_archive_project", { p_project: projectId, p_archived: archived });
  if (error) return { ok: false, message: friendly(error, "That video couldn't be changed.") };
  revalidateLibrary(projectId);
  return { ok: true, message: archived ? "Video archived. It's read-only and hidden from everyday lists." : "Video restored." };
}

export async function reassignVideo(projectId: string, newOwner: string): Promise<ActionResult> {
  const auth = await authorizeAction("projects.all");
  if (!auth.ok) return auth.result;
  if (!isUuid(projectId) || !isUuid(newOwner)) return { ok: false, message: "Choose a person." };
  const { error } = await (await createClient()).rpc("admin_reassign_project", { p_project: projectId, p_new_owner: newOwner });
  if (error) return { ok: false, message: friendly(error, "That video couldn't be reassigned.") };
  revalidateLibrary(projectId);
  return { ok: true, message: "Video reassigned." };
}

export async function setVideoAccess(projectId: string, restricted: boolean, locked: boolean): Promise<ActionResult> {
  const auth = await authorizeAction("projects.assign");
  if (!auth.ok) return auth.result;
  if (!isUuid(projectId)) return { ok: false, message: "Video not found." };
  const { error } = await (await createClient()).rpc("admin_set_project_access", { p_project: projectId, p_restricted: restricted, p_locked: locked });
  if (error) return { ok: false, message: friendly(error, "That change isn't allowed.") };
  revalidateLibrary(projectId);
  return { ok: true, message: "Access updated." };
}

/** Deletes a video for good: the title must be typed back. Its stored files are removed too. */
export async function deleteVideo(projectId: string, confirmTitle: string): Promise<ActionResult> {
  const auth = await authorizeAction("projects.all");
  if (!auth.ok) return auth.result;
  if (!isUuid(projectId)) return { ok: false, message: "Video not found." };
  const { data, error } = await (await createClient()).rpc("admin_delete_project", { p_project: projectId, p_confirm_title: String(confirmTitle ?? "").slice(0, 200) });
  if (error) return { ok: false, message: friendly(error, "That video couldn't be deleted.") };
  const files = (Array.isArray(data) ? data : []) as { bucket?: string; path?: string }[];
  const byBucket = new Map<string, string[]>();
  const org = auth.ctx.organization.id;
  for (const f of files) {
    // only this company's own folder, whatever the database returned
    if (f.bucket && f.path && f.path.startsWith(`${org}/`) && !f.path.includes("..")) byBucket.set(f.bucket, [...(byBucket.get(f.bucket) ?? []), f.path]);
  }
  const storage = createAdminClient().storage;
  let failed = 0;
  for (const [bucket, paths] of byBucket) {
    const { error: e } = await storage.from(bucket).remove(paths);
    if (e) failed += paths.length;
  }
  revalidateLibrary();
  return failed
    ? { ok: true, message: `Video deleted. ${failed} stored file(s) couldn't be removed from storage — they're no longer reachable from the app.` }
    : { ok: true, message: "Video and its files deleted." };
}
