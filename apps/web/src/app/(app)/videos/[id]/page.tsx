import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Film, Type } from "lucide-react";
import { getMove } from "@lvs/camera-presets";
import { requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/storage";
import { formatDateTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PageHeader } from "@/components/page-header";
import { VideoStatusBadge } from "@/components/status-badge";
import { ComingSoonNote } from "@/components/coming-soon";

export const metadata = { title: "Video" };

interface DocClip { id: string; kind: string; name?: string; start: number; duration: number; cameraMove?: string; props?: { text?: string } }

export default async function VideoPage({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePermission("videos.view");
  const { id } = await params;
  const { created } = await searchParams;
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const { data: video } = await supabase.from("video_projects").select("*").eq("id", id).maybeSingle();
  if (!video) notFound();
  const { data: listing } = video.listing_id
    ? await supabase.from("listings").select("id,address_line").eq("id", video.listing_id).maybeSingle()
    : { data: null };

  const doc = (video.document ?? {}) as { clips?: DocClip[] };
  const clips = (doc.clips ?? []).slice().sort((a, b) => a.start - b.start);
  const photoClips = clips.filter((c) => c.kind === "image" || c.kind === "video");
  const textClips = clips.filter((c) => c.kind === "text");
  const total = clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0);
  const advanced = ctx.profile.ui_mode === "advanced";
  const { data: access } = await supabase.rpc("project_access", { p_project: id });

  return (
    <div className="flex flex-col gap-6">
      <Button variant="ghost" asChild className="self-start"><Link href="/videos"><ArrowLeft aria-hidden="true" />All videos</Link></Button>
      <PageHeader title={video.title} description={listing ? `For ${listing.address_line}` : undefined} actions={<VideoStatusBadge status={video.status} />} />
      {created ? (
        <Alert variant="success"><AlertDescription className="text-base">Your first version is ready: {photoClips.length} scenes, about {Math.round(total)} seconds.</AlertDescription></Alert>
      ) : null}
      <ComingSoonNote>
        The video editor and &ldquo;Make my video&rdquo; button are being connected next. Your scenes are saved and will open in the editor automatically.
      </ComingSoonNote>

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
                  <span className="text-muted-foreground">{getMove(c.cameraMove ?? "")?.name ?? "Still"}</span>
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
