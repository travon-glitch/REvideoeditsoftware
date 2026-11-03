import Link from "next/link";
import { Download } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { secretsConfigured } from "@/lib/secrets";
import { AI_KIND_LABELS, formatCents, percentOf } from "@/lib/admin/control";
import type { AiUsageRow, UserActivityRow } from "@/lib/database.types";
import { formatDateTime } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { PageHeader } from "@/components/page-header";
import { ClaudeKeyForm, ClaudeSettingsForm } from "../settings/claude-section";
import { Meter, Section } from "../control-parts";
import { AiLimitsTable } from "../users/people-table";
import { AiControlsForm, ProviderKeyForm } from "./ai-forms";

export const metadata = { title: "AI control panel" };

const PROVIDER_LABELS: Record<string, string> = { muapi: "MuAPI (video AI)", claude: "Claude (AI Director)", "local-depth": "AI depth (own server)", local: "This server" };
const STATUS_VARIANT: Record<string, "success" | "destructive" | "warning" | "outline"> = { succeeded: "success", failed: "destructive", running: "warning", queued: "warning", cancelled: "outline" };

interface Spend { month_cents: number; today_cents: number; monthly_budget_cents: number | null; daily_budget_cents: number | null; alert_percent: number; by_provider: Record<string, number> }

export default async function AiControlPanelPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePermission("settings.manage");
  const sp = await searchParams;
  const kind = sp.kind && sp.kind in AI_KIND_LABELS ? sp.kind : null;
  const status = sp.status && sp.status in STATUS_VARIANT ? sp.status : null;
  const person = sp.person && /^[0-9a-f-]{36}$/.test(sp.person) ? sp.person : null;
  const before = sp.before && !Number.isNaN(Date.parse(sp.before)) ? sp.before : null;

  const db = await createClient();
  const [{ data: settings }, { data: dash }, { data: keys }, { data: claudeKey }, { data: people }, { data: log }, { data: failures }] = await Promise.all([
    db.from("organization_settings").select("*").eq("organization_id", ctx.organization.id).maybeSingle(),
    db.rpc("admin_dashboard"),
    db.rpc("provider_key_status"),
    db.rpc("claude_key_status"),
    db.rpc("admin_user_activity"),
    db.rpc("admin_ai_usage", { p_kind: kind, p_status: status, p_user: person, p_before: before, p_limit: 100 }),
    db.rpc("admin_ai_usage", { p_status: "failed", p_limit: 200 }),
  ]);
  const spend = (dash as { spend?: Spend } | null)?.spend ?? null;
  const k = (keys ?? {}) as Record<string, { last4: string; updated_at: string }>;
  const rows = (people ?? []) as UserActivityRow[];
  const nameOf = new Map(rows.map((p) => [p.id, p.full_name || p.email]));
  const usage = (log ?? []) as AiUsageRow[];
  const recentFailures = ((failures ?? []) as AiUsageRow[]).filter((f) => Date.now() - Date.parse(f.at) < 30 * 86400_000);
  const byProvider = new Map<string, { count: number; last: AiUsageRow }>();
  for (const f of recentFailures) {
    const e = byProvider.get(f.provider);
    byProvider.set(f.provider, { count: (e?.count ?? 0) + 1, last: e?.last ?? f });
  }
  const monthPct = spend ? percentOf(Number(spend.month_cents), spend.monthly_budget_cents) : null;
  const dayPct = spend ? percentOf(Number(spend.today_cents), spend.daily_budget_cents) : null;
  const tone = (p: number | null) => (p == null ? "default" : p >= 100 ? "bad" : spend && p >= spend.alert_percent ? "warn" : "default") as "default" | "warn" | "bad";
  const qs = (extra: Record<string, string | null>) => {
    const p = new URLSearchParams();
    for (const [key, v] of Object.entries({ kind, status, person, ...extra })) if (v) p.set(key, v);
    return p.toString();
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="AI control panel" description="Super Admin only. Provider keys, models, which AI features are on, limits, spending ceilings, errors and the full AI usage log." />

      {spend ? (
        <div className="grid gap-4 md:grid-cols-3">
          <div className="flex flex-col gap-2 rounded-xl border bg-card p-4">
            <span className="text-sm font-semibold text-muted-foreground">Estimated AI spending this month</span>
            <span className="text-2xl font-bold tabular-nums">{formatCents(spend.month_cents)}</span>
            {monthPct != null ? <Meter pct={monthPct} tone={tone(monthPct)} label={`Monthly ceiling ${monthPct}% used`} /> : null}
            <span className="text-xs text-muted-foreground">{spend.monthly_budget_cents != null ? `${monthPct}% of the ${formatCents(spend.monthly_budget_cents)} monthly ceiling` : "No monthly ceiling"}</span>
          </div>
          <div className="flex flex-col gap-2 rounded-xl border bg-card p-4">
            <span className="text-sm font-semibold text-muted-foreground">Today</span>
            <span className="text-2xl font-bold tabular-nums">{formatCents(spend.today_cents)}</span>
            {dayPct != null ? <Meter pct={dayPct} tone={tone(dayPct)} label={`Daily ceiling ${dayPct}% used`} /> : null}
            <span className="text-xs text-muted-foreground">{spend.daily_budget_cents != null ? `${dayPct}% of the ${formatCents(spend.daily_budget_cents)} daily ceiling` : "No daily ceiling"}</span>
          </div>
          <div className="flex flex-col gap-2 rounded-xl border bg-card p-4">
            <span className="text-sm font-semibold text-muted-foreground">By provider this month</span>
            <ul className="text-sm">
              {Object.entries(spend.by_provider).map(([p, c]) => <li key={p} className="flex justify-between gap-2"><span>{PROVIDER_LABELS[p] ?? p}</span><span className="tabular-nums">{formatCents(Number(c))}</span></li>)}
              {Object.keys(spend.by_provider).length === 0 ? <li className="text-muted-foreground">No AI use yet this month.</li> : null}
            </ul>
            <span className="text-xs text-muted-foreground">Clips are estimated at your price per clip; Claude is priced from real token use.</span>
          </div>
        </div>
      ) : null}

      <Section title="AI features, models and spending ceilings" id="controls">
        <div className="p-5">{settings ? <AiControlsForm settings={settings} /> : <p className="text-muted-foreground">Settings are not available.</p>}</div>
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Video AI provider credentials" id="video-key" description="MuAPI image-to-video, used by Camera Studio's generative AI moves.">
          <div className="p-5">
            <ProviderKeyForm provider="muapi" last4={k.muapi_api_key?.last4 ?? null} updatedAt={k.muapi_api_key?.updated_at ?? null}
              envKey={!!process.env.LVS_GENERATIVE_PROVIDER} canStore={secretsConfigured()} />
          </div>
        </Section>
        <Section title="Claude credentials" id="claude-key" description="Used by the AI Director to analyse photos and write storyboards.">
          <div className="p-5">
            <ClaudeKeyForm status={claudeKey as { configured: boolean; last4?: string } | null} envKey={!!process.env.ANTHROPIC_API_KEY} canStore={secretsConfigured()} />
          </div>
        </Section>
      </div>

      <Section title="AI Director (Claude)" id="director" description="On or off, the default Claude model, and how often it may run.">
        <div className="p-5">{settings ? <ClaudeSettingsForm settings={settings} /> : null}</div>
      </Section>

      <Section title="Per-person AI generation limits" id="limits" description="How many AI clips each person may make per month. Empty means no limit (the spending ceilings still apply).">
        <AiLimitsTable rows={rows} actor={{ id: ctx.userId, role: ctx.profile.role }} />
      </Section>

      <Section title="Provider errors" id="errors" description="AI requests that failed in the last 30 days.">
        {byProvider.size ? (
          <ul className="divide-y">
            {[...byProvider.entries()].map(([p, v]) => (
              <li key={p} className="flex flex-col gap-1 px-5 py-3">
                <span className="font-semibold">{PROVIDER_LABELS[p] ?? p} · <span className="text-destructive">{v.count} failed</span></span>
                <span className="text-sm text-muted-foreground">Latest, {formatDateTime(v.last.at)}: {v.last.error_message ?? "No message"}</span>
              </li>
            ))}
          </ul>
        ) : <p className="px-5 py-4 text-muted-foreground">No provider errors in the last 30 days.</p>}
      </Section>

      <Section title="AI usage log" id="log" description="Every AI request: who, what, which provider and model, the result and its estimated cost."
        actions={<Button asChild variant="outline" size="sm"><a href={`/api/admin/ai-usage?${qs({})}`}><Download aria-hidden="true" />Download CSV</a></Button>}>
        <form method="get" action="/admin/ai#log" className="flex flex-wrap items-end gap-3 border-b px-5 py-3">
          <label className="flex flex-col gap-1 text-sm font-medium">What
            <NativeSelect name="kind" defaultValue={kind ?? ""} className="h-9 w-48 text-sm"><option value="">Everything</option>{Object.entries(AI_KIND_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</NativeSelect>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">Result
            <NativeSelect name="status" defaultValue={status ?? ""} className="h-9 w-36 text-sm"><option value="">Any</option><option value="succeeded">Succeeded</option><option value="failed">Failed</option><option value="running">Running</option><option value="queued">Waiting</option></NativeSelect>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">Person
            <NativeSelect name="person" defaultValue={person ?? ""} className="h-9 w-48 text-sm"><option value="">Everyone</option>{rows.map((p) => <option key={p.id} value={p.id}>{p.full_name || p.email}</option>)}</NativeSelect>
          </label>
          <Button type="submit" size="sm">Show</Button>
          {kind || status || person ? <Button asChild size="sm" variant="ghost"><Link href="/admin/ai#log">Clear</Link></Button> : null}
        </form>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="border-b bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
              <tr><th className="px-5 py-2.5">When</th><th className="px-3 py-2.5">Person</th><th className="px-3 py-2.5">What</th><th className="px-3 py-2.5">Provider · model</th><th className="px-3 py-2.5">Result</th><th className="px-5 py-2.5 text-right">Cost</th></tr>
            </thead>
            <tbody className="divide-y">
              {usage.map((u) => (
                <tr key={`${u.kind}-${u.id}`} className="align-top">
                  <td className="whitespace-nowrap px-5 py-2.5">{formatDateTime(u.at)}</td>
                  <td className="px-3 py-2.5">{(u.user_id && nameOf.get(u.user_id)) || "—"}</td>
                  <td className="px-3 py-2.5">{AI_KIND_LABELS[u.kind] ?? u.kind}{u.project_id ? <Link className="block text-primary" href={`/videos/${u.project_id}`}>Open video</Link> : null}</td>
                  <td className="px-3 py-2.5">{PROVIDER_LABELS[u.provider] ?? u.provider}<span className="block text-muted-foreground">{u.model}</span></td>
                  <td className="px-3 py-2.5"><Badge variant={STATUS_VARIANT[u.status] ?? "outline"}>{u.status}</Badge>{u.error_message ? <span className="mt-1 block max-w-xs text-destructive">{u.error_message}</span> : null}</td>
                  <td className="px-5 py-2.5 text-right tabular-nums">{formatCents(Number(u.cost_cents))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {usage.length === 0 ? <p className="px-5 py-6 text-muted-foreground">No AI use matches.</p> : null}
        </div>
        {usage.length === 100 ? (
          <div className="border-t px-5 py-3"><Button asChild variant="outline" size="sm"><Link href={`/admin/ai?${qs({ before: usage.at(-1)!.at })}#log`}>Older entries</Link></Button></div>
        ) : null}
      </Section>
    </div>
  );
}
