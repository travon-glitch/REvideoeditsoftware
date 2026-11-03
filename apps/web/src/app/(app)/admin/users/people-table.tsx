"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Ban, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UserStatusBadge } from "@/components/user-status-badge";
import { ROLE_LABELS, assignableRoles, canManageUser, type Role, type UserStatus } from "@/lib/auth/roles";
import { activityLabel, formatBytes } from "@/lib/admin/control";
import type { UserActivityRow } from "@/lib/database.types";
import { quickSetStatus, quickUpdateUser } from "../control-actions";

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");
const limitText = (used: number, limit: number | null) => (limit == null ? `${used} / no limit` : `${used} / ${limit}`);

/**
 * Every authorized person with what they have made and used, and the changes an
 * administrator may make right here. Each change is checked again on the server and in the database.
 */
export function PeopleTable({ rows, actor }: { rows: UserActivityRow[]; actor: { id: string; role: Role } }) {
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; message?: string }>) => start(async () => {
    const r = await fn();
    setMessage({ ok: r.ok, text: r.message ?? (r.ok ? "Saved." : "That didn't work.") });
  });
  const roles = assignableRoles(actor.role);

  return (
    <div className="flex flex-col">
      <p role="status" aria-live="polite" className={`min-h-6 px-5 pt-3 text-sm font-medium ${message?.ok === false ? "text-destructive" : "text-success"}`}>{message?.text ?? ""}</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1180px] text-left text-sm">
          <thead className="border-b bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-5 py-3 font-semibold">Name and role</th>
              <th className="px-3 py-3 font-semibold">Projects</th>
              <th className="px-3 py-3 font-semibold">Videos</th>
              <th className="px-3 py-3 font-semibold">AI generations</th>
              <th className="px-3 py-3 font-semibold">Storage</th>
              <th className="px-3 py-3 font-semibold">Recent activity</th>
              <th className="px-3 py-3 font-semibold">Limits per month</th>
              <th className="px-3 py-3 font-semibold">Downloads / AI</th>
              <th className="px-5 py-3 font-semibold"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((u) => {
              const manageable = canManageUser(actor, { id: u.id, role: u.role });
              const status = u.status as UserStatus;
              return (
                <tr key={u.id} className="align-top">
                  <td className="px-5 py-3">
                    <p className="font-semibold">{u.full_name || u.email}{u.id === actor.id ? <span className="font-normal text-muted-foreground"> (you)</span> : null}</p>
                    <p className="text-muted-foreground">{u.email}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      {manageable && roles.includes(u.role) ? (
                        <select aria-label={`Role for ${u.full_name || u.email}`} defaultValue={u.role} disabled={pending}
                          onChange={(e) => run(() => quickUpdateUser(u.id, { role: e.target.value }))}
                          className="h-8 rounded-md border bg-background px-2 text-sm">
                          {roles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                        </select>
                      ) : <span className="font-medium">{ROLE_LABELS[u.role]}</span>}
                      <UserStatusBadge status={status} />
                    </div>
                  </td>
                  <td className="px-3 py-3 tabular-nums">
                    {u.role === "admin" || u.role === "super_admin" ? <span>All</span> : <span>{Number(u.projects_owned)} own</span>}
                    <span className="block text-muted-foreground">{Number(u.projects_assigned)} assigned · {Number(u.listings_owned)} listings</span>
                  </td>
                  <td className="px-3 py-3 tabular-nums">{Number(u.videos_rendered)} rendered<span className="block text-muted-foreground">{limitText(Number(u.videos_this_month), u.max_videos_per_month)} this month</span></td>
                  <td className="px-3 py-3 tabular-nums">{Number(u.ai_generations_total)} total<span className="block text-muted-foreground">{limitText(Number(u.ai_jobs_this_month), u.max_ai_generations_per_month)} clips this month</span></td>
                  <td className="px-3 py-3 tabular-nums">{formatBytes(Number(u.storage_bytes))}</td>
                  <td className="px-3 py-3">{activityLabel(u.last_activity)}<span className="block text-muted-foreground">{fmtDate(u.last_activity_at)}</span></td>
                  <td className="px-3 py-3">
                    {manageable ? (
                      <div className="flex flex-col gap-1.5">
                        <LimitInput label="Videos" value={u.max_videos_per_month} disabled={pending} onSave={(v) => run(() => quickUpdateUser(u.id, { max_videos_per_month: v }))} />
                        <LimitInput label="AI clips" value={u.max_ai_generations_per_month} disabled={pending} onSave={(v) => run(() => quickUpdateUser(u.id, { max_ai_generations_per_month: v }))} />
                      </div>
                    ) : <span className="text-muted-foreground">{u.max_videos_per_month ?? "No limit"} videos · {u.max_ai_generations_per_month ?? "no limit"} AI</span>}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-col gap-1.5">
                      <Toggle label="May download" checked={u.can_download} disabled={!manageable || pending} onChange={(v) => run(() => quickUpdateUser(u.id, { can_download: v }))} />
                      <Toggle label="May use AI" checked={u.can_use_ai} disabled={!manageable || pending || u.role === "viewer"} onChange={(v) => run(() => quickUpdateUser(u.id, { can_use_ai: v }))} />
                    </div>
                  </td>
                  <td className="px-5 py-3 text-right">
                    {manageable ? (
                      <div className="flex flex-col items-end gap-1.5">
                        <Button asChild variant="outline" size="sm"><Link href={`/admin/users/${u.id}`}>Manage</Link></Button>
                        {status === "active" || status === "invited" ? (
                          <Button size="sm" variant="ghost" className="text-destructive" disabled={pending}
                            onClick={() => { if (window.confirm(`Suspend ${u.full_name || u.email}? They are signed out and lose access right away.`)) run(() => quickSetStatus(u.id, "suspended")); }}>
                            <Ban aria-hidden="true" />Suspend
                          </Button>
                        ) : status === "suspended" ? (
                          <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => quickSetStatus(u.id, "active"))}><CheckCircle2 aria-hidden="true" />Re-activate</Button>
                        ) : null}
                      </div>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Toggle({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 whitespace-nowrap">
      <input type="checkbox" defaultChecked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="size-4 accent-[hsl(var(--primary))]" />
      {label}
    </label>
  );
}

function LimitInput({ label, value, disabled, onSave }: { label: string; value: number | null; disabled: boolean; onSave: (v: number | null) => void }) {
  const [v, setV] = useState(value == null ? "" : String(value));
  const dirty = v !== (value == null ? "" : String(value));
  return (
    <form className="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); onSave(v.trim() === "" ? null : Number(v)); }}>
      <span className="w-14 text-muted-foreground">{label}</span>
      <Input aria-label={`${label} per month`} value={v} onChange={(e) => setV(e.target.value)} inputMode="numeric" placeholder="No limit" className="h-8 w-24 px-2 text-sm" />
      {dirty ? <Button type="submit" size="sm" className="h-8 px-2" disabled={disabled}>Save</Button> : null}
    </form>
  );
}

/** Per-person AI generation limits (AI control panel). */
export function AiLimitsTable({ rows, actor }: { rows: UserActivityRow[]; actor: { id: string; role: Role } }) {
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; message?: string }>) => start(async () => {
    const r = await fn();
    setMessage({ ok: r.ok, text: r.message ?? (r.ok ? "Saved." : "That didn't work.") });
  });
  return (
    <div className="flex flex-col">
      <p role="status" aria-live="polite" className={`min-h-6 px-5 pt-3 text-sm font-medium ${message?.ok === false ? "text-destructive" : "text-success"}`}>{message?.text ?? ""}</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="border-b bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
            <tr><th className="px-5 py-3 font-semibold">Person</th><th className="px-3 py-3 font-semibold">AI allowed</th><th className="px-3 py-3 font-semibold">AI clips this month</th><th className="px-5 py-3 font-semibold">Monthly limit</th></tr>
          </thead>
          <tbody className="divide-y">
            {rows.filter((u) => u.role !== "viewer").map((u) => {
              const manageable = canManageUser(actor, { id: u.id, role: u.role });
              return (
                <tr key={u.id}>
                  <td className="px-5 py-2.5"><span className="font-semibold">{u.full_name || u.email}</span> <span className="text-muted-foreground">· {ROLE_LABELS[u.role]}</span></td>
                  <td className="px-3 py-2.5"><Toggle label={u.can_use_ai ? "Yes" : "No"} checked={u.can_use_ai} disabled={!manageable || pending} onChange={(v) => run(() => quickUpdateUser(u.id, { can_use_ai: v }))} /></td>
                  <td className="px-3 py-2.5 tabular-nums">{Number(u.ai_jobs_this_month)}</td>
                  <td className="px-5 py-2.5">
                    {manageable ? <LimitInput label="Clips" value={u.max_ai_generations_per_month} disabled={pending} onSave={(v) => run(() => quickUpdateUser(u.id, { max_ai_generations_per_month: v }))} />
                      : <span className="text-muted-foreground">{u.max_ai_generations_per_month ?? "No limit"}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
