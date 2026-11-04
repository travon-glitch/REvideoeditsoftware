"use client";
/*
 * The video editor (Stage 12): one saved plan, two editors.
 *   Easy     — preview, photo order, style, music, text, camera movement, generate, download.
 *   Advanced — multitrack timeline (video, overlays, text, captions, narration, music), keyframes,
 *              split / trim / duplicate, image and text positioning, animated overlays, transitions,
 *              AI clip insertion, AI narration, captions, music controls, undo / redo.
 * Every change autosaves (with a revision check) and can be undone.
 */
import { jobErrorForPeople } from "@/lib/video/job-errors";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CircleCheck, Copy, Diamond, Download, LoaderCircle, Plus, Scissors, Sparkles, Trash2, TriangleAlert, Type, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ASPECTS, ASPECT_LABELS, MAX_TEXTS, TRANSITIONS, TRANSITION_LABELS, totalDuration, type Aspect, type EditPlan,
} from "@/lib/video/plan";
import type { EasyBrand, EasyListing } from "@/lib/video/easy";
import { duplicateScene, insertAiClip, sceneAt, splitScene, textStart } from "@/lib/video/timeline";
import { cn } from "@/lib/utils";
import { useHistory } from "@/lib/use-history";
import { UndoRedo } from "@/components/undo-redo";
import { PreviewPlayer } from "@/components/video/preview-player";
import { Timeline, type Selection } from "./timeline";
import { CaptionsPanel, MusicPanel, OverlayInspector, SceneInspector, TextInspector, VoicePanel, type VoiceOption } from "./inspector";
import { EasyEditor } from "./easy-editor";

export interface EditorPhoto { id: string; url: string | null; thumb?: string | null; file_name: string }
export interface EditorMusic { id: string; url: string | null; file_name: string; duration_seconds: number | null }
export interface EditorRender {
  id: string; aspect: Aspect; status: "queued" | "running" | "succeeded" | "failed" | "cancelled"; progress: number;
  error_message: string | null; created_at: string; duration_seconds: number | null; width: number | null; height: number | null;
}
export interface EditorAiClip { id: string; url: string | null; sourceAssetId: string | null; label: string; duration: number | null }

type SaveState = { kind: "saved" | "saving" | "pending" | "error" | "conflict"; message?: string };
const uid = (p: string) => `${p}${Math.random().toString(36).slice(2, 9)}`;

export function VideoEditor({
  projectId, orgId, initialPlan, initialRevision, photos, initialMusic, initialRenders, brandColor, canDownload, clips = [],
  initialMode = "easy", listing = null, brand = null, voices = [], voiceReady = { tts: false, asr: false },
}: {
  projectId: string; orgId: string; initialPlan: EditPlan; initialRevision: number; photos: EditorPhoto[];
  initialMusic: EditorMusic[]; initialRenders: EditorRender[]; brandColor: string; canDownload: boolean;
  /** AI camera clips of the listing. */
  clips?: EditorAiClip[];
  initialMode?: "easy" | "advanced";
  listing?: EasyListing | null; brand?: EasyBrand | null;
  voices?: VoiceOption[]; voiceReady?: { tts: boolean; asr: boolean };
}) {
  const history = useHistory(initialPlan);
  const plan = history.value;
  const [mode, setMode] = useState(initialMode);
  const [save, setSave] = useState<SaveState>({ kind: "saved" });
  const [music, setMusic] = useState(initialMusic);
  const [renders, setRenders] = useState(initialRenders);
  const [exportAspects, setExportAspects] = useState<Aspect[]>([initialPlan.aspect]);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [time, setTime] = useState(0);
  const [sel, setSel] = useState<Selection>(null);
  const [panel, setPanel] = useState<"item" | "voice" | "captions" | "music" | "video">("video");
  const [notice, setNotice] = useState<string | null>(null);
  const revision = useRef(initialRevision);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const first = useRef(true);
  const latest = useRef(plan);
  latest.current = plan;

  // On phones and small tablets the preview uses the upload's preview image instead of the full-size original:
  // 20+ megapixel photos decoded at every scene change are what runs mobile browsers out of memory.
  // The finished video always uses the originals.
  const [lightPreview, setLightPreview] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    const on = () => setLightPreview(mq.matches);
    on(); mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const photoUrls = useMemo(() => Object.fromEntries(photos.map((p) => [p.id, (lightPreview && p.thumb) || p.url])), [photos, lightPreview]);
  const thumbUrls = useMemo(() => Object.fromEntries(photos.map((p) => [p.id, p.thumb ?? p.url ?? null])), [photos]);
  const clipUrls = useMemo(() => Object.fromEntries(clips.map((c) => [c.id, c.url])), [clips]);
  const total = totalDuration(plan);
  const musicUrl = music.find((m) => m.id === plan.music.assetId)?.url ?? null;
  const voiceUrl = plan.voiceover ? music.find((m) => m.id === plan.voiceover!.assetId)?.url ?? null : null;

  /* ── Autosave ─────────────────────────────────────────────────────── */
  const saveNow = useCallback(async () => {
    if (latest.current.texts.some((t) => !t.text.trim())) { setSave({ kind: "error", message: "A text box is empty — type something or remove it." }); return; }
    setSave({ kind: "saving" });
    const res = await fetch(`/api/projects/${projectId}/plan`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ baseRevision: revision.current, plan: latest.current }),
    }).catch(() => null);
    if (!res) { setSave({ kind: "error", message: "No connection. Your changes will be saved when you're back online." }); return; }
    const body = await res.json().catch(() => ({}));
    if (res.ok) { revision.current = body.revision; setSave({ kind: "saved" }); return; }
    if (res.status === 409) { setSave({ kind: "conflict", message: body.error }); return; }
    setSave({ kind: "error", message: body.error ?? "Couldn't save." });
  }, [projectId]);

  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (save.kind === "conflict") return;
    setSave({ kind: "pending" });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void saveNow(), 800);
    return () => { if (timer.current) clearTimeout(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (save.kind === "pending" || save.kind === "saving") e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [save.kind]);

  /* ── Render polling ───────────────────────────────────────────────── */
  const active = renders.some((r) => r.status === "queued" || r.status === "running");
  useEffect(() => {
    if (!active) return;
    const t = setInterval(async () => {
      const res = await fetch(`/api/projects/${projectId}/renders`).catch(() => null);
      if (res?.ok) setRenders((await res.json()).renders);
    }, 3000);
    return () => clearInterval(t);
  }, [active, projectId]);

  /* ── Edits (all undoable) ─────────────────────────────────────────── */
  const update = useCallback((fn: (p: EditPlan) => EditPlan, mergeKey?: string) => history.set((p) => {
    const next = fn(structuredClone(p));
    return next.easy ? { ...next, easy: { ...next.easy, customized: true } } : next;
  }, mergeKey), [history]);
  const tryUpdate = (fn: (p: EditPlan) => EditPlan) => { try { update(fn); setNotice(null); } catch (e) { setNotice(e instanceof Error ? e.message : "That didn't work."); } };
  const addAudio = (a: EditorMusic) => setMusic((m) => [...m.filter((x) => x.id !== a.id), a]);

  async function startExport(aspects = exportAspects) {
    setExportError(null); setExporting(true);
    if (save.kind !== "saved") await saveNow();
    const res = await fetch(`/api/projects/${projectId}/renders`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ aspects }),
    }).catch(() => null);
    setExporting(false);
    const body = await res?.json().catch(() => ({}));
    if (!res?.ok) { setExportError(body?.error ?? "The export couldn't start."); return; }
    setRenders((r) => [...body.renders, ...r]);
  }

  /* toolbar actions at the playhead */
  const here = sceneAt(plan, Math.min(time, Math.max(0, total - 0.01)));
  const selectedScene = sel?.kind === "scene" ? sel.id : here.scene.id;
  const split = () => tryUpdate((p) => {
    const at = sceneAt(p, time);
    return splitScene(p, at.scene.id, at.local);
  });
  const addText = () => update((p) => {
    const at = sceneAt(p, time);
    const t = { id: uid("t"), text: "Your text here", sceneId: at.scene.id, style: "caption" as const, position: "center" as const, duration: Math.min(3, at.scene.duration), ...(at.local > 0.1 ? { offset: Math.round(at.local * 10) / 10 } : {}) };
    setTimeout(() => { setSel({ kind: "text", id: t.id }); setPanel("item"); });
    return { ...p, texts: [...p.texts, t] };
  });
  const addOverlay = () => update((p) => {
    const o = { id: uid("o"), preset: "lower-third" as const, start: Math.round(time * 10) / 10, duration: Math.min(4, Math.max(1, total - time)), x: 0, y: 0.32, scale: 1, rotation: 0, color: brandColor, text: "Your text", animIn: "slide-up" as const, animOut: "fade" as const };
    setTimeout(() => { setSel({ kind: "overlay", id: o.id }); setPanel("item"); });
    return { ...p, overlays: [...(p.overlays ?? []), o] };
  });
  const insertClip = (clipId: string) => {
    const c = clips.find((x) => x.id === clipId);
    if (!c?.sourceAssetId) return;
    tryUpdate((p) => insertAiClip(p, { clipAssetId: c.id, sourceAssetId: c.sourceAssetId!, at: time, duration: Math.min(c.duration ?? 4, 6) }));
  };
  const addKeyframe = () => {
    if (sel?.kind === "text") {
      const t = plan.texts.find((x) => x.id === sel.id);
      if (!t) return;
      const local = Math.max(0, Math.round((time - textStart(plan, t)) * 100) / 100);
      update((p) => ({ ...p, texts: p.texts.map((x) => (x.id === t.id ? { ...x, x: x.x ?? 0, y: x.y ?? 0, keys: [...(x.keys ?? []).filter((k) => Math.abs(k.t - local) > 0.05), { t: local, x: x.x ?? 0, y: x.y ?? 0, opacity: 1 }].sort((a, b) => a.t - b.t) } : x)) }));
    } else if (sel?.kind === "overlay") {
      const o = (plan.overlays ?? []).find((x) => x.id === sel.id);
      if (!o) return;
      const local = Math.max(0, Math.round((time - o.start) * 100) / 100);
      update((p) => ({ ...p, overlays: (p.overlays ?? []).map((x) => (x.id === o.id ? { ...x, keys: [...(x.keys ?? []).filter((k) => Math.abs(k.t - local) > 0.05), { t: local, x: x.x, y: x.y, scale: x.scale }].sort((a, b) => a.t - b.t) } : x)) }));
    }
  };
  const deleteSelected = () => {
    if (!sel) return;
    if (sel.kind === "scene") tryUpdate((p) => {
      if (p.scenes.length <= 1) throw new Error("A video needs at least one scene.");
      return { ...p, scenes: p.scenes.filter((s) => s.id !== sel.id), texts: p.texts.filter((t) => t.sceneId !== sel.id) };
    });
    if (sel.kind === "text") update((p) => ({ ...p, texts: p.texts.filter((t) => t.id !== sel.id) }));
    if (sel.kind === "overlay") update((p) => ({ ...p, overlays: (p.overlays ?? []).filter((o) => o.id !== sel.id) }));
    setSel(null);
  };
  const select = (s: Selection) => {
    setSel(s);
    if (!s) return;
    setPanel(s.kind === "voice" ? "voice" : s.kind === "captions" ? "captions" : s.kind === "music" ? "music" : "item");
  };

  // keyboard: undo / redo handled by UndoRedo; Delete removes the selection, S splits
  useEffect(() => {
    if (mode !== "advanced") return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); deleteSelected(); }
      if (e.key === "s" && !e.metaKey && !e.ctrlKey) { e.preventDefault(); split(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const exportCard = (
    <Card>
      <CardHeader><CardTitle>Export MP4</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-4">
        <fieldset className="flex flex-wrap gap-2">
          <legend className="sr-only">Formats to export</legend>
          {ASPECTS.map((a) => (
            <label key={a} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
              <input type="checkbox" className="size-5 accent-[hsl(var(--primary))]" checked={exportAspects.includes(a)}
                onChange={(e) => setExportAspects((s) => (e.target.checked ? [...s, a] : s.filter((x) => x !== a)))} />
              <span className="text-sm font-medium">{ASPECT_LABELS[a]}</span>
            </label>
          ))}
        </fieldset>
        <Button size="lg" className="self-start bg-brand text-white hover:bg-brand/90" disabled={exporting || active || exportAspects.length === 0} onClick={() => void startExport()}>
          {exporting || active ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Download aria-hidden="true" />}
          {active ? "Making your video…" : "Export 1080p MP4"}
        </Button>
        {exportError ? <Alert variant="destructive"><AlertDescription>{exportError}</AlertDescription></Alert> : null}
        <RenderList projectId={projectId} renders={renders} canDownload={canDownload} />
      </CardContent>
    </Card>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Editor" className="flex rounded-lg border p-1">
          {(["easy", "advanced"] as const).map((m) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)}
              className={cn("min-h-10 rounded-md px-4 text-sm font-semibold", mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>
              {m === "easy" ? "Easy editor" : "Advanced editor"}
            </button>
          ))}
        </div>
        <SaveBadge state={save} onReload={() => window.location.reload()} />
        <div className="flex items-center gap-3">
          <p className="text-sm text-muted-foreground">{plan.scenes.length} scenes · {total.toFixed(1)} s</p>
          <UndoRedo onUndo={history.undo} onRedo={history.redo} canUndo={history.canUndo} canRedo={history.canRedo} />
        </div>
      </div>

      {mode === "easy" ? (
        <EasyEditor plan={plan} update={update} photos={photos} photoUrls={photoUrls} thumbUrls={thumbUrls} clipUrls={clipUrls} music={music}
          musicUrl={musicUrl} voiceUrl={voiceUrl} brandColor={brandColor} listing={listing} brand={brand} orgId={orgId} projectId={projectId}
          onAudio={addAudio} renders={renders} canDownload={canDownload} exporting={exporting || active} exportError={exportError}
          onGenerate={(a) => void startExport([a])} />
      ) : (
        <>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <Card><CardContent className="pt-6">
              <PreviewPlayer plan={plan} photoUrls={photoUrls} clipUrls={clipUrls} musicUrl={musicUrl} voiceUrl={voiceUrl} brandColor={brandColor} time={time} onTime={setTime} />
            </CardContent></Card>
            <Card className="self-start">
              <CardHeader className="pb-2">
                <div role="tablist" aria-label="Inspector" className="grid grid-cols-5 gap-1">
                  {([["item", "Selected"], ["voice", "Voice"], ["captions", "Captions"], ["music", "Music"], ["video", "Video"]] as const).map(([k, label]) => (
                    <button key={k} type="button" role="tab" aria-selected={panel === k} onClick={() => setPanel(k)}
                      className={cn("min-h-9 rounded-md text-xs font-semibold", panel === k ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground")}>{label}</button>
                  ))}
                </div>
              </CardHeader>
              <CardContent>
                {panel === "item" ? (
                  sel?.kind === "text" ? <TextInspector plan={plan} id={sel.id} update={update} time={time} />
                    : sel?.kind === "overlay" ? <OverlayInspector plan={plan} id={sel.id} update={update} time={time} />
                      : <SceneInspector plan={plan} id={selectedScene} update={update} projectId={projectId} thumb={thumbUrls[plan.scenes.find((s) => s.id === selectedScene)?.assetId ?? ""] ?? null}
                        aiClips={clips} onSplit={split} onDuplicate={() => tryUpdate((p) => duplicateScene(p, selectedScene))} onDelete={() => { setSel({ kind: "scene", id: selectedScene }); tryUpdate((p) => ({ ...p, scenes: p.scenes.length > 1 ? p.scenes.filter((s) => s.id !== selectedScene) : p.scenes })); }} />
                ) : null}
                {panel === "voice" ? <VoicePanel plan={plan} update={update} projectId={projectId} orgId={orgId} voices={voices} ready={voiceReady} onAudio={addAudio} /> : null}
                {panel === "captions" ? <CaptionsPanel plan={plan} update={update} projectId={projectId} focusCue={sel?.kind === "captions" ? sel.cue : undefined} ready={voiceReady} /> : null}
                {panel === "music" ? <MusicPanel plan={plan} update={update} music={music} orgId={orgId} projectId={projectId} onAudio={addAudio} /> : null}
                {panel === "video" ? (
                  <div className="flex flex-col gap-3">
                    <div role="radiogroup" aria-label="Video shape" className="grid grid-cols-2 gap-2">
                      {ASPECTS.map((a) => (
                        <button key={a} type="button" role="radio" aria-checked={plan.aspect === a} onClick={() => update((p) => ({ ...p, aspect: a }))}
                          className={cn("min-h-11 rounded-lg border-2 px-2 text-sm font-semibold", plan.aspect === a ? "border-primary bg-primary/5" : "border-border hover:border-primary/40")}>{ASPECT_LABELS[a]}</button>
                      ))}
                    </div>
                    <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">Transition between scenes (default)
                      <NativeSelect value={plan.transition} onChange={(e) => update((p) => ({ ...p, transition: e.target.value as EditPlan["transition"] }))}>
                        {TRANSITIONS.map((t) => <option key={t} value={t}>{TRANSITION_LABELS[t]}</option>)}
                      </NativeSelect>
                    </label>
                    <p className="text-xs text-muted-foreground">Each scene can have its own transition: select the scene (or the diamond between scenes) on the timeline.</p>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardContent className="flex flex-col gap-3 pt-4">
              <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Timeline tools">
                <Button type="button" size="sm" variant="outline" onClick={split} title="Split the scene at the playhead (S)"><Scissors aria-hidden="true" />Split</Button>
                <Button type="button" size="sm" variant="outline" onClick={() => tryUpdate((p) => duplicateScene(p, selectedScene))}><Copy aria-hidden="true" />Duplicate scene</Button>
                <Button type="button" size="sm" variant="outline" disabled={plan.texts.length >= MAX_TEXTS} onClick={addText}><Type aria-hidden="true" />Add text</Button>
                <Button type="button" size="sm" variant="outline" disabled={(plan.overlays ?? []).length >= 20} onClick={addOverlay}><Plus aria-hidden="true" />Add overlay</Button>
                <Button type="button" size="sm" variant="outline" disabled={sel?.kind !== "text" && sel?.kind !== "overlay"} onClick={addKeyframe}><Diamond aria-hidden="true" />Keyframe</Button>
                {clips.length ? (
                  <label className="flex items-center gap-1 text-sm">
                    <Sparkles className="size-4 text-brand" aria-hidden="true" />
                    <NativeSelect className="h-9 w-48 text-sm" value="" aria-label="Insert an AI clip at the playhead" onChange={(e) => { if (e.target.value) insertClip(e.target.value); }}>
                      <option value="">Insert AI clip…</option>
                      {clips.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                    </NativeSelect>
                  </label>
                ) : null}
                <Button type="button" size="sm" variant="ghost" className="text-destructive" disabled={!sel || sel.kind === "voice" || sel.kind === "music" || sel.kind === "captions"} onClick={deleteSelected}><Trash2 aria-hidden="true" />Delete</Button>
                <span className="ml-auto text-xs tabular-nums text-muted-foreground">Playhead {time.toFixed(2)} s</span>
              </div>
              {notice ? <p role="status" className="text-sm text-destructive">{notice}</p> : null}
              <Timeline plan={plan} time={time} onSeek={setTime} sel={sel} onSelect={select} update={update} thumbs={thumbUrls} />
            </CardContent>
          </Card>
          {exportCard}
        </>
      )}
    </div>
  );
}

function SaveBadge({ state, onReload }: { state: SaveState; onReload: () => void }) {
  if (state.kind === "conflict") {
    return (
      <Alert variant="destructive" className="max-w-xl">
        <AlertDescription className="flex flex-wrap items-center gap-3 text-base">
          {state.message} <Button size="sm" variant="outline" onClick={onReload}>Reload</Button>
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <p role="status" aria-live="polite" className="flex items-center gap-2 text-sm">
      {state.kind === "saving" || state.kind === "pending" ? <><LoaderCircle className="size-4 animate-spin" aria-hidden="true" />Saving…</> : null}
      {state.kind === "saved" ? <><CircleCheck className="size-4 text-success" aria-hidden="true" /><span className="text-success">All changes saved</span></> : null}
      {state.kind === "error" ? <><TriangleAlert className="size-4 text-destructive" aria-hidden="true" /><span className="text-destructive">{state.message}</span></> : null}
    </p>
  );
}

export function RenderList({ projectId, renders, canDownload }: { projectId: string; renders: EditorRender[]; canDownload: boolean }) {
  if (renders.length === 0) return <p className="text-sm text-muted-foreground">Your finished videos will appear here.</p>;
  return (
    <ul className="flex flex-col divide-y rounded-lg border">
      {renders.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center gap-3 px-3 py-3">
          <span className="w-36 text-sm font-semibold">{ASPECT_LABELS[r.aspect] ?? r.aspect}</span>
          <span className="flex-1 text-sm text-muted-foreground">
            {r.status === "queued" ? "Waiting to start…" : null}
            {r.status === "running" ? (
              <span className="flex items-center gap-2">
                <span className="h-2 w-32 overflow-hidden rounded-full bg-muted"><span className="block h-2 bg-primary" style={{ width: `${Math.round(r.progress * 100)}%` }} /></span>
                {Math.round(r.progress * 100)}%
              </span>
            ) : null}
            {r.status === "succeeded" ? `Ready · ${r.width}×${r.height} · ${Math.round(r.duration_seconds ?? 0)} s` : null}
            {r.status === "failed" ? <span className="text-destructive">Didn&apos;t finish: {jobErrorForPeople(r.error_message)}</span> : null}
          </span>
          {r.status === "succeeded" && canDownload ? (
            <Button asChild size="sm"><a href={`/api/projects/${projectId}/renders/${r.id}/download`}><Download aria-hidden="true" />Download</a></Button>
          ) : null}
          {r.status === "succeeded" && !canDownload ? <span className="text-sm text-muted-foreground">Downloads are off for your account</span> : null}
        </li>
      ))}
    </ul>
  );
}

export { Wand2 };
