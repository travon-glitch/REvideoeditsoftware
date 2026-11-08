"use client";
/* Inspector panels of the Advanced editor: scene, text, overlay, narration (AI voice), captions and music. */
import { useState } from "react";
import Link from "next/link";
import { Sparkles, Clapperboard, Diamond, LoaderCircle, Mic, Play, Plus, Trash2, Upload, Wand2 } from "lucide-react";
import { CAMERA_MOVES, STILL_NAME, getStudioMove } from "@lvs/camera-presets";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { MUSIC_MIME_TYPES } from "@/lib/storage";
import { uploadProjectMusic } from "@/lib/music-upload";
import {
  ANIM_IN, ANIM_OUT, CAPTION_STYLES, CAPTION_STYLE_LABELS, FIRST_SCENE, LAST_SCENE, OVERLAY_LABELS, OVERLAY_PRESETS, STILL, TEXT_POSITIONS, TEXT_STYLES,
  TEXT_STYLE_LABELS, TRANSITIONS, TRANSITION_LABELS, totalDuration, type Captions, type Cue, type EditPlan, type ItemKey, type Overlay, type TextOverlay,
} from "@/lib/video/plan";
import { textStart } from "@/lib/video/timeline";
import type { EditorMusic } from "./video-editor";

type Update = (fn: (p: EditPlan) => EditPlan, mergeKey?: string) => void;
const r2 = (n: number) => Math.round(n * 100) / 100;

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">{label}{children}{hint ? <span className="font-normal">{hint}</span> : null}</label>;
}
function Slider({ label, value, min, max, step, onChange, suffix = "" }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; suffix?: string }) {
  return (
    <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
      <span className="flex justify-between"><span>{label}</span><span className="tabular-nums text-foreground">{Number.isInteger(step) ? value : value.toFixed(2)}{suffix}</span></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="accent-[hsl(var(--primary))]" />
    </label>
  );
}

/* ── Keyframes (texts and overlays) ─────────────────────────────────── */
function Keyframes({ keys, local, length, current, onChange }: {
  keys: ItemKey[] | undefined; local: number; length: number; current: { x: number; y: number; scale: number; opacity: number; rotation: number };
  onChange: (keys: ItemKey[] | undefined) => void;
}) {
  const list = [...(keys ?? [])].sort((a, b) => a.t - b.t);
  const inside = local >= 0 && local <= length;
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-2">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1 text-xs font-semibold"><Diamond className="size-3.5" aria-hidden="true" />Keyframes</span>
        <Button type="button" size="sm" variant="outline" disabled={!inside || list.length >= 24}
          onClick={() => onChange([...list.filter((k) => Math.abs(k.t - local) > 0.05), { t: r2(local), x: current.x, y: current.y, scale: current.scale, opacity: current.opacity, rotation: current.rotation, ease: "ease-in-out" as const }].sort((a, b) => a.t - b.t))}>
          <Plus aria-hidden="true" />Add at playhead
        </Button>
      </div>
      {!list.length ? <p className="text-xs text-muted-foreground">Move the playhead over this item, set position and size, then add a keyframe. Two or more keyframes animate it.</p> : null}
      {list.map((k, i) => (
        <div key={i} className="grid grid-cols-[auto_repeat(4,minmax(0,1fr))_auto] items-end gap-1 text-[11px]">
          <span className="pb-2 font-semibold">{k.t.toFixed(2)}s</span>
          {(["x", "y", "scale", "opacity"] as const).map((n) => (
            <Field key={n} label={n}>
              <Input className="h-8 px-1 text-xs" type="number" step={n === "scale" ? 0.05 : 0.01} value={k[n] ?? ""} aria-label={`Keyframe ${i + 1} ${n}`}
                onChange={(e) => onChange(list.map((x, j) => (j === i ? { ...x, [n]: e.target.value === "" ? undefined : Number(e.target.value) } : x)))} />
            </Field>
          ))}
          <Button type="button" size="icon" variant="ghost" className="h-8 w-8 text-destructive" aria-label={`Delete keyframe ${i + 1}`} onClick={() => { const rest = list.filter((_, j) => j !== i); onChange(rest.length ? rest : undefined); }}><Trash2 aria-hidden="true" /></Button>
        </div>
      ))}
    </div>
  );
}

/* ── Scene ──────────────────────────────────────────────────────────── */
export function SceneInspector({ plan, id, update, projectId, thumb, aiClips, onSplit, onDuplicate, onDelete }: {
  plan: EditPlan; id: string; update: Update; projectId: string; thumb: string | null; aiClips: { id: string; sourceAssetId: string | null; label: string }[];
  onSplit: () => void; onDuplicate: () => void; onDelete: () => void;
}) {
  const i = plan.scenes.findIndex((s) => s.id === id);
  const s = plan.scenes[i];
  if (!s) return null;
  const set = (patch: Partial<typeof s>, key?: string) => update((p) => ({ ...p, scenes: p.scenes.map((x) => (x.id === id ? { ...x, ...patch } : x)) }), key);
  const pos = s.position ?? { x: 0, y: 0, zoom: 1, rotation: 0 };
  const placing = !!s.position;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {thumb ? <img src={thumb} alt="" className="h-16 w-24 rounded-md object-cover" /> : null}
        <div><p className="font-semibold">Scene {i + 1}</p><p className="text-xs text-muted-foreground">{s.clipAssetId ? "AI camera clip" : "Photo"} · {s.duration}s</p></div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Length (seconds)"><Input type="number" min={1.5} max={10} step={0.1} value={s.duration} onChange={(e) => set({ duration: Math.min(10, Math.max(1.5, Number(e.target.value) || 1.5)) }, `dur-${id}`)} /></Field>
        <Field label="Camera move">
          <NativeSelect value={s.camera || s.clipAssetId || placing ? "" : s.move} onChange={(e) => { if (e.target.value) set({ move: e.target.value, camera: undefined, position: undefined, segment: undefined }); }}>
            {s.camera || s.clipAssetId || placing ? <option value="">{s.clipAssetId ? "AI clip" : placing ? "Placed by hand" : `Studio: ${getStudioMove(s.camera!.move)?.name ?? "custom"}`}</option> : null}
            <option value={STILL}>{STILL_NAME}</option>
            {CAMERA_MOVES.filter((m) => !m.aiOnly).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </NativeSelect>
        </Field>
        {i > 0 ? (
          <>
            <Field label="Transition in">
              <NativeSelect value={s.transition ?? ""} onChange={(e) => set({ transition: (e.target.value || undefined) as typeof s.transition })}>
                <option value="">Video default ({TRANSITION_LABELS[plan.transition]})</option>
                {TRANSITIONS.map((t) => <option key={t} value={t}>{TRANSITION_LABELS[t]}</option>)}
              </NativeSelect>
            </Field>
            <Slider label="Transition length" value={s.transitionSeconds ?? 0.5} min={0.2} max={1.5} step={0.1} suffix="s" onChange={(v) => set({ transitionSeconds: v }, `trs-${id}`)} />
          </>
        ) : null}
      </div>
      {!s.clipAssetId ? (
        <div className="flex flex-col gap-2 rounded-lg border p-2">
          <label className="flex items-center gap-2 text-xs font-semibold">
            <input type="checkbox" checked={placing} onChange={(e) => set(e.target.checked ? { position: { x: 0, y: 0, zoom: 1.2, rotation: 0 }, move: STILL, camera: undefined, segment: undefined } : { position: undefined })} />
            Reposition the photo by hand (stays still)
          </label>
          {placing ? (
            <div className="grid grid-cols-2 gap-2">
              <Slider label="Left / right" value={pos.x} min={-0.5} max={0.5} step={0.01} onChange={(v) => set({ position: { ...pos, x: v } }, `pos-${id}`)} />
              <Slider label="Up / down" value={pos.y} min={-0.5} max={0.5} step={0.01} onChange={(v) => set({ position: { ...pos, y: v } }, `pos-${id}`)} />
              <Slider label="Zoom" value={pos.zoom} min={1} max={3} step={0.05} suffix="×" onChange={(v) => set({ position: { ...pos, zoom: v } }, `pos-${id}`)} />
              <Slider label="Turn" value={pos.rotation} min={-15} max={15} step={0.5} suffix="°" onChange={(v) => set({ position: { ...pos, rotation: v } }, `pos-${id}`)} />
            </div>
          ) : null}
        </div>
      ) : (
        <Slider label="AI clip starts at (trim)" value={s.clipIn ?? 0} min={0} max={4} step={0.1} suffix="s" onChange={(v) => set({ clipIn: v }, `clipin-${id}`)} />
      )}
      {aiClips.some((c) => c.sourceAssetId === s.assetId) && !s.clipAssetId ? (
        <Field label="Use an AI camera clip of this photo">
          <NativeSelect value="" onChange={(e) => { if (e.target.value) set({ clipAssetId: e.target.value, clipIn: 0, position: undefined }); }}>
            <option value="">Choose a clip…</option>
            {aiClips.filter((c) => c.sourceAssetId === s.assetId).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </NativeSelect>
        </Field>
      ) : null}
      {s.clipAssetId ? <Button type="button" size="sm" variant="outline" onClick={() => set({ clipAssetId: undefined, clipIn: undefined })}>Use the photo instead</Button> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onSplit}>Split at playhead</Button>
        <Button type="button" size="sm" variant="outline" onClick={onDuplicate}>Duplicate</Button>
        <Button type="button" size="sm" variant="outline" asChild><Link href={`/camera-studio?project=${projectId}&scene=${s.id}`}><Clapperboard aria-hidden="true" />Camera Studio</Link></Button>
        <Button type="button" size="sm" variant="outline" asChild><Link href={`/camera-studio?project=${projectId}&scene=${s.id}&mode=ai`}><Sparkles aria-hidden="true" />AI Camera Control</Link></Button>
        <Button type="button" size="sm" variant="ghost" className="text-destructive" disabled={plan.scenes.length <= 1} onClick={onDelete}><Trash2 aria-hidden="true" />Delete</Button>
      </div>
    </div>
  );
}

/* ── Text ───────────────────────────────────────────────────────────── */
export function TextInspector({ plan, id, update, time }: { plan: EditPlan; id: string; update: Update; time: number }) {
  const t = plan.texts.find((x) => x.id === id);
  if (!t) return null;
  const set = (patch: Partial<TextOverlay>, key?: string) => update((p) => ({ ...p, texts: p.texts.map((x) => (x.id === id ? { ...x, ...patch } : x)) }), key);
  const start = textStart(plan, t);
  const free = t.x != null || t.y != null;
  const presetY = t.position === "top" ? -0.32 : t.position === "bottom" ? 0.3 : 0;
  return (
    <div className="flex flex-col gap-3">
      <Field label="Text"><Textarea rows={2} maxLength={200} value={t.text} onChange={(e) => set({ text: e.target.value }, `text-${id}`)} /></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Style"><NativeSelect value={t.style} onChange={(e) => set({ style: e.target.value as TextOverlay["style"] })}>{TEXT_STYLES.map((s) => <option key={s} value={s}>{TEXT_STYLE_LABELS[s]}</option>)}</NativeSelect></Field>
        <Field label="Show on">
          <NativeSelect value={t.sceneId} onChange={(e) => set({ sceneId: e.target.value, offset: undefined })}>
            <option value={FIRST_SCENE}>First scene</option><option value={LAST_SCENE}>Last scene</option>
            {plan.scenes.map((s, i) => <option key={s.id} value={s.id}>Scene {i + 1}</option>)}
          </NativeSelect>
        </Field>
        <Field label="Starts after (s)"><Input type="number" min={0} max={10} step={0.1} value={t.offset ?? 0} onChange={(e) => set({ offset: Math.max(0, Number(e.target.value) || 0) || undefined }, `off-${id}`)} /></Field>
        <Field label="How long (s)"><Input type="number" min={1} max={30} step={0.5} value={t.duration ?? ""} placeholder="Whole scene" onChange={(e) => set({ duration: e.target.value ? Math.max(1, Number(e.target.value)) : null }, `tdur-${id}`)} /></Field>
      </div>
      <div className="flex flex-col gap-2 rounded-lg border p-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold">Position</span>
          {free ? <Button type="button" size="sm" variant="ghost" onClick={() => set({ x: undefined, y: undefined })}>Back to {t.position}</Button> : null}
        </div>
        {!free ? (
          <div className="flex gap-2">
            {TEXT_POSITIONS.map((p) => <Button key={p} type="button" size="sm" variant={t.position === p ? "default" : "outline"} onClick={() => set({ position: p })}>{p[0]!.toUpperCase() + p.slice(1)}</Button>)}
            <Button type="button" size="sm" variant="outline" onClick={() => set({ x: 0, y: presetY })}>Free</Button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <Slider label="Left / right" value={t.x ?? 0} min={-0.5} max={0.5} step={0.01} onChange={(v) => set({ x: v }, `tx-${id}`)} />
            <Slider label="Up / down" value={t.y ?? presetY} min={-0.5} max={0.5} step={0.01} onChange={(v) => set({ y: v }, `ty-${id}`)} />
          </div>
        )}
      </div>
      <Keyframes keys={t.keys} local={time - start} length={t.duration ?? 30} current={{ x: t.x ?? 0, y: t.y ?? presetY, scale: 1, opacity: 1, rotation: 0 }}
        onChange={(keys) => set({ keys, ...(keys && t.x == null ? { x: 0, y: presetY } : {}) })} />
      <Button type="button" size="sm" variant="ghost" className="self-start text-destructive" onClick={() => update((p) => ({ ...p, texts: p.texts.filter((x) => x.id !== id) }))}><Trash2 aria-hidden="true" />Remove text</Button>
    </div>
  );
}

/* ── Overlay ────────────────────────────────────────────────────────── */
export function OverlayInspector({ plan, id, update, time }: { plan: EditPlan; id: string; update: Update; time: number }) {
  const o = (plan.overlays ?? []).find((x) => x.id === id);
  if (!o) return null;
  const set = (patch: Partial<Overlay>, key?: string) => update((p) => ({ ...p, overlays: (p.overlays ?? []).map((x) => (x.id === id ? { ...x, ...patch } : x)) }), key);
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <Field label="Overlay"><NativeSelect value={o.preset} onChange={(e) => set({ preset: e.target.value as Overlay["preset"] })}>{OVERLAY_PRESETS.map((p) => <option key={p} value={p}>{OVERLAY_LABELS[p]}</option>)}</NativeSelect></Field>
        <Field label="Colour"><Input type="color" className="h-10 p-1" value={o.color} onChange={(e) => set({ color: e.target.value }, `oc-${id}`)} /></Field>
        <Field label="Words (optional)"><Input maxLength={60} value={o.text ?? ""} onChange={(e) => set({ text: e.target.value || undefined }, `ot-${id}`)} /></Field>
        <Field label="Starts at (s)"><Input type="number" min={0} step={0.1} value={o.start} onChange={(e) => set({ start: Math.max(0, Number(e.target.value) || 0) }, `os-${id}`)} /></Field>
        <Field label="How long (s)"><Input type="number" min={0.3} step={0.1} value={o.duration} onChange={(e) => set({ duration: Math.max(0.3, Number(e.target.value) || 0.3) }, `od-${id}`)} /></Field>
        <Field label="Animate in"><NativeSelect value={o.animIn} onChange={(e) => set({ animIn: e.target.value as Overlay["animIn"] })}>{ANIM_IN.map((a) => <option key={a} value={a}>{a}</option>)}</NativeSelect></Field>
        <Field label="Animate out"><NativeSelect value={o.animOut} onChange={(e) => set({ animOut: e.target.value as Overlay["animOut"] })}>{ANIM_OUT.map((a) => <option key={a} value={a}>{a}</option>)}</NativeSelect></Field>
        <Slider label="Left / right" value={o.x} min={-0.5} max={0.5} step={0.01} onChange={(v) => set({ x: v }, `ox-${id}`)} />
        <Slider label="Up / down" value={o.y} min={-0.5} max={0.5} step={0.01} onChange={(v) => set({ y: v }, `oy-${id}`)} />
        <Slider label="Size" value={o.scale} min={0.2} max={3} step={0.05} suffix="×" onChange={(v) => set({ scale: v }, `osc-${id}`)} />
        <Slider label="Turn" value={o.rotation ?? 0} min={-180} max={180} step={1} suffix="°" onChange={(v) => set({ rotation: v }, `or-${id}`)} />
      </div>
      <Keyframes keys={o.keys} local={time - o.start} length={o.duration} current={{ x: o.x, y: o.y, scale: o.scale, opacity: 1, rotation: o.rotation ?? 0 }} onChange={(keys) => set({ keys })} />
      <Button type="button" size="sm" variant="ghost" className="self-start text-destructive" onClick={() => update((p) => ({ ...p, overlays: (p.overlays ?? []).filter((x) => x.id !== id) }))}><Trash2 aria-hidden="true" />Remove overlay</Button>
    </div>
  );
}

/* ── Narration (AI voice) ───────────────────────────────────────────── */
export interface VoiceOption { id: string; name: string; accent: string; gender: string }

export function VoicePanel({ plan, update, projectId, orgId, voices, ready, onAudio }: {
  plan: EditPlan; update: Update; projectId: string; orgId: string; voices: VoiceOption[]; ready: { tts: boolean; asr: boolean };
  onAudio: (a: EditorMusic) => void;
}) {
  const vo = plan.voiceover;
  const [script, setScript] = useState(vo?.script ?? "");
  const [voice, setVoice] = useState(vo?.voice ?? voices[0]?.id ?? "af_heart");
  const [speed, setSpeed] = useState(vo?.speed ?? 1);
  const [tone, setTone] = useState<"warm" | "luxury" | "concise">("warm");
  const [busy, setBusy] = useState<null | "draft" | "preview" | "make" | "upload">(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [warnings, setWarnings] = useState<{ sentence: string; reason: string }[]>([]);
  const [unknown, setUnknown] = useState<string[]>([]);
  const [authorized, setAuthorized] = useState(false);
  const post = (path: string, body: unknown) => fetch(`/api/projects/${projectId}/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  async function draft() {
    setBusy("draft"); setMsg(null);
    const res = await post("voiceover/draft", { tone }).catch(() => null);
    const body = await res?.json().catch(() => ({}));
    setBusy(null);
    if (!res?.ok) { setMsg({ ok: false, text: body?.error ?? "No draft." }); return; }
    setScript(body.script); setWarnings(body.warnings ?? []);
  }
  async function check(text: string) {
    const res = await post("voiceover/draft", { check: text }).catch(() => null);
    if (res?.ok) setWarnings((await res.json()).warnings ?? []);
  }
  async function preview() {
    setBusy("preview"); setMsg(null);
    const res = await post("voiceover/preview", { script, voice, speed }).catch(() => null);
    setBusy(null);
    if (!res?.ok) { const b = await res?.json().catch(() => ({})); setMsg({ ok: false, text: b?.error ?? "No preview." }); return; }
    const url = URL.createObjectURL(await res.blob());
    const a = new Audio(url);
    a.onended = () => URL.revokeObjectURL(url);
    void a.play();
  }
  async function make() {
    setBusy("make"); setMsg({ ok: true, text: "Recording the narration… this takes about as long as the narration itself." });
    const res = await post("voiceover", { script, voice, speed, start: vo?.start ?? Math.min(0.5, totalDuration(plan) / 4), volume: vo?.volume ?? 1 }).catch(() => null);
    const body = await res?.json().catch(() => ({}));
    setBusy(null);
    if (!res?.ok) { setMsg({ ok: false, text: body?.error ?? "The narration couldn't be made." }); return; }
    onAudio({ id: body.voiceover.assetId, url: body.url ?? null, file_name: "Narration", duration_seconds: body.voiceover.duration });
    update((p) => ({
      ...p, voiceover: body.voiceover,
      captions: { enabled: p.captions?.enabled ?? true, style: p.captions?.style ?? "highlight", position: p.captions?.position ?? "bottom", offset: 0, size: p.captions?.size ?? 1, cues: body.cues, source: "narration" },
      music: { ...p.music, duck: p.music.duck ?? 0.3 },
    }));
    setWarnings(body.factWarnings ?? []); setUnknown(body.unknownWords ?? []);
    const long = body.voiceover.start + body.voiceover.duration > totalDuration(plan);
    setMsg({ ok: true, text: `Narration ready: ${body.voiceover.duration.toFixed(1)} s, with ${body.cues.length} caption lines.${long ? " It's longer than the video — lengthen scenes or speed up the voice." : ""}` });
  }
  async function uploadOwn(file: File | undefined) {
    if (!file) return;
    setBusy("upload"); setMsg(null);
    try {
      const added = await uploadProjectMusic(orgId, projectId, file, { authorized, purpose: "narration" });
      onAudio(added);
      const res = await post("transcribe", { assetId: added.id });
      const body = await res.json().catch(() => ({}));
      const duration = added.duration_seconds ?? 10;
      update((p) => ({
        ...p, voiceover: { assetId: added.id, script: body.text ?? "Recorded narration", voice: "recorded", speed: 1, start: 0.5, volume: 1, duration },
        ...(res.ok ? { captions: { enabled: true, style: p.captions?.style ?? "subtitle", position: "bottom", offset: 0, size: 1, cues: body.cues, source: "transcription" } } : {}),
        music: { ...p.music, duck: p.music.duck ?? 0.3 },
      }));
      if (res.ok) setScript(body.text);
      setMsg({ ok: res.ok, text: res.ok ? "Your recording was added and transcribed into captions." : (body.error ?? "Added, but it couldn't be transcribed.") });
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "Upload failed." }); }
    setBusy(null);
  }

  return (
    <div className="flex flex-col gap-3">
      {!ready.tts ? <Alert variant="destructive"><AlertDescription>The voice engine isn&apos;t installed on this server. An administrator can run <code>npm run fetch-models -w @lvs/voice</code>.</AlertDescription></Alert> : null}
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Draft from the listing">
          <NativeSelect value={tone} onChange={(e) => setTone(e.target.value as typeof tone)}><option value="warm">Warm</option><option value="luxury">Luxury</option><option value="concise">Short</option></NativeSelect>
        </Field>
        <Button type="button" size="sm" variant="outline" disabled={!!busy} onClick={() => void draft()}>{busy === "draft" ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Wand2 aria-hidden="true" />}Write a draft</Button>
      </div>
      <Field label="Script" hint="Uses only the listing's verified details. Edit freely — new claims are checked against the listing.">
        <Textarea rows={6} maxLength={4000} value={script} onChange={(e) => setScript(e.target.value)} onBlur={() => script.trim() && void check(script)} />
      </Field>
      {warnings.length ? (
        <Alert variant="destructive"><AlertDescription><p className="font-semibold">Not on the listing — please check:</p><ul className="ml-4 list-disc text-sm">{warnings.map((w) => <li key={w.sentence}>“{w.sentence}” — {w.reason}</li>)}</ul></AlertDescription></Alert>
      ) : null}
      {unknown.length ? <p className="text-xs text-warning">The voice may skip these words: {unknown.join(", ")}. Try spelling them differently.</p> : null}
      <div className="grid grid-cols-2 gap-2">
        <Field label="Voice"><NativeSelect value={voice} onChange={(e) => setVoice(e.target.value)}>{voices.map((v) => <option key={v.id} value={v.id}>{v.name} — {v.accent} {v.gender}</option>)}</NativeSelect></Field>
        <Slider label="Voice speed" value={speed} min={0.7} max={1.3} step={0.05} suffix="×" onChange={setSpeed} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={!!busy || !ready.tts || !script.trim()} onClick={() => void preview()}>{busy === "preview" ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Play aria-hidden="true" />}Preview voice</Button>
        <Button type="button" disabled={!!busy || !ready.tts || !script.trim()} onClick={() => void make()}>{busy === "make" ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Mic aria-hidden="true" />}{vo ? "Re-record narration" : "Create narration"}</Button>
      </div>
      {msg ? <p role="status" className={msg.ok ? "text-sm" : "text-sm text-destructive"}>{msg.text}</p> : null}
      {vo ? (
        <div className="grid grid-cols-2 gap-2 rounded-lg border p-2">
          <Field label="Starts at (s)"><Input type="number" min={0} step={0.1} value={vo.start} onChange={(e) => update((p) => (p.voiceover ? { ...p, voiceover: { ...p.voiceover, start: Math.max(0, Number(e.target.value) || 0) } } : p), "vo-start")} /></Field>
          <Slider label="Narration volume" value={vo.volume} min={0} max={2} step={0.05} suffix="×" onChange={(v) => update((p) => (p.voiceover ? { ...p, voiceover: { ...p.voiceover, volume: v } } : p), "vo-vol")} />
          <p className="col-span-2 text-xs text-muted-foreground">Length {vo.duration.toFixed(1)} s · voice {voices.find((v) => v.id === vo.voice)?.name ?? vo.voice} · speed {vo.speed}×</p>
          <Button type="button" size="sm" variant="ghost" className="col-span-2 justify-self-start text-destructive" onClick={() => update((p) => ({ ...p, voiceover: undefined, captions: p.captions?.source === "narration" ? undefined : p.captions }))}><Trash2 aria-hidden="true" />Remove narration</Button>
        </div>
      ) : null}
      <div className="flex flex-col gap-2 border-t pt-3">
        <p className="text-xs font-semibold">Or use your own recording</p>
        <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={authorized} onChange={(e) => setAuthorized(e.target.checked)} className="mt-0.5" />I recorded this or am authorised to use it in this video.</label>
        <label className={`inline-flex min-h-10 cursor-pointer items-center gap-2 self-start rounded-lg border px-3 text-sm font-semibold ${!authorized || busy ? "pointer-events-none opacity-50" : "hover:bg-accent"}`}>
          {busy === "upload" ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Upload className="size-4" aria-hidden="true" />}Upload a recording (transcribed automatically)
          <input type="file" accept={MUSIC_MIME_TYPES.join(",")} className="sr-only" disabled={!authorized || !!busy} onChange={(e) => void uploadOwn(e.target.files?.[0])} />
        </label>
      </div>
    </div>
  );
}

/* ── Captions ───────────────────────────────────────────────────────── */
export function CaptionsPanel({ plan, update, projectId, focusCue, ready }: { plan: EditPlan; update: Update; projectId: string; focusCue?: string; ready: { asr: boolean } }) {
  const c: Captions = plan.captions ?? { enabled: false, style: "highlight", position: "bottom", offset: 0, size: 1, cues: [] };
  const set = (patch: Partial<Captions>, key?: string) => update((p) => ({ ...p, captions: { ...c, ...p.captions, ...patch } }), key);
  const setCue = (id: string, patch: Partial<Cue>, key?: string) => set({ cues: c.cues.map((x) => (x.id === id ? { ...x, ...patch } : x)) }, key);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function transcribe() {
    if (!plan.voiceover) return;
    setBusy(true); setMsg(null);
    const res = await fetch(`/api/projects/${projectId}/transcribe`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assetId: plan.voiceover.assetId, ...(plan.voiceover.voice !== "recorded" ? { script: plan.voiceover.script } : {}) }) }).catch(() => null);
    const body = await res?.json().catch(() => ({}));
    setBusy(false);
    if (!res?.ok) { setMsg(body?.error ?? "Transcription failed."); return; }
    set({ cues: body.cues, enabled: true, offset: 0, source: "transcription" });
    setMsg(`Transcribed: ${body.cues.length} caption lines.`);
  }
  return (
    <div className="flex flex-col gap-3">
      <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" className="size-4" checked={c.enabled} onChange={(e) => set({ enabled: e.target.checked })} />Show captions</label>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Style"><NativeSelect value={c.style} onChange={(e) => set({ style: e.target.value as Captions["style"] })}>{CAPTION_STYLES.map((s) => <option key={s} value={s}>{CAPTION_STYLE_LABELS[s]}</option>)}</NativeSelect></Field>
        <Field label="Position"><NativeSelect value={c.position} onChange={(e) => set({ position: e.target.value as Captions["position"] })}>{(["top", "center", "bottom"] as const).map((p) => <option key={p} value={p}>{p}</option>)}</NativeSelect></Field>
        <Slider label="Size" value={c.size} min={0.6} max={1.6} step={0.05} suffix="×" onChange={(v) => set({ size: v }, "cap-size")} />
        <Slider label="Timing (− earlier / + later)" value={c.offset} min={-2} max={2} step={0.05} suffix="s" onChange={(v) => set({ offset: v }, "cap-off")} />
      </div>
      <Button type="button" size="sm" variant="outline" className="self-start" disabled={busy || !plan.voiceover || !ready.asr} onClick={() => void transcribe()}>
        {busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Mic aria-hidden="true" />}Transcribe the narration automatically
      </Button>
      {msg ? <p role="status" className="text-sm">{msg}</p> : null}
      <ol className="flex max-h-80 flex-col gap-2 overflow-y-auto pr-1">
        {c.cues.map((q) => (
          <li key={q.id} className={`grid grid-cols-[1fr_auto_auto_auto] items-end gap-1 rounded-md border p-1.5 ${q.id === focusCue ? "border-primary bg-primary/5" : ""}`}>
            <Field label="Words"><Input className="h-8 text-sm" value={q.text} onChange={(e) => {
              const text = e.target.value;
              const keep = q.words && text.trim().split(/\s+/).length === q.words.length ? q.words : undefined;
              setCue(q.id, { text, words: keep }, `cue-${q.id}`);
            }} /></Field>
            <Field label="From"><Input className="h-8 w-16 px-1 text-xs" type="number" step={0.05} value={q.start} onChange={(e) => setCue(q.id, { start: Math.max(0, Number(e.target.value) || 0) }, `cs-${q.id}`)} /></Field>
            <Field label="To"><Input className="h-8 w-16 px-1 text-xs" type="number" step={0.05} value={q.end} onChange={(e) => setCue(q.id, { end: Math.max(q.start + 0.1, Number(e.target.value) || 0) }, `ce-${q.id}`)} /></Field>
            <Button type="button" size="icon" variant="ghost" className="h-8 w-8 text-destructive" aria-label="Delete caption line" onClick={() => set({ cues: c.cues.filter((x) => x.id !== q.id) })}><Trash2 aria-hidden="true" /></Button>
          </li>
        ))}
      </ol>
      <Button type="button" size="sm" variant="ghost" className="self-start" disabled={c.cues.length >= 300}
        onClick={() => { const last = c.cues.at(-1); const start = last ? r2(last.end + 0.1) : 0; set({ enabled: true, cues: [...c.cues, { id: `cue${Date.now().toString(36)}`, start, end: r2(start + 2), text: "New caption" }] }); }}>
        <Plus aria-hidden="true" />Add a caption line
      </Button>
    </div>
  );
}

/* ── Music ──────────────────────────────────────────────────────────── */
export function MusicPanel({ plan, update, music, orgId, projectId, onAudio }: {
  plan: EditPlan; update: Update; music: EditorMusic[]; orgId: string; projectId: string; onAudio: (a: EditorMusic) => void;
}) {
  const m = plan.music;
  const set = (patch: Partial<EditPlan["music"]>, key?: string) => update((p) => ({ ...p, music: { ...p.music, ...patch } }), key);
  const [authorized, setAuthorized] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const total = totalDuration(plan);
  const tracks = music.filter((x) => x.id !== plan.voiceover?.assetId && !x.file_name.startsWith("Narration"));
  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy(true); setMsg(null);
    try {
      const added = await uploadProjectMusic(orgId, projectId, file, { authorized, purpose: "music" });
      onAudio(added);
      set({ assetId: added.id });
      setMsg(`Added “${file.name}”.`);
    } catch (e) { setMsg(e instanceof Error ? e.message : "Upload failed."); }
    setBusy(false);
  }
  return (
    <div className="flex flex-col gap-3">
      <Field label="Background music">
        <NativeSelect value={m.assetId ?? ""} onChange={(e) => set({ assetId: e.target.value || null })}>
          <option value="">No music</option>
          {tracks.map((t) => <option key={t.id} value={t.id}>{t.file_name}</option>)}
        </NativeSelect>
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Slider label="Volume" value={m.volume} min={0} max={1} step={0.05} onChange={(v) => set({ volume: v }, "m-vol")} />
        <Slider label="Under the narration" value={m.duck ?? 1} min={0.05} max={1} step={0.05} onChange={(v) => set({ duck: v >= 1 ? undefined : v }, "m-duck")} />
        <Slider label="Fade in" value={m.fadeIn ?? 0} min={0} max={10} step={0.5} suffix="s" onChange={(v) => set({ fadeIn: v || undefined }, "m-fi")} />
        <Slider label="Fade out" value={m.fadeOutSeconds ?? (m.fadeOut ? 2 : 0)} min={0} max={10} step={0.5} suffix="s" onChange={(v) => set({ fadeOutSeconds: v, fadeOut: v > 0 }, "m-fo")} />
        <Slider label="Skip the first (trim)" value={m.in ?? 0} min={0} max={60} step={0.5} suffix="s" onChange={(v) => set({ in: v || undefined }, "m-in")} />
        <Slider label="Starts at" value={m.start ?? 0} min={0} max={Math.max(0, total - 1)} step={0.1} suffix="s" onChange={(v) => set({ start: v || undefined }, "m-start")} />
        <Slider label="Stops at" value={m.end ?? total} min={Math.min(total, (m.start ?? 0) + 1)} max={total} step={0.1} suffix="s" onChange={(v) => set({ end: v >= total ? undefined : v }, "m-end")} />
      </div>
      <div className="flex flex-col gap-2 border-t pt-3">
        <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={authorized} onChange={(e) => setAuthorized(e.target.checked)} className="mt-0.5" />My company is authorised to use this music in advertising.</label>
        <label className={`inline-flex min-h-10 cursor-pointer items-center gap-2 self-start rounded-lg border px-3 text-sm font-semibold ${!authorized || busy ? "pointer-events-none opacity-50" : "hover:bg-accent"}`}>
          {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Upload className="size-4" aria-hidden="true" />}Upload music (MP3, M4A, WAV)
          <input type="file" accept={MUSIC_MIME_TYPES.join(",")} className="sr-only" disabled={!authorized || busy} onChange={(e) => void upload(e.target.files?.[0])} />
        </label>
        {msg ? <p role="status" className="text-sm">{msg}</p> : null}
        <p className="text-xs text-muted-foreground">The library only offers tracks an administrator verified for commercial use.</p>
      </div>
    </div>
  );
}
