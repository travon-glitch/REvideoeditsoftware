/* Small display pieces shared by the admin control center pages (no client code). */
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { HealthLevel } from "@/lib/admin/control";
import { cn } from "@/lib/utils";

export function StatCard({ icon: Icon, label, value, note, href, pct, tone = "default" }: {
  icon: LucideIcon; label: string; value: string; note?: string; href?: string; pct?: number | null; tone?: "default" | "warn" | "bad";
}) {
  const body = (
    <>
      <span className="flex items-center gap-2 text-sm font-semibold text-muted-foreground"><Icon className="size-4" aria-hidden="true" />{label}</span>
      <span className={cn("text-2xl font-bold tabular-nums", tone === "bad" && "text-destructive", tone === "warn" && "text-warning")}>{value}</span>
      {pct != null ? <Meter pct={pct} tone={tone} label={`${label}: ${pct}% used`} /> : null}
      {note ? <span className="text-xs text-muted-foreground">{note}</span> : null}
    </>
  );
  const cls = "flex min-w-0 flex-col gap-2 rounded-xl border bg-card p-4";
  return href ? <Link href={href} className={cn(cls, "hover:border-primary/40")}>{body}</Link> : <div className={cls}>{body}</div>;
}

export function Meter({ pct, tone = "default", label }: { pct: number; tone?: "default" | "warn" | "bad"; label: string }) {
  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-1.5 overflow-hidden rounded-full bg-muted">
      <div className={cn("h-full rounded-full", tone === "bad" ? "bg-destructive" : tone === "warn" ? "bg-warning" : "bg-primary")} style={{ width: `${Math.max(2, pct)}%` }} />
    </div>
  );
}

const LEVEL: Record<HealthLevel, { label: string; variant: "success" | "warning" | "destructive" | "outline" }> = {
  ok: { label: "Healthy", variant: "success" }, warn: { label: "Needs attention", variant: "warning" },
  down: { label: "Not working", variant: "destructive" }, off: { label: "Switched off", variant: "outline" },
};
export function LevelBadge({ level, text }: { level: HealthLevel; text?: string }) {
  return <Badge variant={LEVEL[level].variant}>{text ?? LEVEL[level].label}</Badge>;
}

export function Section({ title, description, actions, children, id }: { title: string; description?: string; actions?: React.ReactNode; children: React.ReactNode; id?: string }) {
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col overflow-hidden rounded-xl border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4">
        <div>
          <h2 id={id} className="text-lg font-semibold">{title}</h2>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

export function duration(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h`;
  return `${Math.round(seconds / 86400)} d`;
}
