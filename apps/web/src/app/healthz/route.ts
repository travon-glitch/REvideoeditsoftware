import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Uptime check for your hosting or monitoring service (no sign-in needed). It says only whether the app
 * and its database answer — nothing about the company, people or videos. Detailed health is in
 * Admin → System health.
 */
export async function GET() {
  let database = false;
  try {
    const { error } = await createAdminClient().from("organizations").select("id", { head: true, count: "exact" }).limit(1);
    database = !error;
  } catch { database = false; }
  return NextResponse.json({ ok: database, database: database ? "up" : "down" }, { status: database ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
