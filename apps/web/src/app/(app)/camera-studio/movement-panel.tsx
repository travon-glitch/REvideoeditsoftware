"use client";
/*
 * "Move camera". First: how the photo fits the video (Show Entire Photo, Fill Screen, Smart Fit)
 * and what fills the space around it. Then a preset or a hand-placed start and end frame: the
 * white frame IS the video frame (9:16, 16:9 or 1:1) and the photo is drawn inside it exactly as
 * the export draws it, so dragging the photo moves it in the video. Every number comes from the
 * same cameraKeyframes() call the server renders with.
 */
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Crosshair, Expand, LoaderCircle, Play, RotateCcw, Sparkles } from "lucide-react";
import {
  BACKGROUND_KINDS, BACKGROUND_LABELS, DEFAULT_BACKGROUND, DEFAULT_SAFE_AREA, EASINGS, EASING_LABELS, MANUAL_AXES, MANUAL_LABELS, MOVE_PRESETS,
  PHOTO_FITS, PHOTO_FIT_LABELS, ZERO_MANUAL, applyMovePreset, cameraKeyframes, hasManual, manualFrames, photoScale, specFit, transformAt,
  withManualFrame, type BackgroundKind, type CameraSpec, type Easing, type ManualAxis, type ManualMove, type PhotoFit,
} from "@lvs/camera-presets";
import { Button } from "@/components/ui/button";
import { PhotoLayer } from "@/components/video/photo-layer";
import { GimbalPicker } from "./gimbal-picker";
import { CANVAS_1080, type Aspect } from "@/lib/video/plan";
import { analyzeSafeArea } from "@/lib/video/smart-fit";
import { cn } from "@/lib/utils";

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const round1 = (v: number) => Math.round(v * 10) / 10;
const pct = (n: number) => `${n * 100}%`;
const BOX_HEIGHT: Record<Aspect, number> = { "9:16": 330, "4:5": 300, "1:1": 270, "16:9": 0 };
const DURATIONS = [3, 4, 5, 6, 8, 10];

export function MovementPanel({
  spec, setSpec, photoUrl, photoSize, aspect, duration, setDuration, busy, canApply, applyLabel, onApply, onPreview, aiExtendAvailable,
}: {
  spec: CameraSpec;
  setSpec: (fn: (s: CameraSpec) => CameraSpec, key?: string) => void;
  photoUrl: string | null;
  photoSize: { width: number; height: number } | null;
  aspect: Aspect;
  duration: number;
  setDuration: (d: number) => void;
  busy: boolean;
  canApply: boolean;
  applyLabel: string;
  onApply: () => void;
  onPreview: () => void;
  /** A generative image service that can extend photos is connected. */
  aiExtendAvailable: boolean;
}) {
  const fit = specFit(spec);
  const background = spec.background ?? DEFAULT_BACKGROUND;
  const m: ManualMove = spec.manual ?? ZERO_MANUAL;
  const [which, setWhich] = useState<"start" | "end">("end");
  const [analyzing, setAnalyzing] = useState(false);
  const [smartNote, setSmartNote] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  // exactly what renders: the same keyframes as the preview and the MP4
  const canvas = CANVAS_1080[aspect];
  const render = cameraKeyframes(spec, 1, canvas, photoSize);
  const tr = transformAt(render.keyframes, which === "start" ? 0 : 1);
  const frames = manualFrames(spec);
  const active = frames[which];
  // a little shrink is normal (room to move); a lot means the asked-for move doesn't fit
  const shrunk = render.fitScale < 0.999;
  const limited = render.fitScale < 0.7;
  const manual = hasManual(spec);

  const setFit = (f: PhotoFit) => setSpec((s) => ({ ...s, fit: f, background: s.background ?? DEFAULT_BACKGROUND }));
  const setBackground = (patch: Partial<typeof background>) => setSpec((s) => ({ ...s, background: { ...(s.background ?? DEFAULT_BACKGROUND), ...patch } }), "background");
  const place = (v: { x: number; y: number; zoom: number }, key: string) => setSpec((s) => withManualFrame(s, which, v), key);

  // Smart Fit: find the home in the photo once per photo (saved on the spec, so the export frames it the same way)
  const lastAnalyzed = useRef<string | null>(null);
  useEffect(() => {
    if (fit !== "smart" || !photoUrl || spec.safeArea || lastAnalyzed.current === photoUrl) return;
    lastAnalyzed.current = photoUrl;
    setAnalyzing(true); setSmartNote(null);
    void analyzeSafeArea(photoUrl).then((area) => {
      setAnalyzing(false);
      setSmartNote(area ? null : "This photo couldn't be analysed here, so Smart Fit keeps the middle 84% of it in view.");
      setSpec((s) => ({ ...s, safeArea: area ?? DEFAULT_SAFE_AREA }), "smart-area");
    });
  }, [fit, photoUrl, spec.safeArea, setSpec]);

  /* Drag the photo inside the frame: it follows the pointer (the fit limit may hold it back). */
  function startDrag(e: React.PointerEvent) {
    const el = box.current;
    if (!el) return;
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    const b = el.getBoundingClientRect();
    const from = { x: e.clientX, y: e.clientY, v: { ...active } };
    const perPx = { x: canvas.width / b.width, y: canvas.height / b.height };
    const s0 = Math.max(0.05, tr.scale / render.framing.zoom);
    const onMove = (ev: PointerEvent) => {
      const dX = (ev.clientX - from.x) * perPx.x, dY = (ev.clientY - from.y) * perPx.y;
      place({ x: from.v.x - dX / (s0 * canvas.width), y: from.v.y - dY / (s0 * canvas.height), zoom: from.v.zoom }, "frame-drag");
    };
    const onUp = () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  const updateAxis = (patch: Partial<ManualMove>, key: string) =>
    setSpec((s) => {
      const next = { ...(s.manual ?? ZERO_MANUAL), ...patch };
      for (const a of MANUAL_AXES) next[a] = round1(clamp(next[a], -10, 10));
      return { ...s, manual: next, startFrame: null, endFrame: null, keyframes: null };
    }, key);

  // the safe area (Smart Fit) on screen, ignoring roll
  const region = render.framing.region;
  const safeBox = fit === "smart" && region ? {
    left: 0.5 + (tr.x + (region.cx - region.w / 2) * tr.scale) / canvas.width, top: 0.5 + (tr.y + (region.cy - region.h / 2) * tr.scale) / canvas.height,
    width: (region.w * tr.scale) / canvas.width, height: (region.h * tr.scale) / canvas.height,
  } : null;
  const shown = Math.round(render.framing.visible.w * render.framing.visible.h * 100);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-semibold">Move camera</h2>
        <p className="text-sm text-muted-foreground">Choose how the photo fits, pick a movement, then fine-tune the start and end frames.</p>
      </div>

      {/* 1. Fit */}
      <section className="flex flex-col gap-2" aria-labelledby="fit-heading">
        <h3 id="fit-heading" className="text-base font-semibold">How should your photo fit?</h3>
        <div role="radiogroup" aria-labelledby="fit-heading" className="grid grid-cols-3 gap-2">
          {PHOTO_FITS.map((f) => (
            <button key={f} type="button" role="radio" aria-checked={fit === f} onClick={() => setFit(f)}
              className={cn("flex min-h-16 flex-col items-start gap-0.5 rounded-lg border-2 p-2.5 text-left", fit === f ? "border-primary bg-primary/5" : "border-border hover:border-primary/40")}>
              <span className="flex items-center gap-1 text-sm font-semibold">{f === "smart" ? <Sparkles className="size-3.5 text-brand" aria-hidden="true" /> : null}{PHOTO_FIT_LABELS[f].label}</span>
              <span className="text-[11px] leading-snug text-muted-foreground">{PHOTO_FIT_LABELS[f].hint}</span>
            </button>
          ))}
        </div>
        {fit === "cover" ? (
          <p className="flex items-start gap-1.5 rounded-md bg-warning/10 p-2 text-xs text-warning">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            Fill Screen crops this photo: only about {shown}% of it fits a {aspect} video. The dimmed parts below are cut off.
          </p>
        ) : null}
        {fit === "smart" && (analyzing || smartNote) ? (
          <p className="text-xs text-muted-foreground">{analyzing ? "Finding the home in this photo…" : smartNote}</p>
        ) : null}
      </section>

      {/* 2. Background */}
      {fit !== "cover" ? (
        <section className="flex flex-col gap-2" aria-labelledby="bg-heading">
          <h3 id="bg-heading" className="text-sm font-semibold">Background around the photo</h3>
          <div role="radiogroup" aria-labelledby="bg-heading" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {BACKGROUND_KINDS.map((k: BackgroundKind) => {
              const off = k === "ai" && !aiExtendAvailable;
              return (
                <button key={k} type="button" role="radio" aria-checked={background.kind === k} disabled={off} onClick={() => setBackground({ kind: k })}
                  title={off ? "Needs a generative image service that can extend photos. None is connected." : undefined}
                  className={cn("min-h-10 rounded-lg border-2 px-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40", background.kind === k ? "border-primary bg-primary/5" : "border-border")}>
                  {BACKGROUND_LABELS[k]}
                </button>
              );
            })}
          </div>
          {!aiExtendAvailable ? <p className="text-[11px] text-muted-foreground">AI extended needs a generative image service that can extend photos; none is connected.</p> : null}
          {background.kind === "color" || background.kind === "gradient" ? (
            <div className="flex items-center gap-3 text-sm">
              <label className="flex items-center gap-2">{background.kind === "gradient" ? "Top" : "Color"}
                <input type="color" value={background.color} onChange={(e) => setBackground({ color: e.target.value })} className="h-8 w-10 cursor-pointer rounded border" />
              </label>
              {background.kind === "gradient" ? (
                <label className="flex items-center gap-2">Bottom
                  <input type="color" value={background.color2} onChange={(e) => setBackground({ color2: e.target.value })} className="h-8 w-10 cursor-pointer rounded border" />
                </label>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {/* 3. Presets */}
      <section className="flex flex-col gap-2" aria-labelledby="preset-heading">
        <h3 id="preset-heading" className="text-sm font-semibold">Movement</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {MOVE_PRESETS.map((p) => (
            <button key={p.id} type="button" onClick={() => setSpec((s) => applyMovePreset(s, p.id))} title={p.description}
              className="min-h-10 rounded-lg border-2 border-border px-2 text-left text-sm font-semibold hover:border-primary/50">
              {p.name}
            </button>
          ))}
        </div>
      </section>

      <GimbalPicker spec={spec} setSpec={setSpec} id="move-gimbal" />

      {/* 4. Frame editor */}
      <section className="flex flex-col gap-3" aria-labelledby="frame-heading">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="frame-heading" className="text-sm font-semibold">Frames</h3>
          <div role="radiogroup" aria-label="Frame to edit" className="flex rounded-lg border p-0.5">
            {(["start", "end"] as const).map((w) => (
              <button key={w} type="button" role="radio" aria-checked={which === w} onClick={() => setWhich(w)}
                className={cn("min-h-9 rounded-md px-3 text-sm font-semibold", which === w ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>
                {w === "start" ? "Start Frame" : "End Frame"}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-hidden rounded-xl bg-[radial-gradient(circle,_hsl(var(--border))_1px,_transparent_1px)] bg-[length:16px_16px] px-4 py-5">
          <div ref={box} className="relative mx-auto touch-none select-none"
            style={{ aspectRatio: `${canvas.width} / ${canvas.height}`, ...(BOX_HEIGHT[aspect] ? { height: BOX_HEIGHT[aspect] } : { width: "100%" }) }}>
            {/* the parts of the photo outside the video, dimmed (only Fill Screen cuts any off) */}
            {fit === "cover" ? <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-25"><PhotoLayer url={photoUrl} tr={tr} canvas={canvas} fit={render.props.fit} background={null} drawn={render.framing} ghost /></div> : null}
            <div role="slider" tabIndex={0} aria-label={`${which === "start" ? "Start" : "End"} frame — drag the photo to move it, arrow keys nudge, + and − zoom`}
              aria-valuetext={`x ${active.x.toFixed(2)}, y ${active.y.toFixed(2)}, zoom ${active.zoom.toFixed(2)}`}
              aria-valuemin={-0.5} aria-valuemax={0.5} aria-valuenow={round1(active.x)}
              onPointerDown={startDrag}
              onKeyDown={(e) => {
                const st = e.shiftKey ? 0.05 : 0.01;
                const v = { x: active.x, y: active.y, zoom: active.zoom };
                const map: Record<string, Partial<typeof v>> = {
                  ArrowLeft: { x: v.x + st }, ArrowRight: { x: v.x - st }, ArrowUp: { y: v.y + st }, ArrowDown: { y: v.y - st },
                  "+": { zoom: v.zoom * 1.03 }, "=": { zoom: v.zoom * 1.03 }, "-": { zoom: v.zoom / 1.03 },
                };
                if (map[e.key]) { e.preventDefault(); place({ ...v, ...map[e.key] }, "frame-key"); }
              }}
              className={cn("absolute inset-0 cursor-move overflow-hidden bg-black outline-none ring-offset-2 focus-visible:ring-2 focus-visible:ring-primary",
                limited ? "shadow-[0_0_0_3px_hsl(var(--warning))]" : "shadow-[0_0_0_3px_white]")}>
              <PhotoLayer url={photoUrl} tr={tr} canvas={canvas} fit={render.props.fit} background={render.background} drawn={render.framing} />
              {safeBox ? (
                <div aria-hidden="true" className="pointer-events-none absolute border-2 border-dashed border-white/80"
                  style={{ left: pct(safeBox.left), top: pct(safeBox.top), width: pct(safeBox.width), height: pct(safeBox.height) }}>
                  <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] font-semibold text-white">Kept in view</span>
                </div>
              ) : null}
              <span className="pointer-events-none absolute left-2 top-2 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-semibold text-white">
                {which === "start" ? "Start" : "End"} · {photoScale(render.framing, tr, canvas).toFixed(2)}×
              </span>
            </div>
          </div>
          <p className="mt-3 text-center text-xs text-muted-foreground">Move your photo while keeping the home visible.</p>
        </div>

        {shrunk && !limited ? (
          <p role="status" className="text-xs text-muted-foreground">
            The photo is shown at {render.fitScale.toFixed(2)}× so it has room to move without being cut off.
          </p>
        ) : null}
        {limited ? (
          <p role="status" className="flex items-start gap-1.5 rounded-md bg-warning/10 p-2 text-xs text-warning">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            At the limit: the movement is {Math.round((1 - render.fitScale) * 100)}% smaller than asked so the {fit === "smart" ? "home" : "whole photo"} stays in view. Use a smaller movement, or Fill Screen to go edge to edge.
          </p>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between">
            <label htmlFor="frame-zoom" className="text-sm font-medium text-muted-foreground">{which === "start" ? "Start" : "End"} frame zoom</label>
            <span className="text-sm tabular-nums">{active.zoom.toFixed(2)}×</span>
          </div>
          <input id="frame-zoom" type="range" min={0.5} max={2.5} step={0.01} value={active.zoom}
            onChange={(e) => place({ x: active.x, y: active.y, zoom: Number(e.target.value) }, "frame-zoom")}
            className="h-2 cursor-pointer accent-[hsl(var(--primary))]" />
          {fit !== "cover" && active.zoom > 1.001 && frames.start.zoom > 1.001 && frames.end.zoom > 1.001 ? (
            <p className="text-[11px] text-muted-foreground">Show Entire Photo never crops, so both frames above 1.00× only changes how much the camera zooms between them.</p>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="outline" onClick={() => place({ x: active.x, y: active.y, zoom: 1 }, "frame-fit")}><Expand aria-hidden="true" />Fit to Photo</Button>
          <Button type="button" variant="outline" onClick={() => place({ x: 0, y: 0, zoom: active.zoom }, "frame-centre")}><Crosshair aria-hidden="true" />Center Photo</Button>
          <Button type="button" variant="outline" disabled={!manual} onClick={() => setSpec((s) => ({ ...s, manual: null, manualStart: null, startFrame: null, endFrame: null, keyframes: null }))}>
            <RotateCcw aria-hidden="true" />Reset Camera
          </Button>
          <Button type="button" variant="outline" onClick={onPreview}><Play aria-hidden="true" />Preview Movement</Button>
        </div>
      </section>

      {/* 5. Advanced (collapsed) */}
      <details className="rounded-lg border p-3">
        <summary className="cursor-pointer text-sm font-semibold">Advanced settings</summary>
        <div className="mt-4 flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-x-5 gap-y-4">
            {MANUAL_AXES.map((a: ManualAxis) => (
              <div key={a} className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between">
                  <label htmlFor={`manual-${a}`} className="text-sm font-medium text-muted-foreground" title={MANUAL_LABELS[a].hint}>{MANUAL_LABELS[a].label}</label>
                  <span className={cn("text-sm tabular-nums", m[a] !== 0 ? "font-semibold text-foreground" : "text-muted-foreground")}>{m[a].toFixed(1)}</span>
                </div>
                <CentredSlider id={`manual-${a}`} value={m[a]} hint={MANUAL_LABELS[a].hint} onChange={(v) => updateAxis({ [a]: v }, `manual-${a}`)} />
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">The sliders say how far the camera travels from the start frame. Pan and tilt are shown as a slide on a flat photo; the AI depth version turns the camera for real.</p>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm font-medium">Movement duration
              <select value={duration} onChange={(e) => setDuration(Number(e.target.value))} className="h-10 rounded-md border bg-background px-2">
                {[...new Set([...DURATIONS, duration])].sort((a, b) => a - b).map((d) => <option key={d} value={d}>{d} seconds</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">Easing
              <select value={spec.easing} onChange={(e) => setSpec((s) => ({ ...s, easing: e.target.value as Easing }))} className="h-10 rounded-md border bg-background px-2">
                {EASINGS.map((x) => <option key={x} value={x}>{EASING_LABELS[x]}</option>)}
              </select>
            </label>
          </div>
          <p className="text-xs text-muted-foreground">
            Framing constraint: {fit === "cover" ? "fill the frame — the move zooms in just enough that no edge shows." : fit === "smart" ? "keep the home (dashed box) fully in view — the move shrinks if it would cut it." : "keep the whole photo in view — the move shrinks if it would cut it."}
          </p>
        </div>
      </details>

      <Button size="xl" className="w-full bg-brand text-white hover:bg-brand/90" disabled={busy || !canApply} onClick={onApply}>
        {busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Check aria-hidden="true" />}
        {applyLabel}
      </Button>
    </div>
  );
}

/** −10…10 slider whose fill grows from the centre. */
function CentredSlider({ id, value, hint, onChange }: { id: string; value: number; hint: string; onChange: (v: number) => void }) {
  const pos = (value + 10) / 20;
  const lo = Math.min(pos, 0.5), hi = Math.max(pos, 0.5);
  return (
    <div className="relative h-9 rounded-md border bg-muted/40">
      <div className="pointer-events-none absolute inset-y-1 rounded bg-primary/20" style={{ left: pct(lo), width: pct(hi - lo) }} />
      <div className="pointer-events-none absolute inset-y-1 left-1/2 w-px bg-border" />
      <div className="pointer-events-none absolute inset-y-1.5 w-1 -translate-x-1/2 rounded-full bg-primary" style={{ left: pct(pos) }} />
      <input id={id} type="range" min={-10} max={10} step={0.1} value={value} aria-describedby={`${id}-hint`}
        onChange={(e) => onChange(Number(e.target.value))} onDoubleClick={() => onChange(0)}
        className="absolute inset-0 size-full cursor-pointer opacity-0" />
      <span id={`${id}-hint`} className="sr-only">{hint}. Double-click to reset.</span>
    </div>
  );
}
