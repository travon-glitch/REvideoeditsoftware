import Link from "next/link";
import { UserPlus } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { USER_STATUSES } from "@/lib/auth/roles";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import type { UserActivityRow } from "@/lib/database.types";
import { Section } from "../control-parts";
import { PeopleTable } from "./people-table";

export const metadata = { title: "People and activity" };

export default async function UsersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePermission("users.manage");
  const { status } = await searchParams;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_user_activity");
  const statusFilter = USER_STATUSES.find((s) => s === status);
  const rows = ((data ?? []) as UserActivityRow[]).filter((u) => !statusFilter || u.status === statusFilter);
  const filters = [["", "Everyone"], ["active", "Active"], ["invited", "Invited"], ["suspended", "Suspended"], ["deactivated", "Deactivated"]] as const;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="People and activity"
        description="Only people you add can use this system. Change a role, limit or permission right in the table; open Manage to assign listings and projects or reset access."
        actions={<Button asChild size="lg"><Link href="/admin/users/new"><UserPlus aria-hidden="true" />Add employee</Link></Button>}
      />
      <nav aria-label="Filter by status" className="flex flex-wrap gap-2">
        {filters.map(([v, label]) => (
          <Button key={v} asChild size="sm" variant={(status ?? "") === v ? "default" : "outline"}>
            <Link href={v ? `/admin/users?status=${v}` : "/admin/users"}>{label}</Link>
          </Button>
        ))}
      </nav>
      <Section title={`${rows.length} ${rows.length === 1 ? "person" : "people"}`} id="people"
        description="Videos and AI counts include everything the person made. Storage is the files they uploaded or generated.">
        {error ? <p className="px-5 py-6 text-destructive">Activity couldn&apos;t be loaded.</p>
          : rows.length ? <PeopleTable rows={rows} actor={{ id: ctx.userId, role: ctx.profile.role }} />
          : <p className="px-5 py-8 text-base text-muted-foreground">Nobody matches this filter.</p>}
      </Section>
    </div>
  );
}
