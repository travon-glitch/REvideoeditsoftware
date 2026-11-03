"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, CircleCheck, Download, FolderDown, LibraryBig, LoaderCircle, Pencil, Play, RefreshCw, RotateCcw, TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ORIENTATION_LABELS } from "@/lib/video/easy";
import type { BatchVideo } from "@/lib/video/batch-store";
import type { ListingAnalysis } from "@/lib/video/batch";
import type { Aspect } from "@/lib/video/plan";
import { cn } from "@/lib/utils";

interface Data {
  batch: { id: string; listing_id: string | null; size: number; created_at: string; analysis: ListingAnalysis | null; address: string; aspect?: string; planner?: string };
  videos: BatchVideo[];
}

const busy = (v: BatchVideo) => v.render?.status === "queued" || v.render?.status === "running";
const secs = (n: number | null | undefined) => (n == null ? "" : `${Math.floor(n / 60)}:${String(Math.round(n % 60)).padStart(2, "0")}`);

export function BatchDashboard({ initial, canDownload, canEdit }: { initial: Data; canDownload: boolean; canEdit: boolean }) {
  const [data, setData] = useState(initial);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/batches/${data.batch.id}`).catch(() => null);
    if (!res?.ok || !res.headers.get("content-type")?.includes("json")) return;
    const next = await res.json().catch(() => null);
    if (next) setData(next);
  }, [data.batch.id]);
  const active = data.videos.some(busy);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => void refresh(), 3000);
    return () => clearInterval(t);
  }, [active, refresh]);

  async function post(url: string, body?: unknown) {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }).catch(() => null);
    const json = await res?.json().catch(() => ({}));
    return { ok: !!res?.ok, json: json ?? {} };
  }
  async function act(key: string, fn: () => Promise<{ ok: boolean; json: Record<string, unknown> }>, okText: string) {
    setWorking(key); setNotice(null);
    const r = await fn();
    setWorking(null);
    setNotice(r.ok ? { ok: true, text: okText } : { ok: false, text: String(r.json.error ?? "That didn't work. Please try again.") });
    await refresh();
  }

  const done = data.videos.filter((v) => v.render?.status === "succeeded");
  const failed = data.videos.filter((v) => v.render?.status === "failed" || (!v.projectId));
  const notSaved = done.filter((v) => !v.inLibrary);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link href="/generate" className="flex items-center gap-1 text-sm font-semibold text-primary"><ArrowLeft className="size-4" aria-hidden="true" />Generate 6 Videos</Link>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{data.videos.length} videos for {data.batch.address || "your listing"}</h1>
            <p className="text-lg text-muted-foreground" role="status" aria-live="polite">
              {done.length} of {data.videos.length} ready{active ? " · the rest are being made in the background" : ""}{failed.length ? ` · ${failed.length} need attention` : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canDownload ? (
              <Button asChild size="lg" variant={done.length ? "default" : "outline"} className={cn(!done.length && "pointer-events-none opacity-50")}>
                <a href={`/api/batches/${data.batch.id}/zip`} aria-disabled={!done.length}><FolderDown aria-hidden="true" />Download all{done.length ? ` (${done.length})` : ""} as ZIP</a>
              </Button>
            ) : null}
            {canEdit ? (
              <Button size="lg" variant="outline" disabled={!notSaved.length || working !== null}
                onClick={() => void act("lib-all", () => post("/api/library", { renderIds: notSaved.map((v) => v.render!.id) }), "Saved to the company library.")}>
                {working === "lib-all" ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <LibraryBig aria-hidden="true" />}Save all to company library
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      {notice ? <Alert variant={notice.ok ? "success" : "destructive"} role="status"><AlertDescription className="text-base">{notice.text}</AlertDescription></Alert> : null}

      <ul className="grid gap-5 md:grid-cols-2 xl:grid-cols-3" aria-label="Videos in this batch">
        {data.videos.map((v) => {
          const r = v.render;
          const pct = r ? Math.round(Number(r.progress) * 100) : 0;
          return (
            <li key={v.type} className="flex flex-col overflow-hidden rounded-2xl border bg-card">
              <div className="relative flex aspect-[4/5] items-center justify-center overflow-hidden bg-neutral-900">
                {playing === v.type && r?.status === "succeeded" && canDownload && v.projectId ? (
                  <video autoPlay controls playsInline className="size-full object-contain" aria-label={`${v.title} preview`}
                    src={`/api/projects/${v.projectId}/renders/${r.id}/download?play=1`} />
                ) : (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {v.thumbnail ? <img src={v.thumbnail} alt="" className={cn("absolute inset-y-0 left-1/2 h-full -translate-x-1/2 object-cover", v.aspect === "16:9" ? "w-full" : v.aspect === "1:1" ? "aspect-square" : "aspect-[9/16]")} /> : null}
                    {r?.status === "succeeded" && canDownload ? (
                      <button type="button" onClick={() => setPlaying(v.type)} aria-label={`Preview ${v.title}`}
                        className="absolute inset-0 flex items-center justify-center bg-black/20 hover:bg-black/30">
                        <span className="flex size-16 items-center justify-center rounded-full bg-white/90 text-black shadow"><Play className="size-8" aria-hidden="true" /></span>
                      </button>
                    ) : null}
                  </>
                )}
                <span className="absolute left-2 top-2 rounded-md bg-black/70 px-2 py-0.5 text-xs font-semibold text-white">{ORIENTATION_LABELS[v.aspect as Aspect]?.label ?? v.aspect}</span>
              </div>
              <div className="flex flex-1 flex-col gap-3 p-4">
                <div>
                  <h2 className="text-lg font-semibold">{v.title}</h2>
                  <p className="text-sm text-muted-foreground">{v.purpose}</p>
                </div>
                {v.music ? <p className="text-sm text-muted-foreground">Music: <span className="font-medium text-foreground">{v.music}</span> (licensed)</p> : null}
                <p className="text-sm text-muted-foreground">
                  {r?.status === "succeeded" ? `${secs(Number(r.duration_seconds))} · ${r.width}×${r.height} MP4` : `About ${secs(v.plannedSeconds)}`}
                </p>
                <div aria-live="polite">
                  {!v.projectId ? <p className="flex items-center gap-2 text-sm font-semibold text-destructive"><TriangleAlert className="size-4" aria-hidden="true" />Couldn&apos;t be created</p> : null}
                  {r?.status === "queued" ? <p className="flex items-center gap-2 text-sm"><LoaderCircle className="size-4 animate-spin" aria-hidden="true" />Waiting for a free renderer…</p> : null}
                  {r?.status === "running" ? (
                    <div className="flex flex-col gap-1">
                      <p className="text-sm font-semibold">Rendering… {pct}%</p>
                      <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${v.title} progress`}>
                        <div className="h-2 rounded-full bg-primary transition-all" style={{ width: `${Math.max(3, pct)}%` }} />
                      </div>
                    </div>
                  ) : null}
                  {r?.status === "succeeded" ? <p className="flex items-center gap-2 text-sm font-semibold text-success"><CircleCheck className="size-4" aria-hidden="true" />Ready{v.inLibrary ? " · in the company library" : ""}</p> : null}
                  {r?.status === "failed" ? <p className="flex items-start gap-2 text-sm font-semibold text-destructive"><TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />Didn&apos;t finish: {r.error_message ?? "unknown problem"}</p> : null}
                </div>
                <div className="mt-auto flex flex-wrap gap-2">
                  {r?.status === "succeeded" && canDownload && v.projectId ? (
                    <Button asChild size="sm"><a href={`/api/projects/${v.projectId}/renders/${r.id}/download`}><Download aria-hidden="true" />Download</a></Button>
                  ) : null}
                  {canEdit && v.projectId ? <Button asChild size="sm" variant="outline"><Link href={`/videos/${v.projectId}/edit`}><Pencil aria-hidden="true" />Edit</Link></Button> : null}
                  {canEdit && v.projectId && r?.status === "failed" ? (
                    <Button size="sm" disabled={working !== null} onClick={() => void act(`retry-${v.type}`, () => post(`/api/batches/videos/${v.projectId}/retry`), `${v.title}: trying again.`)}>
                      {working === `retry-${v.type}` ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <RotateCcw aria-hidden="true" />}Retry
                    </Button>
                  ) : null}
                  {canEdit && v.projectId ? (
                    <Button size="sm" variant="ghost" disabled={working !== null || busy(v)}
                      onClick={() => void act(`regen-${v.type}`, () => post(`/api/batches/videos/${v.projectId}/regenerate`), `${v.title}: new storyboard, rendering now.`)}>
                      {working === `regen-${v.type}` ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}Regenerate
                    </Button>
                  ) : null}
                  {canEdit && r?.status === "succeeded" && !v.inLibrary ? (
                    <Button size="sm" variant="ghost" disabled={working !== null}
                      onClick={() => void act(`lib-${v.type}`, () => post("/api/library", { renderIds: [r.id] }), `${v.title} saved to the company library.`)}>
                      <LibraryBig aria-hidden="true" />Save to library
                    </Button>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {data.batch.analysis?.notes?.length ? (
        <details className="rounded-xl border bg-card p-4">
          <summary className="cursor-pointer text-base font-semibold">How the listing was analyzed</summary>
          <ul className="ml-5 mt-2 list-disc text-base text-muted-foreground">{data.batch.analysis.notes.map((n) => <li key={n}>{n}</li>)}</ul>
        </details>
      ) : null}
    </div>
  );
}
