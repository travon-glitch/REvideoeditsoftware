import Link from "next/link";
import { UserPlus } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { ROLE_LABELS, USER_STATUSES, canManageUser } from "@/lib/auth/roles";
import { formatDate } from "@/lib/utils";
import { UserStatusBadge } from "@/components/user-status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "Users" };

export default async function UsersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePermission("users.manage");
  const { status } = await searchParams;
  const supabase = await createClient();
  let query = supabase.from("profiles").select("*").order("last_name").order("first_name");
  const statusFilter = USER_STATUSES.find((s) => s === status);
  if (statusFilter) query = query.eq("status", statusFilter);
  const [{ data: users }, { data: members }] = await Promise.all([
    query,
    supabase.from("project_members").select("user_id"),
  ]);
  const projectCount = new Map<string, number>();
  for (const m of members ?? []) projectCount.set(m.user_id, (projectCount.get(m.user_id) ?? 0) + 1);
  const actor = { id: ctx.userId, role: ctx.profile.role };
  const filters = [["", "Everyone"], ["active", "Active"], ["invited", "Invited"], ["suspended", "Suspended"], ["deactivated", "Deactivated"]] as const;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Users"
        description="Only people you add can use this system. There is no public sign-up."
        actions={<Button asChild size="lg"><Link href="/admin/users/new"><UserPlus aria-hidden="true" />Create user</Link></Button>}
      />
      <nav aria-label="Filter by status" className="flex flex-wrap gap-2">
        {filters.map(([v, label]) => (
          <Button key={v} asChild size="sm" variant={(status ?? "") === v ? "default" : "outline"}>
            <Link href={v ? `/admin/users?status=${v}` : "/admin/users"}>{label}</Link>
          </Button>
        ))}
      </nav>
      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[720px] text-left text-base">
            <thead className="border-b bg-muted/50 text-sm text-muted-foreground">
              <tr>
                <th className="px-5 py-3 font-semibold">Name</th>
                <th className="px-3 py-3 font-semibold">Role</th>
                <th className="px-3 py-3 font-semibold">Status</th>
                <th className="px-3 py-3 font-semibold">Projects</th>
                <th className="px-3 py-3 font-semibold">Added</th>
                <th className="px-5 py-3"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {(users ?? []).map((u) => (
                <tr key={u.id}>
                  <td className="px-5 py-4">
                    <p className="font-semibold">{u.full_name || u.email} {u.id === ctx.userId ? <span className="font-normal text-muted-foreground">(you)</span> : null}</p>
                    <p className="text-sm text-muted-foreground">{u.email}{u.job_title ? ` · ${u.job_title}` : ""}</p>
                  </td>
                  <td className="px-3 py-4">{ROLE_LABELS[u.role]}</td>
                  <td className="px-3 py-4"><UserStatusBadge status={u.status} /></td>
                  <td className="px-3 py-4">{u.role === "admin" || u.role === "super_admin" ? "All" : projectCount.get(u.id) ?? 0}</td>
                  <td className="px-3 py-4 text-sm text-muted-foreground">{formatDate(u.created_at)}</td>
                  <td className="px-5 py-4 text-right">
                    {canManageUser(actor, { id: u.id, role: u.role }) ? (
                      <Button asChild variant="outline" size="sm"><Link href={`/admin/users/${u.id}`}>Manage</Link></Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {users && users.length === 0 ? <p className="px-5 py-8 text-base text-muted-foreground">Nobody matches this filter.</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}
