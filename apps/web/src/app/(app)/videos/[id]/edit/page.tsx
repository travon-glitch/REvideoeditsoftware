import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Wand2 } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { BUCKETS, isUuid } from "@/lib/storage";
import { signedUrlMap } from "@/lib/storage-server";
import { currentPlan, loadProjectAssets } from "@/lib/video/editor-data";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { VideoEditor, type EditorRender } from "./video-editor";

export const metadata = { title: "Edit video" };

export default async function EditVideoPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePermission("videos.create");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const db = await createClient();
  const { data: project } = await db.from("video_projects").select("*").eq("id", id).maybeSingle();
  if (!project) notFound();
  // The database decides who may edit (owner, assigned with edit access, or the Super Admin).
  const { data: access } = await db.rpc("project_access", { p_project: id });
  if (access !== "edit") redirect(`/videos/${id}`);

  const [{ data: listing }, assets, { data: renders }] = await Promise.all([
    project.listing_id ? db.from("listings").select("*").eq("id", project.listing_id).maybeSingle() : Promise.resolve({ data: null }),
    loadProjectAssets(db, project),
    db.from("render_jobs").select("id,aspect,status,progress,error_message,created_at,duration_seconds,width,height")
      .eq("project_id", id).order("created_at", { ascending: false }).limit(30),
  ]);
  const plan = currentPlan(project, listing, assets);
  const [photoUrls, musicUrls, clipUrls] = await Promise.all([
    signedUrlMap(BUCKETS.listingMedia, assets.photos.flatMap((p) => [p.storage_path, p.thumbnail_path ?? ""]), 4 * 3600),
    signedUrlMap(BUCKETS.projectMedia, assets.music.map((m) => m.storage_path), 4 * 3600),
    signedUrlMap(BUCKETS.aiClips, assets.clips.map((c) => c.storage_path), 4 * 3600),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" asChild><Link href={`/videos/${id}`}><ArrowLeft aria-hidden="true" />Back to video</Link></Button>
        {project.listing_id ? <Button variant="outline" asChild><Link href={`/create?project=${id}&step=4`}><Wand2 aria-hidden="true" />Back to Easy Mode</Link></Button> : null}
      </div>
      <PageHeader title={project.title} description={listing ? `From ${listing.address_line || "your listing"} · changes save automatically` : undefined} />
      {assets.photos.length === 0 ? (
        <p className="text-base text-muted-foreground">This video&apos;s listing has no photos. Add photos to the listing first.</p>
      ) : (
        <VideoEditor
          projectId={id}
          orgId={ctx.organization.id}
          initialPlan={plan}
          initialRevision={project.revision}
          photos={assets.photos.map((p) => ({
            id: p.id, url: photoUrls[p.storage_path] ?? null, thumb: (p.thumbnail_path && photoUrls[p.thumbnail_path]) || null, file_name: p.file_name,
          }))}
          initialMusic={assets.music.map((m) => ({ ...m, url: musicUrls[m.storage_path] ?? null }))}
          initialRenders={(renders ?? []) as EditorRender[]}
          brandColor={ctx.brandKit?.primary_color ?? "#1D4ED8"}
          canDownload={ctx.profile.can_download}
          clips={assets.clips.map((c) => ({ id: c.id, url: clipUrls[c.storage_path] ?? null }))}
        />
      )}
    </div>
  );
}
