import { NextResponse, type NextRequest } from "next/server";
import { apiAuth } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";
import { AI_KIND_LABELS } from "@/lib/admin/control";
import type { AiUsageRow } from "@/lib/database.types";

export const runtime = "nodejs";

/** CSV cells: quoted, and never starting with a formula character (spreadsheet injection). */
function cell(v: unknown): string {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/** The AI usage log as CSV (Super Admin; the database checks the role again). */
export async function GET(request: NextRequest) {
  const auth = await apiAuth(request, "settings.manage");
  if (!auth.ok) return auth.response;
  const sp = request.nextUrl.searchParams;
  const kind = sp.get("kind"), status = sp.get("status"), person = sp.get("person");
  const db = await createClient();
  const [{ data, error }, { data: people }] = await Promise.all([
    db.rpc("admin_ai_usage", {
      p_kind: kind && kind in AI_KIND_LABELS ? kind : null,
      p_status: status && /^(queued|running|succeeded|failed|cancelled)$/.test(status) ? status : null,
      p_user: person && /^[0-9a-f-]{36}$/.test(person) ? person : null, p_limit: 500,
    }),
    db.from("profiles").select("id,full_name,email"),
  ]);
  if (error) return NextResponse.json({ error: "Only the Super Admin can download the AI usage log." }, { status: 403 });
  const name = new Map((people ?? []).map((p) => [p.id, p.full_name || p.email]));
  const lines = [["When (UTC)", "Person", "What", "Provider", "Model", "Result", "Cost (USD)", "Error", "Video id"].map(cell).join(",")];
  for (const u of (data ?? []) as AiUsageRow[]) {
    lines.push([u.at, (u.user_id && name.get(u.user_id)) || "", AI_KIND_LABELS[u.kind] ?? u.kind, u.provider, u.model, u.status,
      (Number(u.cost_cents) / 100).toFixed(2), u.error_message ?? "", u.project_id ?? ""].map(cell).join(","));
  }
  return new NextResponse(lines.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="ai-usage-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
