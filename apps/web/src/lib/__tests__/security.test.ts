import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { isPublicPath, isSignedOutOnlyPath } from "@/lib/auth/route-access";
import { buildCsp } from "@/lib/csp";

describe("safeRedirectPath", () => {
  it.each([
    ["/videos/1?x=2#top", "/videos/1?x=2#top"],
    ["/listings", "/listings"],
  ])("keeps same-site path %s", (input, expected) => {
    expect(safeRedirectPath(input)).toBe(expected);
  });

  it.each([
    "https://evil.example/", "//evil.example", "/\\evil.example", "javascript:alert(1)", "/login", "/auth/confirm",
    "/setup", "videos", "", "/a\nb", "/" + "a".repeat(600),
  ])("rejects %s", (input) => {
    expect(safeRedirectPath(input)).toBe("/dashboard");
  });

  it("rejects non-strings", () => {
    expect(safeRedirectPath(undefined)).toBe("/dashboard");
    expect(safeRedirectPath(["/x"])).toBe("/dashboard");
  });
});

describe("route access", () => {
  it("only sign-in, password reset, email links and setup are public", () => {
    for (const p of ["/login", "/forgot-password", "/auth/confirm", "/setup"]) expect(isPublicPath(p)).toBe(true);
    for (const p of ["/", "/dashboard", "/admin", "/admin/team", "/listings/1", "/loginx", "/setup-other", "/no-access"]) {
      expect(isPublicPath(p)).toBe(false);
    }
    expect(isSignedOutOnlyPath("/login")).toBe(true);
    expect(isSignedOutOnlyPath("/setup")).toBe(false);
  });
});

describe("content security policy", () => {
  it("uses a nonce, allows Supabase, blocks framing and plugins", () => {
    const csp = buildCsp("abc123", "https://proj.supabase.co", false);
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("connect-src 'self' https://proj.supabase.co wss://proj.supabase.co");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("upgrade-insecure-requests");
  });

  it("upgrades insecure requests only when asked (HTTPS deployments)", () => {
    expect(buildCsp("n", undefined, false, false)).not.toContain("upgrade-insecure-requests");
  });

  it("allows eval only in development", () => {
    expect(buildCsp("n", undefined, true)).toContain("'unsafe-eval'");
  });
});
