import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CircleCheck, Download, Film, LoaderCircle, Music, Pencil, ShieldCheck, Sparkles, TriangleAlert, Type } from "lucide-react";
import { getStudioMove } from "@lvs/camera-presets";
import { requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/storage";
import { directorRunView } from "@/lib/director/run";
import { DIRECTOR_STYLE_INFO, ROOM_LABELS, type DirectorStyle, type PhotoAnalysis, type Storyboard } from "@/lib/director/schema";
import type { CompileWarning, CompiledStoryboard } from "@/lib/director/compile";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RefreshWhile } from "@/components/video/refresh-while";

export const metadata = { title: "AI Director" };

export default async function DirectorRunPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePermission("videos.view");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const view = await directorRunView(await createClient(), id);
  if (!view) notFound();
  const { run, thumbs, render } = view;
  const analysis = run.analysis as unknown as PhotoAnalysis | null;
  const sb = run.storyboard as unknown as { raw: Storyboard; director: CompiledStoryboard["director"]; refs: { ref: string }[] } | null;
  const warnings = (run.warnings ?? []) as unknown as CompileWarning[];
  const style = DIRECTOR_STYLE_INFO[run.style as DirectorStyle];
  const usage = run.usage as { input_tokens?: number; output_tokens?: number };
  const rendering = render?.status === "queued" || render?.status === "running";

  return (
    <div className="flex flex-col gap-6">
      <RefreshWhile active={rendering} />
      <Link href={run.listing_id ? `/listings/${run.listing_id}` : "/videos"} className="flex items-center gap-1 text-sm font-semibold text-primary"><ArrowLeft className="size-4" aria-hidden="true" />Back</Link>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold text-brand"><Sparkles className="size-4" aria-hidden="true" />AI Director · {style?.label} · {run.model}</p>
          <h1 className="text-3xl font-bold tracking-tight">{sb?.director.title ?? "Your video plan"}</h1>
          <p className="text-base text-muted-foreground">
            {run.photo_count} photos analysed · {sb ? `${sb.raw.scenes.length} scenes planned` : ""} · {(usage.input_tokens ?? 0).toLocaleString()} in / {(usage.output_tokens ?? 0).toLocaleString()} out tokens · ${(Number(run.cost_cents) / 100).toFixed(2)}
          </p>
        </div>
        {run.project_id ? (
          <Button asChild size="lg" variant="outline"><Link href={`/videos/${run.project_id}/edit`}><Pencil aria-hidden="true" />Inspect or edit the storyboard</Link></Button>
        ) : null}
      </div>

      {run.status === "failed" ? <Alert variant="destructive"><AlertDescription className="text-base">{run.error_message ?? "The AI Director couldn't finish."}</AlertDescription></Alert> : null}
      {run.status === "running" ? <Alert><AlertDescription className="flex items-center gap-2 text-base"><LoaderCircle className="size-5 animate-spin" aria-hidden="true" />Claude is still working on this plan…</AlertDescription></Alert> : null}

      {run.project_id ? (
        <Card>
          <CardHeader><CardTitle>Your video</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-3" aria-live="polite">
            {!render ? <p className="text-base text-muted-foreground">{run.error_message ?? "Not rendering yet."}</p> : null}
            {render?.status === "queued" ? <p className="flex items-center gap-2 text-base"><LoaderCircle className="size-5 animate-spin" aria-hidden="true" />Waiting for a free renderer…</p> : null}
            {render?.status === "running" ? <p className="flex items-center gap-2 text-base"><LoaderCircle className="size-5 animate-spin" aria-hidden="true" />Rendering the real video… {Math.round(Number(render.progress) * 100)}%</p> : null}
            {render?.status === "failed" ? <p className="flex items-center gap-2 text-base text-destructive"><TriangleAlert className="size-5" aria-hidden="true" />Didn&apos;t finish: {render.error_message}</p> : null}
            {render?.status === "succeeded" ? (
              <>
                <p className="flex items-center gap-2 text-base font-semibold text-success"><CircleCheck className="size-5" aria-hidden="true" />Ready · {render.width}×{render.height} · {Math.round(Number(render.duration_seconds))} s</p>
                {ctx.profile.can_download ? (
                  <>
                    <video controls playsInline preload="metadata" className="max-h-[70vh] w-full rounded-xl bg-black" src={`/api/projects/${run.project_id}/renders/${render.id}/download?play=1`} aria-label="Your video" />
                    <Button asChild size="lg" className="self-start"><a href={`/api/projects/${run.project_id}/renders/${render.id}/download`}><Download aria-hidden="true" />Download MP4</a></Button>
                  </>
                ) : <p className="text-sm text-muted-foreground">Downloads are turned off for your account.</p>}
              </>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {warnings.length ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ShieldCheck className="size-5" aria-hidden="true" />What we checked and corrected</CardTitle>
            <CardDescription>Every text was checked against the listing details. Anything not in the listing was removed.</CardDescription>
          </CardHeader>
          <CardContent><ul className="ml-5 list-disc text-base">{warnings.map((w, i) => <li key={i}>{w.message}</li>)}</ul></CardContent>
        </Card>
      ) : null}

      {sb ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <Card>
            <CardHeader><CardTitle>Storyboard</CardTitle><CardDescription>Opening photo: {sb.raw.opening_photo}</CardDescription></CardHeader>
            <CardContent>
              <ol className="flex flex-col gap-3">
                {sb.raw.scenes.map((s, i) => {
                  const texts = sb.raw.text_overlays.filter((t) => t.scene === i);
                  return (
                    <li key={i} className="flex gap-3 rounded-lg border p-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {thumbs[s.photo.toUpperCase()] ? <img src={thumbs[s.photo.toUpperCase()]!} alt={`Photo ${s.photo}`} className="h-20 w-28 shrink-0 rounded-md object-cover" /> : <span className="h-20 w-28 shrink-0 rounded-md bg-muted" />}
                      <div className="flex min-w-0 flex-col gap-0.5 text-sm">
                        <span className="font-semibold">Scene {i + 1} · {s.photo} · {s.seconds}s</span>
                        <span className="flex items-center gap-1 text-muted-foreground"><Film className="size-4" aria-hidden="true" />{getStudioMove(s.camera_move)?.name ?? s.camera_move} ({s.intensity}) · {s.transition}</span>
                        <span>{s.reason}</span>
                        {texts.map((t, j) => <span key={j} className="flex items-start gap-1"><Type className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />{t.text.replace(/\n/g, " · ")}</span>)}
                      </div>
                    </li>
                  );
                })}
              </ol>
              <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground"><Music className="size-4" aria-hidden="true" />Music mood: {sb.raw.music_mood} (add a licensed track in the editor)</p>
              {sb.director.callToAction ? <p className="mt-1 text-sm"><strong>Call to action:</strong> {sb.director.callToAction}</p> : null}
            </CardContent>
          </Card>
          <div className="flex flex-col gap-6">
            <Card>
              <CardHeader><CardTitle>Listing highlights</CardTitle></CardHeader>
              <CardContent>{sb.director.highlights.length ? <ul className="ml-5 list-disc text-base">{sb.director.highlights.map((h) => <li key={h}>{h}</li>)}</ul> : <p className="text-sm text-muted-foreground">None that could be verified.</p>}</CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Marketing captions</CardTitle><CardDescription>Checked against the listing; copy and paste.</CardDescription></CardHeader>
              <CardContent className="flex flex-col gap-3 text-sm">
                {(["instagram", "facebook", "short"] as const).map((k) => (
                  <div key={k}><p className="font-semibold capitalize">{k}</p><p className="whitespace-pre-line rounded-md bg-muted p-2">{sb.director.captions[k]}</p></div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}

      {analysis ? (
        <Card>
          <CardHeader><CardTitle>What Claude saw in each photo</CardTitle><CardDescription>{analysis.property_summary}</CardDescription></CardHeader>
          <CardContent>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {analysis.photos.map((p) => (
                <li key={p.ref} className="flex flex-col overflow-hidden rounded-lg border">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {thumbs[p.ref] ? <img src={thumbs[p.ref]!} alt={`Photo ${p.ref}`} className="aspect-video w-full object-cover" /> : <span className="aspect-video bg-muted" />}
                  <div className="flex flex-col gap-0.5 p-2 text-sm">
                    <span className="font-semibold">{p.ref} · {ROOM_LABELS[p.room_type]}</span>
                    <span className="text-muted-foreground">{p.description}</span>
                    {p.visible_features.length ? <span className="text-xs text-muted-foreground">Visible: {p.visible_features.join(", ")}</span> : null}
                    <span className="text-xs text-muted-foreground">Quality {p.quality}/10 · opener {p.opener_score}/10</span>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
