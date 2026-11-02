import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import {
  ROLE_LABELS, allowedStatusChanges, assignableRoles, canManageUser,
} from "@/lib/auth/roles";
import { isUuid } from "@/lib/storage";
import { formatDateTime } from "@/lib/utils";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { UserStatusBadge } from "@/components/user-status-badge";
import {
  AssignListingForm, AssignProjectForm, EditUserForm, ResetAccessButton, StatusButtons, UnassignButton, UnassignListingButton,
} from "../user-forms";
import { BatchPermissionToggle } from "./batch-permission";

export const metadata = { title: "Manage user" };

const ACTION_LABELS: Record<string, string> = {
  "user.created": "Account created",
  "user.updated": "Details edited",
  "user.role_changed": "Role changed",
  "user.permissions_changed": "Permissions or limits changed",
  "user.activated": "Activated",
  "user.suspended": "Suspended",
  "user.deactivated": "Deactivated",
  "user.access_reset": "Password link sent",
  "user.batch_permission": "Generate 6 Videos permission changed",
};

export default async function ManageUserPage({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePermission("users.manage");
  const { id } = await params;
  const { created } = await searchParams;
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const { data: user } = await supabase.from("profiles").select("*").eq("id", id).maybeSingle();
  if (!user) notFound();
  const actor = { id: ctx.userId, role: ctx.profile.role };
  const manageable = canManageUser(actor, { id: user.id, role: user.role });

  const [{ data: memberships }, { data: projects }, { data: history }, { data: listingMemberships }, { data: listings }] = await Promise.all([
    supabase.from("project_members").select("*").eq("user_id", id).order("created_at"),
    supabase.from("video_projects").select("id,title,created_by").neq("status", "archived").order("updated_at", { ascending: false }).limit(500),
    supabase.from("audit_log").select("id,action,created_at,actor_id").eq("target_id", id).order("id", { ascending: false }).limit(20),
    supabase.from("listing_members").select("*").eq("user_id", id).order("created_at"),
    supabase.from("listings").select("id,address_line,city,created_by").order("updated_at", { ascending: false }).limit(500),
  ]);
  const listingLabel = new Map((listings ?? []).map((l) => [l.id, [l.address_line || "Untitled listing", l.city].filter(Boolean).join(", ")]));
  const assignedListings = new Set((listingMemberships ?? []).map((m) => m.listing_id));
  const assignableListings = (listings ?? [])
    .filter((l) => !assignedListings.has(l.id) && l.created_by !== id)
    .map((l) => ({ id: l.id, label: listingLabel.get(l.id)! }));
  const titles = new Map((projects ?? []).map((p) => [p.id, p.title]));
  const assigned = new Set((memberships ?? []).map((m) => m.project_id));
  const assignable = (projects ?? []).filter((p) => !assigned.has(p.id) && p.created_by !== id);
  const seesAll = user.role === "admin" || user.role === "super_admin";

  return (
    <div className="flex flex-col gap-6">
      <Button variant="ghost" asChild className="self-start"><Link href="/admin/users"><ArrowLeft aria-hidden="true" />All users</Link></Button>
      <PageHeader
        title={user.full_name || user.email}
        description={`${user.email}${user.job_title ? ` · ${user.job_title}` : ""}`}
        actions={<div className="flex gap-2"><Badge variant="secondary">{ROLE_LABELS[user.role]}</Badge><UserStatusBadge status={user.status} /></div>}
      />
      {created ? (
        <Alert variant="success"><AlertDescription className="text-base">Account created. An invitation email is on its way to {user.email}. Next, assign them a project below.</AlertDescription></Alert>
      ) : null}
      {!manageable ? (
        <Alert variant="info"><AlertDescription className="text-base">You can view this account but not change it.</AlertDescription></Alert>
      ) : null}

      {manageable ? (
        <Card>
          <CardHeader><CardTitle>Details, role and permissions</CardTitle></CardHeader>
          <CardContent>
            <EditUserForm userId={user.id} roles={assignableRoles(ctx.profile.role)} advanced={ctx.profile.ui_mode === "advanced"} values={user} />
          </CardContent>
        </Card>
      ) : null}

      {ctx.profile.role === "super_admin" && user.role !== "viewer" && user.id !== ctx.userId ? (
        <Card>
          <CardHeader>
            <CardTitle>Generate 6 Videos</CardTitle>
            <CardDescription>Super Admin only. Company-wide limits are in System settings.</CardDescription>
          </CardHeader>
          <CardContent><BatchPermissionToggle userId={user.id} allowed={user.can_batch_generate} /></CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Projects</CardTitle>
          <CardDescription>
            {seesAll ? "Admins can see every project in the company." : "This person sees only their own projects and the ones assigned here."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {memberships && memberships.length > 0 ? (
            <ul className="divide-y rounded-lg border">
              {memberships.map((m) => (
                <li key={m.project_id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <Link href={`/videos/${m.project_id}`} className="flex-1 font-medium hover:text-primary">{titles.get(m.project_id) ?? "Project"}</Link>
                  <Badge variant="secondary">{m.access === "editor" ? "Can edit" : "Can view"}</Badge>
                  {manageable ? <UnassignButton userId={user.id} projectId={m.project_id} /> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-base text-muted-foreground">No projects assigned yet.</p>
          )}
          {manageable && user.is_active && !seesAll ? (
            assignable.length > 0
              ? <AssignProjectForm userId={user.id} projects={assignable} viewerOnly={user.role === "viewer"} />
              : <p className="text-base text-muted-foreground">There are no other projects to assign.</p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Listings</CardTitle>
          <CardDescription>{seesAll ? "Admins can see every listing in the company." : "Listings this person can open besides their own."}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {listingMemberships && listingMemberships.length > 0 ? (
            <ul className="divide-y rounded-lg border">
              {listingMemberships.map((m) => (
                <li key={m.listing_id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <Link href={`/listings/${m.listing_id}`} className="flex-1 font-medium hover:text-primary">{listingLabel.get(m.listing_id) ?? "Listing"}</Link>
                  <Badge variant="secondary">{m.access === "editor" ? "Can edit" : "Can view"}</Badge>
                  {manageable ? <UnassignListingButton userId={user.id} listingId={m.listing_id} /> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-base text-muted-foreground">No listings assigned yet.</p>
          )}
          {manageable && user.is_active && !seesAll ? (
            assignableListings.length > 0
              ? <AssignListingForm userId={user.id} listings={assignableListings} viewerOnly={user.role === "viewer"} />
              : <p className="text-base text-muted-foreground">There are no other listings to assign.</p>
          ) : null}
        </CardContent>
      </Card>

      {manageable ? (
        <Card>
          <CardHeader>
            <CardTitle>Account access</CardTitle>
            <CardDescription>
              Suspend to pause access (for example during leave). Deactivate when someone leaves the company.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <StatusButtons userId={user.id} options={allowedStatusChanges(ctx.profile.role, user.status)} />
            <div className="flex flex-col gap-2 border-t pt-6">
              <p className="font-semibold">Reset access</p>
              <p className="text-base text-muted-foreground">Emails a secure, single-use link to set a new password. Passwords are never sent by email.</p>
              <ResetAccessButton userId={user.id} disabled={!user.is_active} />
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader><CardTitle>Account history</CardTitle></CardHeader>
        <CardContent>
          {history && history.length > 0 ? (
            <ul className="divide-y">
              {history.map((h) => (
                <li key={h.id} className="flex flex-wrap gap-4 py-2 text-base">
                  <span className="w-40 text-sm text-muted-foreground">{formatDateTime(h.created_at)}</span>
                  <span>{ACTION_LABELS[h.action] ?? h.action}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-base text-muted-foreground">No changes recorded yet.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
