import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { BrandKitRow, OrganizationRow, ProfileRow } from "@/lib/database.types";
import { can, type Permission } from "@/lib/auth/roles";

export interface SessionContext {
  userId: string;
  email: string;
  profile: ProfileRow;
  organization: OrganizationRow;
  brandKit: BrandKitRow | null;
}

/**
 * The signed-in person, their profile and company — or null.
 * Cached per request so layouts and pages share one lookup.
 */
export const getSessionContext = cache(async (): Promise<SessionContext | null> => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (!profile || !profile.is_active) return null;

  const [{ data: organization }, { data: brandKit }] = await Promise.all([
    supabase.from("organizations").select("*").eq("id", profile.organization_id).maybeSingle(),
    supabase.from("brand_kits").select("*").eq("organization_id", profile.organization_id).eq("is_default", true).maybeSingle(),
  ]);
  if (!organization) return null;

  return { userId: user.id, email: user.email ?? profile.email, profile, organization, brandKit: brandKit ?? null };
});

/** For pages: signed in with an active profile, otherwise redirect. */
export async function requireSession(): Promise<SessionContext> {
  const ctx = await getSessionContext();
  if (ctx) return ctx;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  redirect(user ? "/no-access" : "/login");
}

/** For pages: also requires a permission, otherwise shows the "no permission" page. */
export async function requirePermission(permission: Permission): Promise<SessionContext> {
  const ctx = await requireSession();
  if (!can(ctx.profile.role, permission)) redirect("/forbidden");
  return ctx;
}

export type ActionResult<T = undefined> =
  | { ok: true; message?: string; data?: T }
  | { ok: false; message: string; fieldErrors?: Record<string, string> };

/** For server actions: returns a friendly error instead of redirecting. */
export async function authorizeAction(
  permission: Permission,
): Promise<{ ok: true; ctx: SessionContext } | { ok: false; result: ActionResult<never> }> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, result: { ok: false, message: "Please sign in again." } };
  if (!can(ctx.profile.role, permission)) {
    return { ok: false, result: { ok: false, message: "You don't have permission to do that." } };
  }
  return { ok: true, ctx };
}
