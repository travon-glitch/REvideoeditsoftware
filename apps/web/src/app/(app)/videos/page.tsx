import Link from "next/link";
import { Clapperboard } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/roles";
import { formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { VideoStatusBadge } from "@/components/status-badge";
import { CreateVideoButton } from "@/components/app/create-video-button";

export const metadata = { title: "My Videos" };

export default async function VideosPage() {
  const ctx = await requirePermission("videos.view");
  const supabase = await createClient();
  // The database returns only projects this person may see: their own, ones assigned to them, or all for admins.
  const [{ data: videos }, { data: mine }] = await Promise.all([
    supabase.from("video_projects").select("id,title,status,aspect_ratios,updated_at,created_by")
      .neq("status", "archived").order("updated_at", { ascending: false }).limit(200),
    supabase.from("project_members").select("project_id,access").eq("user_id", ctx.userId),
  ]);
  const assigned = new Map((mine ?? []).map((m) => [m.project_id, m.access]));
  const canCreate = can(ctx.profile.role, "videos.create");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="My Videos" description="Drafts, videos being made, and finished videos." actions={canCreate ? <CreateVideoButton /> : null} />
      {videos && videos.length > 0 ? (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {videos.map((v) => (
            <li key={v.id}>
              <Link href={`/videos/${v.id}`} className="flex h-full flex-col gap-3 rounded-xl border bg-card p-5 hover:border-primary/40">
                <div className="flex aspect-video items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <Clapperboard className="size-8" aria-hidden="true" />
                </div>
                <p className="text-lg font-semibold leading-snug">{v.title}</p>
                <div className="mt-auto flex flex-wrap items-center gap-2">
                  <VideoStatusBadge status={v.status} />
                  {assigned.has(v.id) ? <Badge variant="outline">{assigned.get(v.id) === "editor" ? "Assigned · can edit" : "Assigned · view only"}</Badge> : null}
                  <span className="text-sm text-muted-foreground">{v.aspect_ratios.join(" · ")}</span>
                  <span className="ml-auto text-sm text-muted-foreground">{formatDate(v.updated_at)}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={Clapperboard} title="No videos yet" description={canCreate ? "Create your first listing video in a few steps." : "Videos appear here when an administrator assigns them to you."} action={canCreate ? <CreateVideoButton /> : undefined} />
      )}
    </div>
  );
}
