import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { safeRedirectPath } from "@/lib/safe-redirect";

const ALLOWED_TYPES: EmailOtpType[] = ["invite", "recovery", "email", "email_change"];

/*
 * Landing point for emailed links (invitations, password resets).
 * Email templates must link to: {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/account/password
 *
 * Opening the link (GET) only shows a "Continue" page; the one-time code is used when the person presses
 * the button (POST). Company email scanners open links but don't press buttons, so they can't use it up.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl.clone();
  url.pathname = "/auth/continue";
  return NextResponse.redirect(url, 303);
}

export async function POST(request: NextRequest) {
  const fail = () => {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "?notice=link-expired";
    return NextResponse.redirect(url, 303);
  };
  // the button is on our own page: refuse posts from other sites
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) return fail();

  const form = await request.formData().catch(() => null);
  const tokenHash = String(form?.get("token_hash") ?? "");
  const type = String(form?.get("type") ?? "") as EmailOtpType;
  const next = safeRedirectPath(String(form?.get("next") ?? ""), "/dashboard");
  if (!tokenHash || !ALLOWED_TYPES.includes(type)) return fail();

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error) return fail();

  const target = new URL(next, request.nextUrl.origin);
  if (type === "invite" || type === "recovery") {
    target.pathname = "/account/password";
    target.search = type === "invite" ? "?welcome=1" : "";
  }
  return NextResponse.redirect(target, 303);
}
