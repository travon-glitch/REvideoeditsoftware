"use server";
import { createClient } from "@/lib/supabase/server";
import { publicEnv } from "@/lib/env";
import { fieldErrors, forgotPasswordSchema, formDataToObject } from "@/lib/validation";
import type { ActionResult } from "@/lib/auth/session";

export async function requestPasswordReset(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = forgotPasswordSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return { ok: false, message: "Please enter a valid email.", fieldErrors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${publicEnv().NEXT_PUBLIC_SITE_URL}/auth/confirm?next=/account/password`,
  });
  // Always the same answer, whether or not the account exists.
  return { ok: true, message: "If that email belongs to a team member, a reset link is on its way." };
}
