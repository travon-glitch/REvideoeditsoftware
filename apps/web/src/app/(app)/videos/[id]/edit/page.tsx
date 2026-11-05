import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Wand2 } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { BUCKETS, isUuid } from "@/lib/storage";
import { signMusicUrls, signedUrlMap } from "@/lib/storage-server";
import { currentPlan, loadProjectAssets } from "@/lib/video/editor-data";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { VideoEditor, type EditorRender } from "./video-editor";
import { toEasyListing } from "@/lib/video/project-store";
import { VOICE_LIST } from "@/lib/video/voice-store";
import { voiceEngine } from "@/lib/video/voice-engine";
import { videoMakerStatus } from "@/lib/video-maker";
import { getStudioMove } from "@lvs/camera-presets";
import { parseCamera } from "@/lib/storage-server";

export const metadata = { title: "Edit video" };

export default async function EditVideoPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePermission("videos.create");
  const { id } = await params;
  const { mode } = await searchParams;
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
  // AI clips people may use: finished, and not marked as having a problem
  const { data: clipMeta } = assets.clips.length
    ? await db.from("media_assets").select("id,camera_spec,ai_decision").in("id", assets.clips.map((c) => c.id))
    : { data: [] };
  const clipRows = assets.clips.flatMap((c) => {
    const meta = (clipMeta ?? []).find((m) => m.id === c.id);
    const decision = (meta?.ai_decision as { decision?: string } | null)?.decision;
    return decision === "problem" ? [] : [{ ...c, camera_spec: meta?.camera_spec ?? null }];
  });
  const [photoUrls, musicUrls, clipUrls] = await Promise.all([
    signedUrlMap(BUCKETS.listingMedia, assets.photos.flatMap((p) => [p.storage_path, p.thumbnail_path ?? ""]), 4 * 3600),
    signMusicUrls(assets.music.map((m) => m.storage_path), 4 * 3600),
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
          clips={clipRows.map((c) => ({
            id: c.id, url: clipUrls[c.storage_path] ?? null, sourceAssetId: c.source_asset_id, duration: c.duration_seconds == null ? null : Number(c.duration_seconds),
            label: `${getStudioMove(parseCamera(c.camera_spec)?.move ?? "")?.name ?? "AI clip"} · photo ${(assets.photos.findIndex((p) => p.id === c.source_asset_id) + 1) || "?"}`,
          }))}
          initialMode={mode === "advanced" || mode === "easy" ? mode : ctx.profile.ui_mode === "advanced" ? "advanced" : "easy"}
          listing={listing ? toEasyListing(listing) : null}
          brand={{ company_name: ctx.brandKit?.company_name ?? null, outro_text: ctx.brandKit?.outro_text ?? null }}
          voices={VOICE_LIST}
          voiceReady={await voiceEngine().status()}
          maker={await videoMakerStatus()}
        />
      )}
    </div>
  );
}
