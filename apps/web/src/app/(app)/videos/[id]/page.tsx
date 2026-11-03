import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download, Film, Pencil, Type, Wand2 } from "lucide-react";
import { STILL_NAME, getMove, getStudioMove } from "@lvs/camera-presets";
import { RefreshWhile } from "@/components/video/refresh-while";
import { ORIENTATION_LABELS } from "@/lib/video/easy";
import type { Aspect } from "@/lib/video/plan";
import { requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/storage";
import { formatDateTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PageHeader } from "@/components/page-header";
import { VideoStatusBadge } from "@/components/status-badge";

export const metadata = { title: "Video" };

/** Plain name of a scene's camera: simple move, Camera Studio move ("studio:…"), or AI clip ("ai:…"). */
function moveLabel(id: string | undefined): string {
  if (!id) return STILL_NAME;
  if (id.startsWith("studio:")) return getStudioMove(id.slice(7))?.name ?? "Custom camera";
  if (id.startsWith("ai:")) return `AI clip · ${getStudioMove(id.slice(3))?.name ?? getMove(id.slice(3))?.name ?? "camera"}`;
  return getMove(id)?.name ?? STILL_NAME;
}

interface DocClip { id: string; kind: string; name?: string; start: number; duration: number; cameraMove?: string; props?: { text?: string } }

export default async function VideoPage({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePermission("videos.view");
  const { id } = await params;
  const { created, notes } = await searchParams;
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const { data: video } = await supabase.from("video_projects").select("*").eq("id", id).maybeSingle();
  if (!video) notFound();
  const { data: listing } = video.listing_id
    ? await supabase.from("listings").select("id,address_line").eq("id", video.listing_id).maybeSingle()
    : { data: null };

  const doc = (video.document ?? {}) as { clips?: DocClip[] };
  const clips = (doc.clips ?? []).slice().sort((a, b) => a.start - b.start);
  // scene clips only (brand logos and headshots are on other tracks)
  const photoClips = clips.filter((c) => (c.kind === "image" || c.kind === "video") && (c as { track?: string }).track === "V1");
  const textClips = clips.filter((c) => c.kind === "text");
  const total = clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0);
  const advanced = ctx.profile.ui_mode === "advanced";
  const [{ data: access }, { data: renders }] = await Promise.all([
    supabase.rpc("project_access", { p_project: id }),
    supabase.from("render_jobs").select("id,aspect,status,progress,created_at,width,height,duration_seconds,error_message")
      .eq("project_id", id).order("created_at", { ascending: false }).limit(20),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <RefreshWhile active={(renders ?? []).some((r) => r.status === "queued" || r.status === "running")} />
      <Button variant="ghost" asChild className="self-start"><Link href="/videos"><ArrowLeft aria-hidden="true" />All videos</Link></Button>
      {video.archived_at || video.locked ? (
        <Alert variant="info"><AlertDescription>
          {video.archived_at ? "This video is archived by the Super Admin. It's read-only." : "An administrator locked this video. It's read-only."}
        </AlertDescription></Alert>
      ) : null}
      <PageHeader
        title={video.title}
        description={listing ? `For ${listing.address_line}` : undefined}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <VideoStatusBadge status={video.status} />
            {access === "edit" && video.listing_id ? (
              <Button asChild size="lg" className="bg-brand text-white hover:bg-brand/90"><Link href={`/create?project=${id}&step=3`}><Wand2 aria-hidden="true" />Change with Easy Mode</Link></Button>
            ) : null}
            {access === "edit" ? (
              <Button asChild size="lg" variant="outline"><Link href={`/videos/${id}/edit`}><Pencil aria-hidden="true" />Advanced editor</Link></Button>
            ) : null}
          </div>
        }
      />
      {notes ? (
        <Alert><AlertDescription className="text-base">
          <p className="font-semibold">Please check:</p>
          <ul className="ml-5 list-disc">{notes.split("\n").slice(0, 8).map((n) => <li key={n}>{n}</li>)}</ul>
        </AlertDescription></Alert>
      ) : null}
      {created ? (
        <Alert variant="success"><AlertDescription className="text-base">Your first version is ready: {photoClips.length} scenes, about {Math.round(total)} seconds.</AlertDescription></Alert>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>Finished videos</CardTitle>
          <CardDescription>1080p MP4 files made from this project.</CardDescription>
        </CardHeader>
        <CardContent>
          {renders && renders.length > 0 ? (
            <ul className="divide-y rounded-lg border">
              {renders.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-base">
                  <span className="w-28 font-semibold">{ORIENTATION_LABELS[r.aspect as Aspect]?.label ?? r.aspect}</span>
                  <span className="flex-1 text-muted-foreground">
                    {r.status === "succeeded" ? `${r.width}×${r.height} · ${Math.round(Number(r.duration_seconds ?? 0))} s · ${formatDateTime(r.created_at)}`
                      : r.status === "failed" ? `Didn't finish: ${r.error_message ?? "unknown problem"}`
                      : r.status === "running" ? `Being made… ${Math.round(Number(r.progress) * 100)}%` : "Waiting to start…"}
                  </span>
                  {r.status === "succeeded" && ctx.profile.can_download ? (
                    <Button asChild size="sm"><a href={`/api/projects/${id}/renders/${r.id}/download`}><Download aria-hidden="true" />Download</a></Button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-base text-muted-foreground">
              {access === "edit" ? "No videos made yet. Choose “Change with Easy Mode” and press Generate My Video." : "No finished videos yet."}
            </p>
          )}
          {!ctx.profile.can_download ? <p className="mt-3 text-sm text-muted-foreground">Downloads are turned off for your account.</p> : null}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Scenes</CardTitle>
            <CardDescription>Each photo gets its own gentle camera move.</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="divide-y">
              {photoClips.map((c, i) => (
                <li key={c.id} className="flex min-h-12 items-center gap-3 py-2 text-base">
                  <Film className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="flex-1">Scene {i + 1}</span>
                  <span className="text-muted-foreground">{moveLabel(c.cameraMove)}</span>
                  <span className="w-16 text-right text-muted-foreground">{c.duration.toFixed(1)} s</span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Details</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-3 text-base">
            <p><span className="text-muted-foreground">Shapes:</span> {video.aspect_ratios.join(", ")}</p>
            <p><span className="text-muted-foreground">Length:</span> about {Math.round(total)} seconds</p>
            <p><span className="text-muted-foreground">Last changed:</span> {formatDateTime(video.updated_at)}</p>
            <p><span className="text-muted-foreground">Your access:</span> {access === "edit" ? "Can edit" : "View only"}</p>
            <p><span className="text-muted-foreground">Download:</span> {ctx.profile.can_download ? "Available when the video is finished" : "Not allowed for your account"}</p>
            {textClips.length > 0 ? (
              <div className="flex flex-col gap-2 border-t pt-3">
                <p className="font-semibold">Text on screen</p>
                {textClips.map((t) => (
                  <p key={t.id} className="flex gap-2 text-sm"><Type className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="whitespace-pre-line">{t.props?.text}</span></p>
                ))}
              </div>
            ) : null}
            {advanced ? (
              <p className="border-t pt-3 text-sm text-muted-foreground">Project revision {video.revision} · {clips.length} clips · FableCut document</p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
