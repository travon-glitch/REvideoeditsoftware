/** Paths reachable without signing in. Everything else is protected. */
const PUBLIC_PREFIXES = ["/login", "/forgot-password", "/auth/", "/setup"] as const;

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => (p.endsWith("/") ? pathname.startsWith(p) : pathname === p || pathname.startsWith(`${p}/`)));
}

/** Pages a signed-in person should not see (sends them to the dashboard). */
export function isSignedOutOnlyPath(pathname: string): boolean {
  return pathname === "/login" || pathname === "/forgot-password";
}
