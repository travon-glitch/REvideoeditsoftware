import { requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { ComingSoonNote } from "@/components/coming-soon";
import { SettingsForm } from "./settings-form";
import { ClaudeKeyForm, ClaudeSettingsForm } from "./claude-section";
import { secretsConfigured } from "@/lib/secrets";
import { formatDateTime } from "@/lib/utils";

export const metadata = { title: "System settings" };

export default async function SettingsPage() {
  const ctx = await requirePermission("settings.manage");
  const supabase = await createClient();
  const { data: settings } = await supabase.from("organization_settings").select("*").eq("organization_id", ctx.organization.id).maybeSingle();
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const [{ data: keyStatus }, { data: runs }, { data: people }] = await Promise.all([
    supabase.rpc("claude_key_status"),
    supabase.from("director_runs").select("id,created_by,model,style,status,cost_cents,usage,created_at,error_message").gte("created_at", monthStart.toISOString()).order("created_at", { ascending: false }).limit(500),
    supabase.from("profiles").select("id,full_name"),
  ]);
  const nameOf = new Map((people ?? []).map((p) => [p.id, p.full_name]));
  const usageOf = (u: unknown) => u as { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
  const total = (runs ?? []).reduce((a, r) => ({
    cost: a.cost + Number(r.cost_cents), runs: a.runs + 1, failed: a.failed + (r.status === "failed" ? 1 : 0),
    input: a.input + (usageOf(r.usage).input_tokens ?? 0) + (usageOf(r.usage).cache_read_input_tokens ?? 0) + (usageOf(r.usage).cache_creation_input_tokens ?? 0),
    output: a.output + (usageOf(r.usage).output_tokens ?? 0),
  }), { cost: 0, runs: 0, failed: 0, input: 0, output: 0 });
  const byPerson = new Map<string, { runs: number; cost: number }>();
  for (const r of runs ?? []) { const k = r.created_by ?? "—"; const v = byPerson.get(k) ?? { runs: 0, cost: 0 }; v.runs++; v.cost += Number(r.cost_cents); byPerson.set(k, v); }
  const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="System settings" description="Super Admin only: AI services, costs and company-wide defaults." />
      <Card>
        <CardHeader>
          <CardTitle>AI and costs</CardTitle>
          <CardDescription>Budgets and defaults apply to the whole company.</CardDescription>
        </CardHeader>
        <CardContent>
          {settings ? <SettingsForm settings={settings} /> : <p className="text-base text-muted-foreground">Settings are not available.</p>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>AI Director (Claude)</CardTitle>
          <CardDescription>Photo analysis and automatic storyboards by Claude (Anthropic).</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-8">
          <ClaudeKeyForm status={keyStatus as { configured: boolean; last4?: string } | null} envKey={!!process.env.ANTHROPIC_API_KEY} canStore={secretsConfigured()} />
          {settings ? <ClaudeSettingsForm settings={settings} /> : null}
          <div className="flex flex-col gap-3">
            <h3 className="text-lg font-semibold">Usage and cost this month</h3>
            <dl className="grid gap-3 sm:grid-cols-4">
              {[["Runs", String(total.runs)], ["Failed", String(total.failed)], ["Tokens in / out", `${total.input.toLocaleString()} / ${total.output.toLocaleString()}`], ["Cost", dollars(total.cost)]].map(([k, v]) => (
                <div key={k} className="rounded-lg border p-3"><dt className="text-sm text-muted-foreground">{k}</dt><dd className="text-xl font-semibold">{v}</dd></div>
              ))}
            </dl>
            {byPerson.size ? (
              <table className="w-full text-left text-sm">
                <thead><tr className="border-b text-muted-foreground"><th className="py-2">Person</th><th>Runs</th><th>Cost</th></tr></thead>
                <tbody>{[...byPerson.entries()].map(([id, v]) => <tr key={id} className="border-b"><td className="py-2">{nameOf.get(id) ?? "—"}</td><td>{v.runs}</td><td>{dollars(v.cost)}</td></tr>)}</tbody>
              </table>
            ) : <p className="text-sm text-muted-foreground">No AI Director runs this month.</p>}
            {(runs ?? []).length ? (
              <details><summary className="cursor-pointer text-sm font-semibold">Recent runs</summary>
                <ul className="mt-2 divide-y rounded-lg border text-sm">{(runs ?? []).slice(0, 20).map((r) => (
                  <li key={r.id} className="flex flex-wrap gap-3 px-3 py-2"><span className="w-40">{formatDateTime(r.created_at)}</span><span className="w-32">{nameOf.get(r.created_by ?? "") ?? "—"}</span><span className="w-28">{r.style}</span><span className="w-36">{r.model}</span><span className="w-20">{r.status}</span><span>{dollars(Number(r.cost_cents))}</span></li>
                ))}</ul>
              </details>
            ) : null}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>AI video services</CardTitle></CardHeader>
        <CardContent>
          <ComingSoonNote>
            AI video services for Camera Studio (MuAPI image-to-video) are set on the AI worker server with its own key (MUAPI_API_KEY). The local AI depth method needs no key.
          </ComingSoonNote>
        </CardContent>
      </Card>
    </div>
  );
}
