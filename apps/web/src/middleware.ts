import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { isPublicPath, isSignedOutOnlyPath } from "@/lib/auth/route-access";
import { buildCsp } from "@/lib/csp";

/*
 * Runs on every page request:
 *   1. Sets a nonce-based Content-Security-Policy.
 *   2. Refreshes the Supabase session cookie.
 *   3. Sends signed-out visitors to /login for every protected page.
 * Fine-grained checks (active profile, role) happen again in layouts and actions.
 */
export async function middleware(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const isDev = process.env.NODE_ENV !== "production";
  const isHttps = request.nextUrl.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
  const csp = buildCsp(nonce, process.env.NEXT_PUBLIC_SUPABASE_URL, isDev, !isDev && isHttps);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  let response = NextResponse.next({ request: { headers: requestHeaders } });
  const { pathname, search } = request.nextUrl;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    // Not configured yet: only the public pages work (they explain what to do).
    if (!isPublicPath(pathname)) {
      const login = request.nextUrl.clone();
      login.pathname = "/login";
      login.search = "";
      response = NextResponse.redirect(login);
    }
    response.headers.set("Content-Security-Policy", csp);
    return response;
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request: { headers: requestHeaders } });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  // getUser() validates the session with Supabase Auth (do not trust getSession() here).
  const { data: { user } } = await supabase.auth.getUser();

  const redirectTo = (path: string, params?: Record<string, string>) => {
    const target = request.nextUrl.clone();
    target.pathname = path;
    target.search = params ? `?${new URLSearchParams(params).toString()}` : "";
    const redirect = NextResponse.redirect(target);
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    redirect.headers.set("Content-Security-Policy", csp);
    return redirect;
  };

  if (!user && pathname.startsWith("/api/")) {
    const res = NextResponse.json({ error: "Please sign in again." }, { status: 401 });
    res.headers.set("Content-Security-Policy", csp);
    return res;
  }
  if (!user && !isPublicPath(pathname)) {
    return redirectTo("/login", pathname === "/" ? undefined : { next: `${pathname}${search}` });
  }
  if (user && isSignedOutOnlyPath(pathname)) {
    return redirectTo("/dashboard");
  }

  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    // everything except Next internals and static files (incl. the public template preview clips)
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|templates/[a-z-]+\\.mp4$|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)",
  ],
};
