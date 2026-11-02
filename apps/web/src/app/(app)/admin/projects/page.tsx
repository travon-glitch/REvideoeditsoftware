import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { VideoStatusBadge } from "@/components/status-badge";

export const metadata = { title: "Company videos" };

const ACTIVITY_LABELS: Record<string, string> = {
  "video_projects.insert": "created a video",
  "video_projects.delete": "deleted a video",
  "project.assigned": "assigned a project",
  "project.unassigned": "removed a project assignment",
  "listings.insert": "added a listing",
  "listings.delete": "deleted a listing",
};

/* Admins: every project in the company, who owns it, who it's assigned to, and recent activity. */
export default async function CompanyProjectsPage() {
  await requirePermission("activity.view");
  const supabase = await createClient();
  const [{ data: projects }, { data: members }, { data: people }, { data: activity }] = await Promise.all([
    supabase.from("video_projects").select("id,title,status,created_by,updated_at").order("updated_at", { ascending: false }).limit(300),
    supabase.from("project_members").select("project_id,user_id,access"),
    supabase.from("profiles").select("id,full_name,email"),
    supabase.from("audit_log").select("id,action,actor_id,created_at").in("action", Object.keys(ACTIVITY_LABELS))
      .order("id", { ascending: false }).limit(30),
  ]);
  const name = new Map((people ?? []).map((p) => [p.id, p.full_name || p.email]));
  const assigned = new Map<string, string[]>();
  for (const m of members ?? []) assigned.set(m.project_id, [...(assigned.get(m.project_id) ?? []), name.get(m.user_id) ?? "Someone"]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Company videos" description="Every video project, who owns it and who it's shared with. Assign projects from a person's page in Users." />
      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[720px] text-left text-base">
            <thead className="border-b bg-muted/50 text-sm text-muted-foreground">
              <tr>
                <th className="px-5 py-3 font-semibold">Video</th>
                <th className="px-3 py-3 font-semibold">Owner</th>
                <th className="px-3 py-3 font-semibold">Shared with</th>
                <th className="px-3 py-3 font-semibold">Status</th>
                <th className="px-5 py-3 font-semibold">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {(projects ?? []).map((p) => (
                <tr key={p.id}>
                  <td className="px-5 py-3"><Link href={`/videos/${p.id}`} className="font-medium hover:text-primary">{p.title}</Link></td>
                  <td className="px-3 py-3">{(p.created_by && name.get(p.created_by)) || "—"}</td>
                  <td className="px-3 py-3 text-sm">{assigned.get(p.id)?.join(", ") || <span className="text-muted-foreground">Nobody</span>}</td>
                  <td className="px-3 py-3"><VideoStatusBadge status={p.status} /></td>
                  <td className="px-5 py-3 text-sm text-muted-foreground">{formatDate(p.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {projects && projects.length === 0 ? <p className="px-5 py-8 text-base text-muted-foreground">No videos yet.</p> : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Recent video activity</CardTitle></CardHeader>
        <CardContent>
          {activity && activity.length > 0 ? (
            <ul className="divide-y">
              {activity.map((a) => (
                <li key={a.id} className="flex flex-wrap gap-4 py-2 text-base">
                  <span className="w-40 text-sm text-muted-foreground">{formatDateTime(a.created_at)}</span>
                  <span><strong>{(a.actor_id && name.get(a.actor_id)) || "System"}</strong> {ACTIVITY_LABELS[a.action] ?? a.action}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-base text-muted-foreground">No activity yet.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
