import "server-only";
/*
 * Changing a password from a normal (password) sign-in needs the current password, so a stolen or
 * left-open session can't lock the owner out. Sessions opened from an invitation or password-reset
 * email link don't know a password yet, so they set one directly.
 */
import { createClient as createPlainClient } from "@supabase/supabase-js";
import type { createClient } from "@/lib/supabase/server";
import { publicEnv } from "@/lib/env";

type Db = Awaited<ReturnType<typeof createClient>>;

/** How this session was opened, from the access token's "amr" claim (most recent method). */
export function sessionMethod(accessToken: string | null | undefined): string | null {
  try {
    const payload = JSON.parse(Buffer.from(accessToken!.split(".")[1]!, "base64url").toString("utf8")) as { amr?: { method?: string; timestamp?: number }[] };
    const latest = [...(payload.amr ?? [])].sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))[0];
    return latest?.method ?? null;
  } catch {
    return null;
  }
}

/** True when the person must type their current password to change it. */
export async function needsCurrentPassword(db: Db): Promise<boolean> {
  const { data } = await db.auth.getSession();
  const m = sessionMethod(data.session?.access_token);
  // email-link sessions (invite, recovery, magic link / OTP) set a password without the old one
  return !(m === "recovery" || m === "invite" || m === "otp" || m === "magiclink" || m === "email/signup");
}

/** Checks a password without touching the person's current session (a throwaway client, nothing stored). */
export async function passwordIsCorrect(email: string, password: string): Promise<boolean> {
  const env = publicEnv();
  const probe = createPlainClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await probe.auth.signInWithPassword({ email, password });
  if (data.session) await probe.auth.signOut({ scope: "local" }).catch(() => undefined);
  return !error && !!data.user;
}
