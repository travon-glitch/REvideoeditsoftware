import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { getSessionContext, type SessionContext } from "@/lib/auth/session";
import { can, type Permission } from "@/lib/auth/roles";

export function jsonError(status: number, message: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error: message, ...extra }, { status, headers: { "Cache-Control": "no-store" } });
}

/** Rejects cross-site writes (in addition to SameSite cookies). */
export function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return request.method === "GET" || request.method === "HEAD";
  return origin === request.nextUrl.origin;
}

export type ApiAuth = { ok: true; ctx: SessionContext } | { ok: false; response: NextResponse };

/** Signed-in, active, with the permission — otherwise a JSON error. */
export async function apiAuth(request: NextRequest, permission: Permission): Promise<ApiAuth> {
  if (!sameOrigin(request)) return { ok: false, response: jsonError(403, "Cross-site request refused.") };
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, response: jsonError(401, "Please sign in again.") };
  if (!can(ctx.profile.role, permission)) return { ok: false, response: jsonError(403, "You don't have permission to do that.") };
  return { ok: true, ctx };
}

export async function readJson(request: NextRequest, maxBytes = 512 * 1024): Promise<unknown> {
  const text = await request.text();
  if (text.length > maxBytes) throw new Error("Request is too large");
  return JSON.parse(text || "null");
}
