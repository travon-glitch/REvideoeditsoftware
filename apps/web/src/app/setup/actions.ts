"use server";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { hashSetupCode, slugify } from "@/lib/bootstrap";
import { fieldErrors, formDataToObject, setupSchema } from "@/lib/validation";
import type { ActionResult } from "@/lib/auth/session";

/*
 * One-time Super Admin setup. Order matters:
 *  1. setup must still be open and the one-time code valid (checked by hash);
 *  2. the auth account is created with the password the person typed;
 *  3. bootstrap_complete() atomically creates the company + Super Admin profile,
 *     burns the code and closes setup forever. If it fails, the new account is removed.
 */
export async function completeSetup(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = setupSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) {
    return { ok: false, message: "Please check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  }
  const input = parsed.data;
  const admin = createAdminClient();

  const { data: done, error: statusError } = await admin.rpc("bootstrap_is_complete");
  if (statusError) return { ok: false, message: "Couldn't reach the database. Please try again." };
  if (done) return { ok: false, message: "Setup has already been completed." };

  const tokenHash = hashSetupCode(input.code);
  const { data: valid } = await admin.rpc("bootstrap_check_token", { p_token_hash: tokenHash });
  if (!valid) {
    return { ok: false, message: "That setup code is not valid or has expired. Create a new one and try again.", fieldErrors: { code: "Not valid or expired." } };
  }

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: { full_name: input.fullName },
  });
  if (createError || !created.user) {
    return { ok: false, message: "We couldn't create that account. If the email is already in use, use a different one." };
  }

  const { error: completeError } = await admin.rpc("bootstrap_complete", {
    p_token_hash: tokenHash,
    p_user_id: created.user.id,
    p_email: input.email,
    p_full_name: input.fullName,
    p_org_name: input.companyName,
    p_org_slug: slugify(input.companyName),
  });
  if (completeError) {
    await admin.auth.admin.deleteUser(created.user.id);
    return { ok: false, message: "Setup could not be finished. The code may have just expired — create a new one and try again." };
  }

  const supabase = await createClient();
  await supabase.auth.signInWithPassword({ email: input.email, password: input.password });
  redirect("/dashboard?welcome=1");
}
