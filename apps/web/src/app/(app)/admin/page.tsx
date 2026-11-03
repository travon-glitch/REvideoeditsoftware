import Link from "next/link";
import {
  AlertTriangle, Bot, Clapperboard, CircleDollarSign, Cpu, HardDrive, HeartPulse, House, IdCard, LayoutTemplate, ListVideo, Music,
  Palette, ScrollText, Settings, UserCheck, UserX, Users,
} from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { activityLabel, formatBytes, formatCents, percentOf } from "@/lib/admin/control";
import { formatDateTime } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Section, StatCard, duration } from "./control-parts";

export const metadata = { title: "Admin dashboard" };

interface Dashboard {
  users: { total: number; active: number; invited: number; suspended: number; deactivated: number };
  listings: number;
  projects: { total: number; archived: number; this_month: number };
  videos: { total: number; this_month: number };
  render_queue: { queued: number; running: number; failed_today: number; oldest_queued_seconds: number };
  ai_jobs: { total: number; this_month: number; queued: number; running: number; failed_month: number };
  ai_failures_month: number;
  storage: { bytes: number; files: number; by_bucket: Record<string, number> };
  spend: null | { month_cents: number; today_cents: number; monthly_budget_cents: number | null; daily_budget_cents: number | null; alert_percent: number; by_provider: Record<string, number> };
}

const BUCKET_LABELS: Record<string, string> = {
  "listing-media": "Listing photos", "video-exports": "Finished videos", "ai-clips": "AI clips", "project-media": "Narration and uploads",
  "brand-assets": "Brand files", "music-library": "Music",
};

export default async function AdminDashboardPage() {
  const ctx = await requirePermission("admin.access");
  const db = await createClient();
  const superAdmin = can(ctx.profile.role, "settings.manage");
  const [{ data, error }, { data: recent }, { data: people }] = await Promise.all([
    db.rpc("admin_dashboard"),
    db.from("audit_log").select("id,action,actor_id,created_at").order("id", { ascending: false }).limit(8),
    db.from("profiles").select("id,full_name,email"),
  ]);
  const d = data as unknown as Dashboard | null;
  const name = new Map((people ?? []).map((p) => [p.id, p.full_name || p.email]));

  const spend = d?.spend ?? null;
  const monthPct = spend ? percentOf(Number(spend.month_cents), spend.monthly_budget_cents) : null;
  const dayPct = spend ? percentOf(Number(spend.today_cents), spend.daily_budget_cents) : null;
  const worst = Math.max(monthPct ?? 0, dayPct ?? 0);
  const spendTone = spend && worst >= 100 ? "bad" : spend && worst >= spend.alert_percent ? "warn" : "default";

  const links = [
    { href: "/admin/users", icon: Users, title: "People and activity", text: "Add employees, change roles, suspend, assign listings, set limits and downloads." },
    { href: "/admin/library", icon: ListVideo, title: "Company video library", text: "Search, preview, download, reassign, archive or delete any video." },
    ...(superAdmin ? [{ href: "/admin/ai", icon: Bot, title: "AI control panel", text: "Provider keys, models, AI switches, limits, spending ceilings and the AI usage log." }] : []),
    { href: "/admin/health", icon: HeartPulse, title: "System health", text: "Database, render and AI workers, queues, storage and provider status." },
    { href: "/admin/audit", icon: ScrollText, title: "Activity log", text: "Who changed what, and when." },
    ...(can(ctx.profile.role, "branding.manage") ? [{ href: "/admin/branding", icon: Palette, title: "Brand kit", text: "Logos, colours, fonts, intro and outro, agent card and disclosures." }] : []),
    { href: "/admin/templates", icon: LayoutTemplate, title: "Templates", text: "Approve, disable and set default templates and branding rules." },
    { href: "/admin/agents", icon: IdCard, title: "Agent profiles", text: "Agent details and headshots for videos." },
    { href: "/admin/music", icon: Music, title: "Music library", text: "Licensed background music." },
    ...(superAdmin ? [{ href: "/admin/settings", icon: Settings, title: "System settings", text: "Download defaults, video limits, batch and render limits." }] : []),
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Admin dashboard" description={`Everything happening at ${ctx.organization.name}, live.`} />
      {error || !d ? (
        <Alert variant="destructive"><AlertTitle>The dashboard couldn&apos;t load</AlertTitle><AlertDescription>The database didn&apos;t answer. Check System health.</AlertDescription></Alert>
      ) : (
        <>
          {spend && spendTone !== "default" ? (
            <Alert variant={spendTone === "bad" ? "destructive" : "default"}>
              <AlertTriangle aria-hidden="true" />
              <AlertTitle>{spendTone === "bad" ? "An AI spending ceiling is reached — paid AI is paused" : `AI spending is past ${spend.alert_percent}% of a ceiling`}</AlertTitle>
              <AlertDescription>Review it in the <Link className="font-semibold underline" href="/admin/ai">AI control panel</Link>.</AlertDescription>
            </Alert>
          ) : null}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
            <StatCard icon={Users} label="Total users" value={String(d.users.total)} note={`${d.users.invited} invited · ${d.users.deactivated} deactivated`} href="/admin/users" />
            <StatCard icon={UserCheck} label="Active users" value={String(d.users.active)} href="/admin/users?status=active" />
            <StatCard icon={UserX} label="Suspended users" value={String(d.users.suspended)} tone={d.users.suspended ? "warn" : "default"} href="/admin/users?status=suspended" />
            <StatCard icon={House} label="Total listings" value={String(d.listings)} />
            <StatCard icon={Clapperboard} label="Videos generated" value={String(d.videos.total)} note={`${d.videos.this_month} this month · ${d.projects.total} projects`} href="/admin/library" />
            <StatCard icon={Cpu} label="AI video jobs" value={String(d.ai_jobs.total)} note={`${d.ai_jobs.this_month} this month · ${d.ai_jobs.queued + d.ai_jobs.running} waiting or running`} />
            <StatCard icon={ListVideo} label="Rendering queue" value={`${d.render_queue.queued} waiting`}
              note={`${d.render_queue.running} rendering now${d.render_queue.queued ? ` · oldest ${duration(d.render_queue.oldest_queued_seconds)}` : ""}${d.render_queue.failed_today ? ` · ${d.render_queue.failed_today} failed today` : ""}`}
              tone={d.render_queue.failed_today ? "warn" : "default"} href="/admin/health" />
            <StatCard icon={AlertTriangle} label="AI generation failures" value={String(d.ai_failures_month)} note="This month (clips, Director, narration, captions)"
              tone={d.ai_failures_month ? "warn" : "default"} href={superAdmin ? "/admin/ai#errors" : "/admin/health"} />
            <StatCard icon={HardDrive} label="Storage usage" value={formatBytes(d.storage.bytes)} note={`${d.storage.files.toLocaleString()} files`} href="/admin/health#storage" />
            {spend ? (
              <StatCard icon={CircleDollarSign} label="Estimated AI spending" value={formatCents(spend.month_cents)} pct={monthPct} tone={spendTone}
                note={spend.monthly_budget_cents != null ? `this month, of ${formatCents(spend.monthly_budget_cents)} ceiling · today ${formatCents(spend.today_cents)}` : `this month (no ceiling) · today ${formatCents(spend.today_cents)}`} href="/admin/ai" />
            ) : null}
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Section title="Storage by kind" id="by-kind" description="Files stored for this company.">
              <ul className="divide-y">
                {Object.entries(d.storage.by_bucket).sort(([, a], [, b]) => Number(b) - Number(a)).map(([bucket, bytes]) => (
                  <li key={bucket} className="flex justify-between gap-3 px-5 py-2.5 text-base"><span>{BUCKET_LABELS[bucket] ?? bucket}</span><span className="tabular-nums text-muted-foreground">{formatBytes(Number(bytes))}</span></li>
                ))}
                {Object.keys(d.storage.by_bucket).length === 0 ? <li className="px-5 py-4 text-muted-foreground">Nothing stored yet.</li> : null}
              </ul>
            </Section>
            <Section title="Recent activity" id="recent" actions={<Link href="/admin/audit" className="text-sm font-semibold text-primary">Full log</Link>}>
              <ul className="divide-y">
                {(recent ?? []).map((a) => (
                  <li key={a.id} className="flex flex-wrap gap-x-4 gap-y-1 px-5 py-2.5 text-base">
                    <span className="w-36 text-sm text-muted-foreground">{formatDateTime(a.created_at)}</span>
                    <span><strong>{(a.actor_id && name.get(a.actor_id)) || "System"}</strong> · {activityLabel(a.action)}</span>
                  </li>
                ))}
                {(recent ?? []).length === 0 ? <li className="px-5 py-4 text-muted-foreground">No activity yet.</li> : null}
              </ul>
            </Section>
          </div>
        </>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {links.map((c) => (
          <Link key={c.href} href={c.href} className="flex flex-col gap-2 rounded-xl border bg-card p-5 hover:border-primary/40">
            <c.icon className="size-6 text-primary" aria-hidden="true" />
            <span className="text-lg font-semibold">{c.title}</span>
            <span className="text-base text-muted-foreground">{c.text}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
