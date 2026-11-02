import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { safeRedirectPath } from "@/lib/safe-redirect";

const ALLOWED_TYPES: EmailOtpType[] = ["invite", "recovery", "email", "email_change"];

/*
 * Landing point for emailed links (invitations, password resets).
 * Email templates must link to: {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/account/password
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = safeRedirectPath(searchParams.get("next"), "/dashboard");

  const fail = () => {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "?notice=link-expired";
    return NextResponse.redirect(url);
  };

  if (!tokenHash || !type || !ALLOWED_TYPES.includes(type)) return fail();

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error) return fail();

  const url = request.nextUrl.clone();
  const target = new URL(next, url.origin);
  if (type === "invite" || type === "recovery") {
    target.pathname = "/account/password";
    target.search = type === "invite" ? "?welcome=1" : "";
  }
  return NextResponse.redirect(target);
}
