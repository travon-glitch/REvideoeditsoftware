"use client";
import { jobErrorForPeople } from "@/lib/video/job-errors";
import { useState } from "react";
import { CircleCheck, Download, Flag, LoaderCircle, Sparkles, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { formatDateTime } from "@/lib/utils";

export interface StudioRender {
  id: string; label: string | null; aspect: string; status: string; progress: number; error_message: string | null;
  created_at: string; duration_seconds: number | null; width: number | null; height: number | null;
}
export interface StudioJob {
  id: string; source_asset_id: string | null; provider: string; model: string; camera_move: string | null; status: string;
  progress: number; error_message: string | null; created_at: string; output_asset_id: string | null;
}
interface Flag { code: string; message: string }
export interface StudioClipView {
  id: string; label: string; sourceAssetId: string | null; url: string | null; durationSeconds: number | null;
  review: { flags?: Flag[]; firstFrameSimilarity?: number; stretchedShare?: number; method?: string } | null;
  decision: { status: "approved" | "problem"; note?: string } | null; createdAt: string;
}
export interface Activity { clipProject: string | null; renders: StudioRender[]; jobs: StudioJob[]; clips: StudioClipView[] }

const busy = (s: string) => s === "queued" || s === "running";

export function ClipsPanel({
  activity, photoUrls, canDownload, sceneContext, onUseClip, onReviewed,
}: {
  activity: Activity;
  photoUrls: Record<string, string | null>;
  canDownload: boolean;
  /** When opened from a video scene: the scene's photo, so its AI clips can be used there. */
  sceneContext: { photoId: string; label: string } | null;
  onUseClip: (clipId: string) => Promise<void>;
  onReviewed: () => void;
}) {
  const { renders, jobs, clips, clipProject } = activity;
  const pendingJobs = jobs.filter((j) => busy(j.status) || j.status === "failed").slice(0, 5);
  if (renders.length === 0 && jobs.length === 0 && clips.length === 0) {
    return <p className="text-base text-muted-foreground">Your exported clips and AI clips will appear here.</p>;
  }
  return (
    <div className="flex flex-col gap-6">
      {pendingJobs.length ? (
        <ul className="flex flex-col gap-2" aria-label="AI clips in progress">
          {pendingJobs.map((j) => (
            <li key={j.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm">
              <Sparkles className="size-4 text-brand" aria-hidden="true" />
              <span className="font-semibold">{j.provider === "local-depth" ? "AI depth" : "Generative AI"} · {j.camera_move?.replace(/_/g, " ")}</span>
              <span className="flex-1 text-muted-foreground">
                {j.status === "queued" ? "Waiting for the AI worker…" : null}
                {j.status === "running" ? `Making it… ${Math.round(Number(j.progress) * 100)}%` : null}
                {j.status === "failed" ? <span className="text-destructive">Didn&apos;t finish: {jobErrorForPeople(j.error_message)}</span> : null}
              </span>
              {busy(j.status) ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : null}
            </li>
          ))}
        </ul>
      ) : null}

      {clips.length ? (
        <div className="flex flex-col gap-3">
          <h3 className="text-lg font-semibold">AI clips</h3>
          <ul className="flex flex-col gap-4">
            {clips.map((c) => <AiClipCard key={c.id} clip={c} photoUrl={c.sourceAssetId ? photoUrls[c.sourceAssetId] ?? null : null}
              canUse={!!sceneContext && sceneContext.photoId === c.sourceAssetId} sceneLabel={sceneContext?.label} onUse={() => onUseClip(c.id)} onReviewed={onReviewed} />)}
          </ul>
        </div>
      ) : null}

      {renders.length ? (
        <div className="flex flex-col gap-3">
          <h3 className="text-lg font-semibold">Exported clips (Standard)</h3>
          <ul className="flex flex-col divide-y rounded-lg border">
            {renders.map((r) => (
              <li key={r.id} className="flex flex-col gap-2 p-3">
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <span className="font-semibold">{r.label ?? r.aspect}</span>
                  <span className="flex-1 text-muted-foreground">
                    {r.status === "queued" ? "Waiting to start…" : r.status === "running" ? `Rendering… ${Math.round(Number(r.progress) * 100)}%`
                      : r.status === "succeeded" ? `${r.width}×${r.height} · ${Number(r.duration_seconds ?? 0).toFixed(1)} s · ${formatDateTime(r.created_at)}`
                      : `Didn't finish: ${jobErrorForPeople(r.error_message)}`}
                  </span>
                  {r.status === "succeeded" && canDownload && clipProject ? (
                    <Button asChild size="sm"><a href={`/api/projects/${clipProject}/renders/${r.id}/download`}><Download aria-hidden="true" />Download MP4</a></Button>
                  ) : null}
                </div>
                {r.status === "succeeded" && canDownload && clipProject ? (
                  <video controls playsInline preload="metadata" className="max-h-72 w-full rounded-lg bg-black" aria-label={r.label ?? "Exported clip"}
                    src={`/api/projects/${clipProject}/renders/${r.id}/download?play=1`} />
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function AiClipCard({ clip, photoUrl, canUse, sceneLabel, onUse, onReviewed }: {
  clip: StudioClipView; photoUrl: string | null; canUse: boolean; sceneLabel?: string; onUse: () => Promise<void>; onReviewed: () => void;
}) {
  const [note, setNote] = useState("");
  const [reporting, setReporting] = useState(false);
  const [busyState, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const flags = clip.review?.flags ?? [];
  const review = async (decision: "approved" | "problem") => {
    setBusy(true); setMsg(null);
    const res = await fetch(`/api/camera/clips/${clip.id}/review`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision, note: note || undefined }) }).catch(() => null);
    setBusy(false);
    if (!res?.ok) { setMsg("That didn't save. Please try again."); return; }
    setReporting(false); onReviewed();
  };
  return (
    <li className="flex flex-col gap-3 rounded-xl border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-base font-semibold"><Sparkles className="size-4 text-brand" aria-hidden="true" />{clip.label}</span>
        <span className="rounded-full bg-brand/10 px-2 py-0.5 text-xs font-semibold text-brand">AI-generated motion</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <figure className="flex flex-col gap-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {photoUrl ? <img src={photoUrl} alt="Original photo" className="aspect-video w-full rounded-lg object-cover" /> : <div className="aspect-video rounded-lg bg-muted" />}
          <figcaption className="text-xs text-muted-foreground">Original photo (unchanged)</figcaption>
        </figure>
        <figure className="flex flex-col gap-1">
          {clip.url ? <video src={clip.url} controls loop muted playsInline className="aspect-video w-full rounded-lg bg-black" aria-label={`AI clip: ${clip.label}`} /> : <div className="aspect-video rounded-lg bg-muted" />}
          <figcaption className="text-xs text-muted-foreground">AI clip · {clip.durationSeconds?.toFixed(1)} s</figcaption>
        </figure>
      </div>

      {flags.length ? (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-col gap-1 text-sm">
            <span className="flex items-center gap-2 font-semibold"><TriangleAlert className="size-4" aria-hidden="true" />Check for changes to the property</span>
            {flags.map((f) => <span key={f.code}>{f.message}</span>)}
          </AlertDescription>
        </Alert>
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted-foreground"><CircleCheck className="size-4 text-success" aria-hidden="true" />Automatic check found no stretched areas or big changes. Still compare it with the photo before publishing.</p>
      )}

      {clip.decision ? (
        <p className={clip.decision.status === "approved" ? "text-sm font-semibold text-success" : "text-sm font-semibold text-destructive"}>
          {clip.decision.status === "approved" ? "Approved for use" : `Problem reported${clip.decision.note ? `: ${clip.decision.note}` : ""}`}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={busyState} onClick={() => void review("approved")}><CircleCheck aria-hidden="true" />Looks right</Button>
        <Button size="sm" variant="outline" disabled={busyState} onClick={() => setReporting((r) => !r)}><Flag aria-hidden="true" />Report a problem</Button>
        {clip.url ? <Button size="sm" variant="ghost" asChild><a href={clip.url} download>Download</a></Button> : null}
        {canUse ? (
          <Button size="sm" disabled={busyState || clip.decision?.status === "problem"} onClick={() => { setBusy(true); void onUse().finally(() => setBusy(false)); }}>
            Use in {sceneLabel}
          </Button>
        ) : null}
      </div>
      {reporting ? (
        <div className="flex flex-col gap-2">
          <label htmlFor={`note-${clip.id}`} className="text-sm font-semibold">What looks wrong?</label>
          <textarea id={`note-${clip.id}`} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} rows={2}
            placeholder="e.g. the roof line bends, a window is missing" className="rounded-md border bg-background p-2 text-sm" />
          <Button size="sm" className="self-start" disabled={busyState} onClick={() => void review("problem")}>Save report</Button>
        </div>
      ) : null}
      {msg ? <p role="status" className="text-sm text-destructive">{msg}</p> : null}
    </li>
  );
}
