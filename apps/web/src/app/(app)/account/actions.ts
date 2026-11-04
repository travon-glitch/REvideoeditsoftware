"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext, type ActionResult } from "@/lib/auth/session";
import { needsCurrentPassword, passwordIsCorrect } from "@/lib/auth/reauth";
import { allow } from "@/lib/rate-limit";
import { fieldErrors, formDataToObject, newPasswordSchema, profileSchema } from "@/lib/validation";

export async function saveProfile(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, message: "Please sign in again." };
  const parsed = profileSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return { ok: false, message: "Please check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.from("profiles")
    .update({ first_name: parsed.data.first_name, last_name: parsed.data.last_name }).eq("id", ctx.userId);
  if (error) return { ok: false, message: "We couldn't save your profile." };
  revalidatePath("/", "layout");
  return { ok: true, message: "Profile saved." };
}

/** Sets a new password (after an invitation or reset link, or from the account page). */
export async function setPassword(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Your link has expired. Please request a new one." };
  const parsed = newPasswordSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return { ok: false, message: "Please check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  if (await needsCurrentPassword(supabase)) {
    const current = String(formData.get("current_password") ?? "");
    if (!current) return { ok: false, message: "Type your current password.", fieldErrors: { current_password: "Needed to change your password." } };
    if (!allow(`password:${user.id}`, 5, 15 * 60_000)) return { ok: false, message: "Too many tries. Wait 15 minutes and try again." };
    if (!user.email || !(await passwordIsCorrect(user.email, current))) {
      return { ok: false, message: "Your current password isn't right.", fieldErrors: { current_password: "Not right — try again." } };
    }
  }
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { ok: false, message: "We couldn't update your password. Try a different one." };
  // An invited person becomes "active" once they have chosen a password (audited in the database).
  await supabase.rpc("activate_self");
  redirect("/dashboard");
}
