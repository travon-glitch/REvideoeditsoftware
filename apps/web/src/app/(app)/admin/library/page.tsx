import Link from "next/link";
import { Lock, Search, Shield } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { BUCKETS } from "@/lib/storage";
import { LIBRARY_PAGE_SIZE, librarySearchSchema, safeSearch } from "@/lib/admin/control";
import { formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { PageHeader } from "@/components/page-header";
import { VideoStatusBadge } from "@/components/status-badge";
import { Section } from "../control-parts";
import { LibraryActions } from "./library-actions";

export const metadata = { title: "Company video library" };

/*
 * Every video in the company (the Super Admin sees all of them, including restricted ones;
 * other administrators see all but restricted ones). Filters run in the database.
 */
export default async function CompanyLibraryPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePermission("activity.view");
  const superAdmin = can(ctx.profile.role, "projects.all");
  const f = librarySearchSchema.parse(await searchParams);
  const db = await createClient();

  const [{ data: people }, { data: templates }] = await Promise.all([
    db.from("profiles").select("id,full_name,email,role,status").order("last_name"),
    db.from("video_templates").select("id,name").order("sort_order"),
  ]);

  let listingIds: string[] = [];
  const q = f.q ? safeSearch(f.q) : "";
  if (q) {
    const { data: ls } = await db.from("listings").select("id").or(`address_line.ilike.%${q}%,city.ilike.%${q}%,postal_code.ilike.%${q}%`).limit(500);
    listingIds = (ls ?? []).map((l) => l.id);
  }

  let query = db.from("video_projects")
    .select("id,title,status,created_by,created_at,listing_id,template_id,restricted,locked,archived_at", { count: "exact" })
    .order("created_at", { ascending: false });
  if (f.show === "active") query = query.is("archived_at", null);
  if (f.show === "archived") query = query.not("archived_at", "is", null);
  if (f.owner) query = query.eq("created_by", f.owner);
  if (f.template) query = query.eq("template_id", f.template);
  if (f.from) query = query.gte("created_at", `${f.from}T00:00:00Z`);
  if (f.to) query = query.lte("created_at", `${f.to}T23:59:59.999Z`);
  if (q) query = query.or(listingIds.length ? `title.ilike.%${q}%,listing_id.in.(${listingIds.join(",")})` : `title.ilike.%${q}%`);
  const offset = (f.page - 1) * LIBRARY_PAGE_SIZE;
  const { data: projects, count } = await query.range(offset, offset + LIBRARY_PAGE_SIZE - 1);
  const list = projects ?? [];

  const ids = list.map((p) => p.id);
  const lids = [...new Set(list.map((p) => p.listing_id).filter((x): x is string => !!x))];
  const [{ data: renders }, { data: listings }] = await Promise.all([
    ids.length ? db.from("render_jobs").select("id,project_id,aspect,duration_seconds,output_path,finished_at").in("project_id", ids).eq("status", "succeeded").order("finished_at", { ascending: false }) : Promise.resolve({ data: [] }),
    lids.length ? db.from("listings").select("id,address_line,city,state").in("id", lids) : Promise.resolve({ data: [] }),
  ]);
  const latest = new Map<string, NonNullable<typeof renders>[number]>();
  for (const r of renders ?? []) if (!latest.has(r.project_id)) latest.set(r.project_id, r);
  const paths = [...latest.values()].map((r) => r.output_path).filter((p): p is string => !!p);
  const { data: signed } = paths.length ? await db.storage.from(BUCKETS.videoExports).createSignedUrls(paths, 3600) : { data: [] };
  const urlOf = new Map((signed ?? []).filter((s) => s.signedUrl).map((s) => [s.path, s.signedUrl]));
  const listingOf = new Map((listings ?? []).map((l) => [l.id, [l.address_line, l.city, l.state].filter(Boolean).join(", ")]));
  const nameOf = new Map((people ?? []).map((p) => [p.id, p.full_name || p.email]));
  const templateOf = new Map((templates ?? []).map((t) => [t.id, t.name]));
  const owners = (people ?? []).filter((p) => p.role !== "viewer" && (p.status === "active" || p.status === "invited")).map((p) => ({ id: p.id, name: p.full_name || p.email }));
  const pages = Math.max(1, Math.ceil((count ?? 0) / LIBRARY_PAGE_SIZE));
  const link = (page: number) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...f, page })) if (v && !(k === "show" && v === "active") && !(k === "page" && v === 1)) p.set(k, String(v));
    return `/admin/library${p.size ? `?${p}` : ""}`;
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Company video library"
        description={superAdmin ? "Every video in the company. Preview, download, reassign, restrict, lock, archive or delete." : "Every video you can see as an administrator. Only the Super Admin can reassign, archive or delete."} />
      <form method="get" className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-6" role="search" aria-label="Search videos">
        <label className="flex flex-col gap-1 text-sm font-medium lg:col-span-2">Property address
          <span className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input name="q" defaultValue={f.q ?? ""} placeholder="Street, city or ZIP" className="pl-9" /></span>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">Employee
          <NativeSelect name="owner" defaultValue={f.owner ?? ""}><option value="">Everyone</option>{(people ?? []).map((p) => <option key={p.id} value={p.id}>{p.full_name || p.email}</option>)}</NativeSelect>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">Template
          <NativeSelect name="template" defaultValue={f.template ?? ""}><option value="">Any template</option>{(templates ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</NativeSelect>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">From<Input type="date" name="from" defaultValue={f.from ?? ""} /></label>
        <label className="flex flex-col gap-1 text-sm font-medium">To<Input type="date" name="to" defaultValue={f.to ?? ""} /></label>
        <label className="flex flex-col gap-1 text-sm font-medium">Show
          <NativeSelect name="show" defaultValue={f.show}><option value="active">Current videos</option><option value="archived">Archived</option><option value="all">All</option></NativeSelect>
        </label>
        <div className="flex items-end gap-2 lg:col-span-5">
          <Button type="submit">Search</Button>
          <Button asChild variant="ghost"><Link href="/admin/library">Clear</Link></Button>
        </div>
      </form>

      <Section title={`${count ?? 0} ${count === 1 ? "video" : "videos"}`} id="videos" description={pages > 1 ? `Page ${f.page} of ${pages}` : undefined}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] text-left text-sm">
            <thead className="border-b bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
              <tr><th className="px-5 py-3">Video and property</th><th className="px-3 py-3">Employee</th><th className="px-3 py-3">Template</th><th className="px-3 py-3">Created</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Latest render</th><th className="px-5 py-3 text-right">Actions</th></tr>
            </thead>
            <tbody className="divide-y">
              {list.map((p) => {
                const r = latest.get(p.id);
                return (
                  <tr key={p.id} className="align-top">
                    <td className="px-5 py-3">
                      <Link href={`/videos/${p.id}`} className="font-semibold hover:text-primary">{p.title}</Link>
                      <span className="block text-muted-foreground">{(p.listing_id && listingOf.get(p.listing_id)) || "No listing"}</span>
                      <span className="mt-1 flex flex-wrap gap-1">
                        {p.restricted ? <Badge variant="warning"><Shield className="mr-1 size-3" aria-hidden="true" />Restricted</Badge> : null}
                        {p.locked ? <Badge variant="outline"><Lock className="mr-1 size-3" aria-hidden="true" />Locked</Badge> : null}
                        {p.archived_at ? <Badge variant="secondary">Archived {formatDate(p.archived_at)}</Badge> : null}
                      </span>
                    </td>
                    <td className="px-3 py-3">{(p.created_by && nameOf.get(p.created_by)) || "—"}</td>
                    <td className="px-3 py-3">{(p.template_id && templateOf.get(p.template_id)) || <span className="text-muted-foreground">None</span>}</td>
                    <td className="whitespace-nowrap px-3 py-3">{formatDate(p.created_at)}</td>
                    <td className="px-3 py-3"><VideoStatusBadge status={p.status} /></td>
                    <td className="px-3 py-3">{r ? <>{r.aspect}<span className="block text-muted-foreground">{r.duration_seconds ? `${Math.round(Number(r.duration_seconds))} s · ` : ""}{r.finished_at ? formatDate(r.finished_at) : ""}</span></> : <span className="text-muted-foreground">Not rendered</span>}</td>
                    <td className="px-5 py-3">
                      <LibraryActions superAdmin={superAdmin} people={owners} item={{
                        id: p.id, title: p.title, ownerId: p.created_by, restricted: p.restricted, locked: p.locked, archived: !!p.archived_at,
                        previewUrl: r?.output_path ? urlOf.get(r.output_path) ?? null : null,
                        downloadHref: r ? `/api/projects/${p.id}/renders/${r.id}/download` : null,
                      }} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {list.length === 0 ? <p className="px-5 py-8 text-base text-muted-foreground">No videos match.</p> : null}
        </div>
        {pages > 1 ? (
          <nav aria-label="Pages" className="flex items-center justify-between border-t px-5 py-3 text-sm">
            {f.page > 1 ? <Button asChild size="sm" variant="outline"><Link href={link(f.page - 1)}>Previous</Link></Button> : <span />}
            <span>Page {f.page} of {pages}</span>
            {f.page < pages ? <Button asChild size="sm" variant="outline"><Link href={link(f.page + 1)}>Next</Link></Button> : <span />}
          </nav>
        ) : null}
      </Section>
    </div>
  );
}
