"use server";
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
import { BUCKETS, isBrandLogoPathFor, isUuid } from "@/lib/storage";

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

/** Called after the browser uploaded a logo to private storage. */
export async function setBrandLogo(path: string): Promise<ActionResult> {
  const auth = await authorizeAction("branding.manage");
  if (!auth.ok) return auth.result;
  const kit = auth.ctx.brandKit;
  if (!kit) return { ok: false, message: "Save the branding form first." };
  if (!isBrandLogoPathFor(path, auth.ctx.organization.id)) return { ok: false, message: "Upload location was not valid." };

  const supabase = await createClient();
  const folder = `${auth.ctx.organization.id}/brand`;
  const { data: objects } = await supabase.storage.from(BUCKETS.brandAssets).list(folder, { limit: 1000 });
  if (!(objects ?? []).some((o) => `${folder}/${o.name}` === path)) return { ok: false, message: "The logo didn't finish uploading." };

  const { error } = await supabase.from("brand_kits").update({ logo_path: path }).eq("id", kit.id);
  if (error) return { ok: false, message: "We couldn't save the logo." };
  if (kit.logo_path && kit.logo_path !== path) await supabase.storage.from(BUCKETS.brandAssets).remove([kit.logo_path]);
  revalidatePath("/", "layout");
  return { ok: true, message: "Logo updated." };
}
