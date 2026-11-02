/** Content-Security-Policy with a per-request nonce for Next.js inline scripts. */
export function buildCsp(nonce: string, supabaseUrl: string | undefined, isDev: boolean, upgradeInsecure = !isDev): string {
  let supabaseOrigin = "";
  let supabaseWs = "";
  try {
    if (supabaseUrl) {
      const u = new URL(supabaseUrl);
      supabaseOrigin = u.origin;
      supabaseWs = `${u.protocol === "https:" ? "wss:" : "ws:"}//${u.host}`;
    }
  } catch {
    // leave empty: misconfiguration is reported elsewhere
  }
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(isDev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "blob:", "data:", supabaseOrigin].filter(Boolean),
    "media-src": ["'self'", "blob:", supabaseOrigin].filter(Boolean),
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'", supabaseOrigin, supabaseWs, ...(isDev ? ["ws:"] : [])].filter(Boolean),
    "frame-src": ["'none'"],
    "frame-ancestors": ["'none'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
  };
  const policy = Object.entries(directives).map(([k, v]) => `${k} ${v.join(" ")}`);
  if (upgradeInsecure) policy.push("upgrade-insecure-requests");
  return policy.join("; ");
}
