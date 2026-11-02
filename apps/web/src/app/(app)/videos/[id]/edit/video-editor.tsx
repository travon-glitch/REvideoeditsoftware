"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, ArrowRight, CircleCheck, Download, GripVertical, LoaderCircle, Music, Plus, Trash2, TriangleAlert, Type, Upload, Wand2,
} from "lucide-react";
import { CAMERA_MOVES, STILL_NAME, getStudioMove } from "@lvs/camera-presets";
import Link from "next/link";
import { Clapperboard, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MUSIC_MIME_TYPES } from "@/lib/storage";
import { uploadProjectMusic } from "@/lib/music-upload";
import { moveItem } from "@/lib/listings";
import {
  ASPECTS, ASPECT_LABELS, FIRST_SCENE, LAST_SCENE, MAX_SCENES, MAX_TEXTS, STILL, TEXT_POSITIONS, TEXT_STYLES, TEXT_STYLE_LABELS,
  TRANSITIONS, TRANSITION_LABELS, fitToDuration, totalDuration, type Aspect, type EditPlan, type TextOverlay,
} from "@/lib/video/plan";
import { cn } from "@/lib/utils";
import { useHistory } from "@/lib/use-history";
import { UndoRedo } from "@/components/undo-redo";
import { PreviewPlayer } from "@/components/video/preview-player";

export interface EditorPhoto { id: string; url: string | null; thumb?: string | null; file_name: string }
export interface EditorMusic { id: string; url: string | null; file_name: string; duration_seconds: number | null }
export interface EditorRender {
  id: string; aspect: Aspect; status: "queued" | "running" | "succeeded" | "failed" | "cancelled"; progress: number;
  error_message: string | null; created_at: string; duration_seconds: number | null; width: number | null; height: number | null;
}

type SaveState = { kind: "saved" | "saving" | "pending" | "error" | "conflict"; message?: string };
type Tab = "scenes" | "text" | "music";

const DURATIONS = [1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
const uid = (p: string) => `${p}${Math.random().toString(36).slice(2, 9)}`;

export function VideoEditor({
  projectId, orgId, initialPlan, initialRevision, photos, initialMusic, initialRenders, brandColor, canDownload, clips = [],
}: {
  projectId: string; orgId: string; initialPlan: EditPlan; initialRevision: number; photos: EditorPhoto[];
  initialMusic: EditorMusic[]; initialRenders: EditorRender[]; brandColor: string; canDownload: boolean;
  /** AI camera clips of the listing (playable links), for the preview. */
  clips?: { id: string; url: string | null }[];
}) {
  const history = useHistory(initialPlan);
  const plan = history.value;
  const [save, setSave] = useState<SaveState>({ kind: "saved" });
  const [tab, setTab] = useState<Tab>("scenes");
  const [music, setMusic] = useState(initialMusic);
  const [renders, setRenders] = useState(initialRenders);
  const [exportAspects, setExportAspects] = useState<Aspect[]>([initialPlan.aspect]);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const revision = useRef(initialRevision);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const first = useRef(true);
  const latest = useRef(plan);
  latest.current = plan;

  const photoUrls = useMemo(() => Object.fromEntries(photos.map((p) => [p.id, p.url])), [photos]);
  const clipUrls = useMemo(() => Object.fromEntries(clips.map((c) => [c.id, c.url])), [clips]);
  const thumbUrls = useMemo(() => Object.fromEntries(photos.map((p) => [p.id, p.thumb ?? null])), [photos]);
  const photoIndex = useMemo(() => new Map(photos.map((p, i) => [p.id, i + 1])), [photos]);
  const total = totalDuration(plan);

  /* ── Autosave ──────────────────────────────────────────────────────── */
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

  /* ── Plan edits ───────────────────────────────────────────────────── */
  /** Every Advanced change is undoable; it also marks an Easy Mode project as hand-edited. */
  const update = (fn: (p: EditPlan) => EditPlan, mergeKey?: string) => history.set((p) => {
    const next = fn(structuredClone(p));
    return next.easy ? { ...next, easy: { ...next.easy, customized: true } } : next;
  }, mergeKey);
  const setScene = (i: number, patch: Partial<EditPlan["scenes"][number]>) => update((p) => { p.scenes[i] = { ...p.scenes[i]!, ...patch }; return p; });
  const moveScene = (from: number, to: number) => update((p) => ({ ...p, scenes: moveItem(p.scenes, from, to) }));
  const removeScene = (i: number) => update((p) => {
    const gone = p.scenes[i]!.id;
    return { ...p, scenes: p.scenes.filter((_, j) => j !== i), texts: p.texts.filter((t) => t.sceneId !== gone) };
  });
  const unused = photos.filter((ph) => !plan.scenes.some((s) => s.assetId === ph.id));
  const addScene = (assetId: string) => update((p) => ({ ...p, scenes: [...p.scenes, { id: uid("s"), assetId, move: "push_in", duration: 2 }] }));
  const setText = (id: string, patch: Partial<TextOverlay>, mergeKey?: string) => update((p) => ({ ...p, texts: p.texts.map((t) => (t.id === id ? { ...t, ...patch } : t)) }), mergeKey);
  const addText = () => update((p) => ({
    ...p, texts: [...p.texts, { id: uid("t"), text: "Your text here", sceneId: p.scenes[0]!.id, style: "caption", position: "bottom", duration: null }],
  }));

  /* ── Music upload ─────────────────────────────────────────────────── */
  const [musicBusy, setMusicBusy] = useState(false);
  const [musicMsg, setMusicMsg] = useState<string | null>(null);
  async function uploadMusic(file: File | undefined) {
    if (!file) return;
    setMusicBusy(true); setMusicMsg(null);
    try {
      const added = await uploadProjectMusic(orgId, projectId, file);
      setMusic((m) => [...m, added]);
      update((p) => ({ ...p, music: { ...p.music, assetId: added.id } }));
      setMusicMsg(`Added “${file.name}”.`);
    } catch (e) {
      setMusicMsg(e instanceof Error ? e.message : "The music couldn't be added.");
    } finally {
      setMusicBusy(false);
    }
  }

  /* ── Export ───────────────────────────────────────────────────────── */
  async function startExport() {
    setExportError(null); setExporting(true);
    if (save.kind !== "saved") await saveNow();
    const res = await fetch(`/api/projects/${projectId}/renders`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ aspects: exportAspects }),
    }).catch(() => null);
    setExporting(false);
    const body = await res?.json().catch(() => ({}));
    if (!res?.ok) { setExportError(body?.error ?? "The export couldn't start."); return; }
    setRenders((r) => [...body.renders, ...r]);
  }

  const sceneLabel = (sid: string) => sid === FIRST_SCENE ? "First scene" : sid === LAST_SCENE ? "Last scene"
    : `Scene ${plan.scenes.findIndex((s) => s.id === sid) + 1}`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SaveBadge state={save} onReload={() => window.location.reload()} />
        <div className="flex flex-wrap items-center gap-4">
          <p className="text-base text-muted-foreground">{plan.scenes.length} scenes · {total.toFixed(1)} seconds</p>
          <UndoRedo onUndo={history.undo} onRedo={history.redo} canUndo={history.canUndo} canRedo={history.canRedo} />
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {/* Preview + format + export */}
        <div className="flex flex-col gap-6">
          <Card><CardContent className="pt-6">
            <PreviewPlayer plan={plan} photoUrls={photoUrls} clipUrls={clipUrls} musicUrl={music.find((m) => m.id === plan.music.assetId)?.url ?? null} brandColor={brandColor} />
          </CardContent></Card>

          <Card>
            <CardHeader><CardTitle>Shape and style</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div role="radiogroup" aria-label="Video shape" className="grid grid-cols-3 gap-2">
                {ASPECTS.map((a) => (
                  <button key={a} type="button" role="radio" aria-checked={plan.aspect === a}
                    onClick={() => update((p) => ({ ...p, aspect: a }))}
                    className={cn("min-h-12 rounded-lg border-2 px-2 text-sm font-semibold", plan.aspect === a ? "border-primary bg-primary/5" : "border-border hover:border-primary/40")}>
                    {ASPECT_LABELS[a]}
                  </button>
                ))}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="transition">Between scenes</Label>
                  <NativeSelect id="transition" value={plan.transition} onChange={(e) => update((p) => ({ ...p, transition: e.target.value as EditPlan["transition"] }))}>
                    {TRANSITIONS.map((t) => <option key={t} value={t}>{TRANSITION_LABELS[t]}</option>)}
                  </NativeSelect>
                </div>
                <div className="flex flex-col gap-2">
                  <span className="text-sm font-semibold">Length</span>
                  <Button type="button" variant="outline" onClick={() => update((p) => fitToDuration(p, 30))}><Wand2 aria-hidden="true" />Fit to 30 seconds</Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Export MP4</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-4">
              <fieldset className="flex flex-wrap gap-3">
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
        </div>

        {/* Editing panels */}
        <Card className="self-start">
          <CardHeader className="pb-3">
            <div role="tablist" aria-label="What to edit" className="grid grid-cols-3 gap-2">
              {([["scenes", "Scenes"], ["text", "Text"], ["music", "Music"]] as const).map(([k, label]) => (
                <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                  className={cn("min-h-11 rounded-lg text-base font-semibold", tab === k ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground")}>
                  {label}
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent>
            {tab === "scenes" ? (
              <div className="flex flex-col gap-3">
                <p className="text-sm text-muted-foreground">Drag scenes to change the order. Choose how the camera moves on each photo.</p>
                <ol className="flex flex-col gap-2" aria-label="Scenes in order">
                  {plan.scenes.map((s, i) => (
                    <li key={s.id} draggable
                      onDragStart={() => setDragIndex(i)} onDragOver={(e) => { if (dragIndex !== null) e.preventDefault(); }}
                      onDrop={(e) => { e.preventDefault(); if (dragIndex !== null && dragIndex !== i) moveScene(dragIndex, i); setDragIndex(null); }}
                      onDragEnd={() => setDragIndex(null)}
                      className={cn("flex items-center gap-3 rounded-lg border bg-card p-2", dragIndex === i && "opacity-40")}>
                      <GripVertical className="size-5 shrink-0 cursor-grab text-muted-foreground" aria-hidden="true" />
                      {photoUrls[s.assetId] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={thumbUrls[s.assetId] ?? photoUrls[s.assetId]!} alt="" className="h-14 w-20 shrink-0 rounded-md object-cover" />
                      ) : <span className="h-14 w-20 shrink-0 rounded-md bg-muted" />}
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <span className="text-sm font-semibold">Scene {i + 1} <span className="font-normal text-muted-foreground">· photo {photoIndex.get(s.assetId)}</span></span>
                        <div className="flex flex-wrap gap-2">
                          <label className="sr-only" htmlFor={`move-${s.id}`}>Camera move for scene {i + 1}</label>
                          <NativeSelect id={`move-${s.id}`} className="h-9 w-40 text-sm" value={s.camera || s.clipAssetId ? "" : s.move}
                            onChange={(e) => { if (e.target.value) setScene(i, { move: e.target.value, camera: undefined, clipAssetId: undefined }); }}>
                            {s.camera || s.clipAssetId ? <option value="">{s.clipAssetId ? "AI clip" : `Studio: ${getStudioMove(s.camera!.move)?.name ?? "custom"}`}</option> : null}
                            <option value={STILL}>{STILL_NAME}</option>
                            {CAMERA_MOVES.map((m) => <option key={m.id} value={m.id}>{m.name}{m.aiOnly ? " (simple)" : ""}</option>)}
                          </NativeSelect>
                          <Button asChild size="sm" variant="outline" className="h-9">
                            <Link href={`/camera-studio?project=${projectId}&scene=${s.id}`} aria-label={`Camera Studio for scene ${i + 1}`}>
                              {s.clipAssetId ? <Sparkles aria-hidden="true" /> : <Clapperboard aria-hidden="true" />}Camera
                            </Link>
                          </Button>
                          <label className="sr-only" htmlFor={`dur-${s.id}`}>Length of scene {i + 1}</label>
                          <NativeSelect id={`dur-${s.id}`} className="h-9 w-24 text-sm" value={String(s.duration)} onChange={(e) => setScene(i, { duration: Number(e.target.value) })}>
                            {[...new Set([...DURATIONS, s.duration])].sort((a, b) => a - b).map((d) => <option key={d} value={d}>{d} s</option>)}
                          </NativeSelect>
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col gap-1">
                        <Button type="button" size="icon" variant="ghost" className="h-8 w-8" aria-label={`Move scene ${i + 1} earlier`} disabled={i === 0} onClick={() => moveScene(i, i - 1)}><ArrowLeft className="rotate-90" aria-hidden="true" /></Button>
                        <Button type="button" size="icon" variant="ghost" className="h-8 w-8" aria-label={`Move scene ${i + 1} later`} disabled={i === plan.scenes.length - 1} onClick={() => moveScene(i, i + 1)}><ArrowRight className="rotate-90" aria-hidden="true" /></Button>
                      </div>
                      <Button type="button" size="icon" variant="ghost" className="h-9 w-9 shrink-0 text-destructive hover:text-destructive" aria-label={`Remove scene ${i + 1}`} disabled={plan.scenes.length <= 1} onClick={() => removeScene(i)}><Trash2 aria-hidden="true" /></Button>
                    </li>
                  ))}
                </ol>
                {unused.length > 0 && plan.scenes.length < MAX_SCENES ? (
                  <div className="flex flex-col gap-2 border-t pt-3">
                    <Label htmlFor="add-photo">Add a photo from this listing</Label>
                    <NativeSelect id="add-photo" value="" onChange={(e) => { if (e.target.value) addScene(e.target.value); }}>
                      <option value="">Choose a photo…</option>
                      {unused.map((p) => <option key={p.id} value={p.id}>Photo {photoIndex.get(p.id)} — {p.file_name}</option>)}
                    </NativeSelect>
                  </div>
                ) : null}
              </div>
            ) : null}

            {tab === "text" ? (
              <div className="flex flex-col gap-4">
                {plan.texts.length === 0 ? <p className="text-base text-muted-foreground">No text yet.</p> : null}
                {plan.texts.map((t) => (
                  <div key={t.id} className="flex flex-col gap-3 rounded-lg border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2 text-sm font-semibold"><Type className="size-4" aria-hidden="true" />{sceneLabel(t.sceneId)}</span>
                      <Button type="button" size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => update((p) => ({ ...p, texts: p.texts.filter((x) => x.id !== t.id) }))}>
                        <Trash2 aria-hidden="true" />Remove
                      </Button>
                    </div>
                    <label className="sr-only" htmlFor={`text-${t.id}`}>Text</label>
                    <Textarea id={`text-${t.id}`} rows={2} maxLength={200} value={t.text} onChange={(e) => setText(t.id, { text: e.target.value }, `text-${t.id}`)} className="min-h-0" />
                    <div className="grid grid-cols-2 gap-3">
                      <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">Show on
                        <NativeSelect className="h-10 text-sm text-foreground" value={t.sceneId} onChange={(e) => setText(t.id, { sceneId: e.target.value })}>
                          <option value={FIRST_SCENE}>First scene</option>
                          <option value={LAST_SCENE}>Last scene</option>
                          {plan.scenes.map((s, i) => <option key={s.id} value={s.id}>Scene {i + 1}</option>)}
                        </NativeSelect>
                      </label>
                      <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">Style
                        <NativeSelect className="h-10 text-sm text-foreground" value={t.style} onChange={(e) => setText(t.id, { style: e.target.value as TextOverlay["style"] })}>
                          {TEXT_STYLES.map((s) => <option key={s} value={s}>{TEXT_STYLE_LABELS[s]}</option>)}
                        </NativeSelect>
                      </label>
                      <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">Position
                        <NativeSelect className="h-10 text-sm text-foreground" value={t.position} onChange={(e) => setText(t.id, { position: e.target.value as TextOverlay["position"] })}>
                          {TEXT_POSITIONS.map((s) => <option key={s} value={s}>{s[0]!.toUpperCase() + s.slice(1)}</option>)}
                        </NativeSelect>
                      </label>
                      <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">How long
                        <NativeSelect className="h-10 text-sm text-foreground" value={t.duration == null ? "" : String(t.duration)} onChange={(e) => setText(t.id, { duration: e.target.value ? Number(e.target.value) : null })}>
                          <option value="">Whole scene</option>
                          {[2, 3, 5, 8].map((d) => <option key={d} value={d}>{d} seconds</option>)}
                        </NativeSelect>
                      </label>
                    </div>
                  </div>
                ))}
                <Button type="button" variant="outline" className="self-start" disabled={plan.texts.length >= MAX_TEXTS} onClick={addText}><Plus aria-hidden="true" />Add text</Button>
              </div>
            ) : null}

            {tab === "music" ? (
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="music">Music</Label>
                  <NativeSelect id="music" value={plan.music.assetId ?? ""} onChange={(e) => update((p) => ({ ...p, music: { ...p.music, assetId: e.target.value || null } }))}>
                    <option value="">No music</option>
                    {music.map((m) => <option key={m.id} value={m.id}>{m.file_name}</option>)}
                  </NativeSelect>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="volume">Volume: {Math.round(plan.music.volume * 100)}%</Label>
                  <input id="volume" type="range" min={0} max={1} step={0.05} value={plan.music.volume}
                    onChange={(e) => update((p) => ({ ...p, music: { ...p.music, volume: Number(e.target.value) } }), "volume")} className="accent-[hsl(var(--primary))]" />
                </div>
                <label className="flex min-h-11 items-center gap-3 text-base">
                  <input type="checkbox" className="size-5 accent-[hsl(var(--primary))]" checked={plan.music.fadeOut}
                    onChange={(e) => update((p) => ({ ...p, music: { ...p.music, fadeOut: e.target.checked } }))} />
                  Fade out at the end
                </label>
                <label className={cn("flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 text-base font-semibold hover:border-primary/60", musicBusy && "pointer-events-none opacity-60")}>
                  {musicBusy ? <LoaderCircle className="size-5 animate-spin" aria-hidden="true" /> : <Upload className="size-5" aria-hidden="true" />}
                  {musicBusy ? "Uploading…" : "Upload music (MP3, M4A, WAV)"}
                  <input type="file" accept={MUSIC_MIME_TYPES.join(",")} className="sr-only" disabled={musicBusy} onChange={(e) => void uploadMusic(e.target.files?.[0])} />
                </label>
                {musicMsg ? <p role="status" className="text-sm">{musicMsg}</p> : null}
                <p className="flex items-start gap-2 text-sm text-muted-foreground"><Music className="mt-0.5 size-4 shrink-0" aria-hidden="true" />Use only music your company has the rights to use in advertising.</p>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
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

function RenderList({ projectId, renders, canDownload }: { projectId: string; renders: EditorRender[]; canDownload: boolean }) {
  if (renders.length === 0) return <p className="text-sm text-muted-foreground">Your finished videos will appear here.</p>;
  return (
    <ul className="flex flex-col divide-y rounded-lg border">
      {renders.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center gap-3 px-3 py-3">
          <span className="w-36 text-sm font-semibold">{ASPECT_LABELS[r.aspect]}</span>
          <span className="flex-1 text-sm text-muted-foreground">
            {r.status === "queued" ? "Waiting to start…" : null}
            {r.status === "running" ? (
              <span className="flex items-center gap-2">
                <span className="h-2 w-32 overflow-hidden rounded-full bg-muted"><span className="block h-2 bg-primary" style={{ width: `${Math.round(r.progress * 100)}%` }} /></span>
                {Math.round(r.progress * 100)}%
              </span>
            ) : null}
            {r.status === "succeeded" ? `Ready · ${r.width}×${r.height} · ${Math.round(r.duration_seconds ?? 0)} s` : null}
            {r.status === "failed" ? <span className="text-destructive">Didn&apos;t finish: {r.error_message ?? "unknown problem"}</span> : null}
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
