"use client";
/* Easy editor: preview, photo order, style, music, text, camera movement, generate and download — nothing else. */
import { useState } from "react";
import { ArrowLeft, ArrowRight, Download, GripVertical, LoaderCircle, Plus, Trash2, Upload, Wand2, X } from "lucide-react";
import { DEFAULT_GIMBAL, EASY_CAMERAS, easySpec, type EasyCameraId } from "@lvs/camera-presets";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MUSIC_MIME_TYPES } from "@/lib/storage";
import { uploadProjectMusic } from "@/lib/music-upload";
import { moveItem } from "@/lib/listings";
import { ASPECTS, ASPECT_LABELS, FIRST_SCENE, LAST_SCENE, MAX_SCENES, MAX_TEXTS, type Aspect, type EditPlan } from "@/lib/video/plan";
import { STYLES, STYLE_IDS, buildEasyPlan, type EasyBrand, type EasyListing, type StyleId } from "@/lib/video/easy";
import { cn } from "@/lib/utils";
import { PreviewPlayer } from "@/components/video/preview-player";
import type { EditorMusic, EditorPhoto, EditorRender } from "./video-editor";

type Update = (fn: (p: EditPlan) => EditPlan, mergeKey?: string) => void;
const uid = (p: string) => `${p}${Math.random().toString(36).slice(2, 9)}`;
const CAMERA_LABEL = Object.fromEntries(EASY_CAMERAS.map((c) => [c.id, c.name])) as Record<EasyCameraId, string>;

export function EasyEditor(p: {
  plan: EditPlan; update: Update; photos: EditorPhoto[]; photoUrls: Record<string, string | null>; thumbUrls: Record<string, string | null>;
  clipUrls: Record<string, string | null>; music: EditorMusic[]; musicUrl: string | null; voiceUrl: string | null; brandColor: string;
  listing: EasyListing | null; brand: EasyBrand | null; orgId: string; projectId: string; onAudio: (a: EditorMusic) => void;
  renders: EditorRender[]; canDownload: boolean; exporting: boolean; exportError: string | null; onGenerate: (aspect: Aspect) => void;
}) {
  const { plan, update } = p;
  const [drag, setDrag] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [where, setWhere] = useState<string>(FIRST_SCENE);
  const [authorized, setAuthorized] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [shape, setShape] = useState<Aspect>(plan.aspect);
  const unused = p.photos.filter((ph) => !plan.scenes.some((s) => s.assetId === ph.id));
  const tracks = p.music.filter((m) => m.id !== plan.voiceover?.assetId && !m.file_name.startsWith("Narration"));
  const done = p.renders.filter((r) => r.status === "succeeded");

  /** Restyle with an Easy style, keeping the photo order, music, narration and captions. */
  const changeStyle = (style: StyleId) => {
    if (!p.listing) return;
    update((cur) => {
      const next = buildEasyPlan({
        listing: p.listing!, brand: p.brand, order: cur.scenes.map((s) => s.assetId),
        photos: [...new Set(cur.scenes.map((s) => s.assetId))].map((id) => ({ id })),
        settings: { style, duration: ([15, 30, 60] as const).find((d) => d === cur.easy?.duration) ?? STYLES[style].duration, aspect: cur.aspect, musicAssetId: cur.music.assetId, showBranding: cur.easy?.showBranding ?? true, aiEffects: false },
      });
      return { ...next, music: { ...cur.music, ...next.music, assetId: cur.music.assetId, volume: cur.music.volume }, voiceover: cur.voiceover, captions: cur.captions, overlays: cur.overlays, logoAssetId: cur.logoAssetId, branding: cur.branding, look: cur.look };
    });
  };
  const cameraForAll = (id: EasyCameraId) => update((cur) => ({ ...cur, scenes: cur.scenes.map((s) => (s.clipAssetId ? s : { ...s, camera: { ...easySpec(id, "normal"), fit: "contain" as const, gimbal: DEFAULT_GIMBAL }, move: "still", position: undefined, segment: undefined })) }));
  const cameraOf = (s: EditPlan["scenes"][number]): string => {
    if (s.clipAssetId) return "ai";
    if (!s.camera) return s.move === "still" ? "still" : "simple";
    const e = EASY_CAMERAS.find((c) => c.move === s.camera!.move);
    return e?.id ?? "custom";
  };

  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy(true); setMsg(null);
    try {
      const added = await uploadProjectMusic(p.orgId, p.projectId, file, { authorized, purpose: "music" });
      p.onAudio(added);
      update((cur) => ({ ...cur, music: { ...cur.music, assetId: added.id } }));
      setMsg(`Added “${file.name}”.`);
    } catch (e) { setMsg(e instanceof Error ? e.message : "Upload failed."); }
    setBusy(false);
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="flex flex-col gap-4">
        <Card><CardHeader className="pb-2"><CardTitle>Video preview</CardTitle></CardHeader><CardContent>
          <PreviewPlayer plan={plan} photoUrls={p.photoUrls} photoSizes={Object.fromEntries(p.photos.map((x) => [x.id, { width: x.width ?? null, height: x.height ?? null }]))} clipUrls={p.clipUrls} musicUrl={p.musicUrl} voiceUrl={p.voiceUrl} brandColor={p.brandColor} />
        </CardContent></Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle>Photo order and camera movement</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">Drag photos to change the order. Pick how the camera moves on each one.</p>
            <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="Photos in order">
              {plan.scenes.map((s, i) => (
                <li key={s.id} draggable onDragStart={() => setDrag(i)} onDragOver={(e) => { if (drag !== null) e.preventDefault(); }}
                  onDrop={(e) => { e.preventDefault(); if (drag !== null && drag !== i) update((cur) => ({ ...cur, scenes: moveItem(cur.scenes, drag, i) })); setDrag(null); }}
                  onDragEnd={() => setDrag(null)} className={cn("flex flex-col gap-1 rounded-lg border bg-card p-1.5", drag === i && "opacity-40")}>
                  <div className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {p.thumbUrls[s.assetId] ? <img src={p.thumbUrls[s.assetId]!} alt="" className="aspect-video w-full rounded-md object-cover" /> : <span className="block aspect-video rounded-md bg-muted" />}
                    <span className="absolute left-1 top-1 flex items-center gap-1 rounded bg-black/70 px-1.5 text-xs font-bold text-white"><GripVertical className="size-3" aria-hidden="true" />{i + 1}</span>
                    <button type="button" aria-label={`Remove photo ${i + 1}`} disabled={plan.scenes.length <= 1} onClick={() => update((cur) => ({ ...cur, scenes: cur.scenes.filter((x) => x.id !== s.id), texts: cur.texts.filter((t) => t.sceneId !== s.id) }))}
                      className="absolute right-1 top-1 rounded-full bg-black/70 p-1 text-white disabled:opacity-30"><X className="size-3" /></button>
                  </div>
                  <label className="sr-only" htmlFor={`cam-${s.id}`}>Camera movement for photo {i + 1}</label>
                  <NativeSelect id={`cam-${s.id}`} className="h-9 text-xs" value={cameraOf(s)} onChange={(e) => {
                    const v = e.target.value;
                    update((cur) => ({ ...cur, scenes: cur.scenes.map((x) => (x.id !== s.id ? x : v === "still" ? { ...x, move: "still", camera: undefined, position: undefined, segment: undefined } : { ...x, move: "still", camera: { ...easySpec(v as EasyCameraId, "normal"), fit: "contain" as const, gimbal: DEFAULT_GIMBAL }, position: undefined, segment: undefined })) }));
                  }}>
                    {cameraOf(s) === "ai" ? <option value="ai">AI camera clip</option> : null}
                    {cameraOf(s) === "custom" || cameraOf(s) === "simple" ? <option value={cameraOf(s)}>Custom move</option> : null}
                    <option value="still">Hold still</option>
                    {EASY_CAMERAS.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </NativeSelect>
                  <div className="flex justify-between">
                    <Button type="button" size="icon" variant="ghost" className="h-7 w-7" aria-label={`Move photo ${i + 1} earlier`} disabled={i === 0} onClick={() => update((cur) => ({ ...cur, scenes: moveItem(cur.scenes, i, i - 1) }))}><ArrowLeft aria-hidden="true" /></Button>
                    <span className="text-xs text-muted-foreground">{s.duration}s</span>
                    <Button type="button" size="icon" variant="ghost" className="h-7 w-7" aria-label={`Move photo ${i + 1} later`} disabled={i === plan.scenes.length - 1} onClick={() => update((cur) => ({ ...cur, scenes: moveItem(cur.scenes, i, i + 1) }))}><ArrowRight aria-hidden="true" /></Button>
                  </div>
                </li>
              ))}
            </ol>
            <div className="flex flex-wrap items-center gap-2 border-t pt-3">
              <span className="text-sm font-semibold">Same movement for every photo:</span>
              {EASY_CAMERAS.map((c) => <Button key={c.id} type="button" size="sm" variant="outline" onClick={() => cameraForAll(c.id)}>{CAMERA_LABEL[c.id]}</Button>)}
            </div>
            {unused.length && plan.scenes.length < MAX_SCENES ? (
              <NativeSelect value="" aria-label="Add a photo" onChange={(e) => { const id = e.target.value; if (id) update((cur) => ({ ...cur, scenes: [...cur.scenes, { id: uid("s"), assetId: id, move: "push_in", duration: 3 }] })); }}>
                <option value="">+ Add a photo from the listing…</option>
                {unused.map((u) => <option key={u.id} value={u.id}>{u.file_name}</option>)}
              </NativeSelect>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle>Change style</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-2">
            {STYLE_IDS.map((id) => (
              <button key={id} type="button" disabled={!p.listing} onClick={() => changeStyle(id)}
                className={cn("flex min-h-14 flex-col items-start rounded-lg border-2 px-3 py-2 text-left disabled:opacity-50", plan.easy?.style === id ? "border-primary bg-primary/5" : "border-border hover:border-primary/40")}>
                <span className="text-sm font-semibold">{STYLES[id].name}</span><span className="text-xs text-muted-foreground">{STYLES[id].description}</span>
              </button>
            ))}
            <p className="col-span-2 text-xs text-muted-foreground">Keeps your photo order, music, narration and captions; replaces the text and camera moves.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle>Change music</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-3">
            <NativeSelect aria-label="Music" value={plan.music.assetId ?? ""} onChange={(e) => update((cur) => ({ ...cur, music: { ...cur.music, assetId: e.target.value || null } }))}>
              <option value="">No music</option>
              {tracks.map((t) => <option key={t.id} value={t.id}>{t.file_name}</option>)}
            </NativeSelect>
            <label className="flex flex-col gap-1 text-sm font-semibold">Volume: {Math.round(plan.music.volume * 100)}%
              <input type="range" min={0} max={1} step={0.05} value={plan.music.volume} onChange={(e) => update((cur) => ({ ...cur, music: { ...cur.music, volume: Number(e.target.value) } }), "volume")} className="accent-[hsl(var(--primary))]" />
            </label>
            <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={authorized} onChange={(e) => setAuthorized(e.target.checked)} className="mt-0.5" />My company is authorised to use this music in advertising.</label>
            <label className={cn("inline-flex min-h-10 cursor-pointer items-center gap-2 self-start rounded-lg border px-3 text-sm font-semibold", (!authorized || busy) && "pointer-events-none opacity-50")}>
              {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Upload className="size-4" aria-hidden="true" />}Upload music
              <input type="file" accept={MUSIC_MIME_TYPES.join(",")} className="sr-only" disabled={!authorized || busy} onChange={(e) => void upload(e.target.files?.[0])} />
            </label>
            {msg ? <p role="status" className="text-sm">{msg}</p> : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle>Add text</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Input value={text} maxLength={200} onChange={(e) => setText(e.target.value)} placeholder="e.g. Open house Sunday 1–3 PM" aria-label="Text to add" />
            <div className="flex gap-2">
              <NativeSelect aria-label="Where" value={where} onChange={(e) => setWhere(e.target.value)}>
                <option value={FIRST_SCENE}>First photo</option><option value={LAST_SCENE}>Last photo</option>
                {plan.scenes.map((s, i) => <option key={s.id} value={s.id}>Photo {i + 1}</option>)}
              </NativeSelect>
              <Button type="button" disabled={!text.trim() || plan.texts.length >= MAX_TEXTS} onClick={() => { update((cur) => ({ ...cur, texts: [...cur.texts, { id: uid("t"), text: text.trim(), sceneId: where, style: "caption", position: "bottom", duration: null }] })); setText(""); }}><Plus aria-hidden="true" />Add</Button>
            </div>
            {plan.texts.length ? (
              <ul className="flex flex-col gap-1">
                {plan.texts.map((t) => (
                  <li key={t.id} className="flex items-center gap-2 rounded-md border px-2 py-1 text-sm">
                    <span className="flex-1 truncate">{t.text.replace(/\n/g, " · ")}</span>
                    <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-destructive" aria-label={`Remove “${t.text}”`} onClick={() => update((cur) => ({ ...cur, texts: cur.texts.filter((x) => x.id !== t.id) }))}><Trash2 aria-hidden="true" /></Button>
                  </li>
                ))}
              </ul>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle>Generate and download</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div role="radiogroup" aria-label="Video shape" className="grid grid-cols-2 gap-2">
              {ASPECTS.map((a) => (
                <button key={a} type="button" role="radio" aria-checked={shape === a} onClick={() => { setShape(a); update((cur) => ({ ...cur, aspect: a })); }}
                  className={cn("min-h-11 rounded-lg border-2 text-sm font-semibold", shape === a ? "border-primary bg-primary/5" : "border-border")}>{ASPECT_LABELS[a]}</button>
              ))}
            </div>
            <Button size="lg" className="bg-brand text-white hover:bg-brand/90" disabled={p.exporting} onClick={() => p.onGenerate(shape)}>
              {p.exporting ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Wand2 aria-hidden="true" />}{p.exporting ? "Making your video…" : "Generate video"}
            </Button>
            {p.exportError ? <Alert variant="destructive"><AlertDescription>{p.exportError}</AlertDescription></Alert> : null}
            {done.length ? (
              <ul className="flex flex-col gap-2">
                {done.slice(0, 4).map((r) => (
                  <li key={r.id} className="flex items-center gap-2 text-sm">
                    <span className="flex-1">{ASPECT_LABELS[r.aspect] ?? r.aspect} · {Math.round(r.duration_seconds ?? 0)} s</span>
                    {p.canDownload ? <Button asChild size="sm"><a href={`/api/projects/${p.projectId}/renders/${r.id}/download`}><Download aria-hidden="true" />Download</a></Button> : <span className="text-muted-foreground">Downloads are off</span>}
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted-foreground">Your finished videos will appear here to download.</p>}
            {p.renders.some((r) => r.status === "queued" || r.status === "running") ? <p className="flex items-center gap-2 text-sm"><LoaderCircle className="size-4 animate-spin" aria-hidden="true" />Rendering… {Math.round((p.renders.find((r) => r.status === "running")?.progress ?? 0) * 100)}%</p> : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
