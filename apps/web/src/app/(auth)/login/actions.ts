"use server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fieldErrors, formDataToObject, loginSchema } from "@/lib/validation";
import { safeRedirectPath } from "@/lib/safe-redirect";
import type { ActionResult } from "@/lib/auth/session";

export async function signIn(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = loginSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) {
    return { ok: false, message: "Please check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error) {
    // Same message for unknown email and wrong password (no account enumeration).
    return { ok: false, message: "That email and password don't match our records." };
  }
  redirect(safeRedirectPath(parsed.data.next));
}
