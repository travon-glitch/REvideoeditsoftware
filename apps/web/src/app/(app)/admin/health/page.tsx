import { Database, HardDrive, PlugZap, RefreshCw, Server } from "lucide-react";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { systemHealth, type Check, type Queue } from "@/lib/admin/health";
import type { HealthLevel } from "@/lib/admin/control";
import { formatDateTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { LevelBadge, Section, duration } from "../control-parts";

export const metadata = { title: "System health" };
export const dynamic = "force-dynamic";

function Row({ c }: { c: Check }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
      <span><span className="block font-semibold">{c.name}</span><span className="text-sm text-muted-foreground">{c.detail}</span></span>
      <LevelBadge level={c.level} />
    </li>
  );
}

function QueueCard({ title, q }: { title: string; q: Queue & { level: HealthLevel; workersOnline: number } }) {
  const items: [string, string][] = [
    ["Waiting", String(q.queued)], ["Running", String(q.running)], ["Finished (24 h)", String(q.succeeded_24h)], ["Failed (24 h)", String(q.failed_24h)],
    ["Stuck", String(q.stuck)], ["Oldest waiting", q.queued ? duration(q.oldest_queued_seconds) : "—"], ["Workers online", String(q.workersOnline)],
  ];
  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between gap-2"><h3 className="font-semibold">{title}</h3><LevelBadge level={q.level} /></div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
        {items.map(([k, v]) => <div key={k}><dt className="text-muted-foreground">{k}</dt><dd className="text-lg font-semibold tabular-nums">{v}</dd></div>)}
      </dl>
    </div>
  );
}

export default async function SystemHealthPage() {
  const ctx = await requirePermission("admin.access");
  const db = await createClient();
  const h = await systemHealth(db, ctx.organization.id, can(ctx.profile.role, "settings.manage"));
  const overall: HealthLevel = [h.database, ...h.storage, ...h.providers].some((c) => c.level === "down") || h.render.level === "down" || h.ai.level === "down"
    ? "down" : [h.database, ...h.storage, ...h.providers].some((c) => c.level === "warn") || h.render.level === "warn" || h.ai.level === "warn" ? "warn" : "ok";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="System health" description={`Checked live at ${formatDateTime(h.checkedAt)}.`}
        actions={<div className="flex items-center gap-3"><LevelBadge level={overall} text={overall === "ok" ? "All systems healthy" : overall === "warn" ? "Some things need attention" : "Something isn't working"} />
          <Button asChild variant="outline"><Link href="/admin/health"><RefreshCw aria-hidden="true" />Check again</Link></Button></div>} />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
          <div className="flex items-center justify-between gap-2"><h3 className="flex items-center gap-2 font-semibold"><Database className="size-5 text-primary" aria-hidden="true" />Database</h3><LevelBadge level={h.database.level} /></div>
          <p className="text-sm text-muted-foreground">{h.database.detail}</p>
        </div>
        <div className="lg:col-span-2"><QueueCard title="Rendering queue" q={h.render} /></div>
      </div>
      <QueueCard title="AI video job queue" q={h.ai} />

      <Section title="Workers" id="workers" description="Render and AI workers report every 30 seconds. Quiet for 90 seconds needs attention; for 10 minutes means it has stopped.">
        {h.workers.length ? (
          <ul className="divide-y">
            {h.workers.map((w) => (
              <li key={w.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <span className="flex items-start gap-3"><Server className="mt-0.5 size-5 text-muted-foreground" aria-hidden="true" />
                  <span><span className="block font-semibold">{w.kind === "render" ? "Render worker" : "AI worker"} · {w.host ?? w.id}</span>
                    <span className="text-sm text-muted-foreground">
                      {w.busy ? "Working on a job" : "Idle"} · {w.jobs_done} jobs since {formatDateTime(w.started_at)} · last seen {duration(w.seconds_since_seen)} ago
                      {w.kind === "ai" && w.providers.length ? ` · serves ${w.providers.join(", ")}` : ""}
                    </span>
                    {w.last_error ? <span className="block text-sm text-destructive">Last error: {w.last_error}</span> : null}
                  </span>
                </span>
                <LevelBadge level={w.level} text={w.level === "ok" ? "Online" : w.level === "warn" ? "Quiet" : "Stopped"} />
              </li>
            ))}
          </ul>
        ) : <p className="px-5 py-4 text-destructive">No worker has reported in the last day. Start the render worker (npm start -w @lvs/render-worker) and the AI worker (npm start -w @lvs/ai-motion).</p>}
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Storage" id="storage" description="Each storage area answered a real request just now.">
          <ul className="divide-y">{h.storage.map((c) => <Row key={c.name} c={c} />)}</ul>
        </Section>
        <Section title="Provider integrations" id="providers" description="AI services, their keys and the workers that use them.">
          <ul className="divide-y">{h.providers.map((c) => <Row key={c.name} c={c} />)}</ul>
        </Section>
      </div>

      <Section title="Recent failed jobs" id="failures">
        {h.failures.length ? (
          <ul className="divide-y">
            {h.failures.slice(0, 15).map((x) => (
              <li key={`${x.kind}-${x.id}`} className="flex flex-wrap gap-x-4 gap-y-1 px-5 py-2.5 text-sm">
                <span className="w-36 text-muted-foreground">{x.at ? formatDateTime(x.at) : "—"}</span>
                <span className="w-28 font-semibold">{x.kind === "render" ? "Render" : `AI · ${x.provider ?? ""}`}</span>
                <span className="min-w-60 flex-1 text-destructive">{x.error ?? "No message"}</span>
                {x.project_id ? <Link className="text-primary" href={`/videos/${x.project_id}`}>Open video</Link> : null}
              </li>
            ))}
          </ul>
        ) : <p className="flex items-center gap-2 px-5 py-4 text-muted-foreground"><PlugZap className="size-4" aria-hidden="true" />No failed jobs.</p>}
      </Section>
      <p className="flex items-center gap-2 text-sm text-muted-foreground"><HardDrive className="size-4" aria-hidden="true" />Storage use per kind is on the Admin dashboard.</p>
    </div>
  );
}
