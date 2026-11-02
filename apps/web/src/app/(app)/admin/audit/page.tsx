import { requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "Activity log" };

const ACTION_LABELS: Record<string, string> = {
  "bootstrap.completed": "Finished first-time setup",
  "member.invited": "Invited a team member",
  "member.updated": "Changed a team member's role or access",
  "user.created": "Created a user account",
  "user.updated": "Edited a user's details",
  "user.role_changed": "Changed a user's role",
  "user.permissions_changed": "Changed a user's permissions or limits",
  "user.activated": "Activated an account",
  "user.suspended": "Suspended an account",
  "user.deactivated": "Deactivated an account",
  "user.access_reset": "Sent a password reset link",
  "project.assigned": "Assigned a project",
  "project.unassigned": "Removed a project assignment",
  "settings.updated": "Changed system settings",
  "listing.assigned": "Assigned a listing",
  "listing.unassigned": "Removed a listing assignment",
  "photo.deleted": "Deleted a listing photo",
  "listings.insert": "Added a listing",
  "listings.delete": "Deleted a listing",
  "video_projects.insert": "Created a video",
  "video_projects.delete": "Deleted a video",
  "brand_kits.insert": "Created the brand kit",
  "brand_kits.update": "Updated branding",
  "brand_kits.delete": "Deleted a brand kit",
};

export default async function AuditPage() {
  await requirePermission("activity.view");
  const supabase = await createClient();
  const [{ data: events }, { data: people }] = await Promise.all([
    supabase.from("audit_log").select("*").order("id", { ascending: false }).limit(200),
    supabase.from("profiles").select("id,full_name,email"),
  ]);
  const names = new Map((people ?? []).map((p) => [p.id, p.full_name || p.email]));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Activity log" description="The latest 200 changes in your company workspace." />
      <Card>
        <CardContent className="pt-6">
          {events && events.length > 0 ? (
            <ul className="divide-y">
              {events.map((e) => (
                <li key={e.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:gap-6">
                  <span className="w-40 shrink-0 text-sm text-muted-foreground">{formatDateTime(e.created_at)}</span>
                  <span className="w-48 shrink-0 font-medium">{(e.actor_id && names.get(e.actor_id)) || "System"}</span>
                  <span className="text-base">
                    {ACTION_LABELS[e.action] ?? e.action}
                    {e.target_type === "profile" && e.target_id && names.get(e.target_id) ? <span className="text-muted-foreground"> — {names.get(e.target_id)}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-base text-muted-foreground">Nothing has happened yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
