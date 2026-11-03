"use client";
/*
 * "Move camera": drag the end frame on the photo (move it, or pull a handle to zoom) or use the six
 * sliders. The faint frames show the path from the start frame to the end frame. Values are the
 * engine's ManualMove (−10…10 per axis); the live preview on the left plays the result.
 */
import { useRef } from "react";
import { Camera, Check, LoaderCircle, RotateCcw } from "lucide-react";
import {
  MANUAL_AXES, MANUAL_LABELS, MANUAL_SCALE, ZERO_MANUAL, cameraKeyframes, isManualZero, transformAt,
  type CameraSpec, type CameraView, type ManualAxis, type ManualMove,
} from "@lvs/camera-presets";
import { Button } from "@/components/ui/button";
import { CANVAS_1080, type Aspect } from "@/lib/video/plan";
import { cn } from "@/lib/utils";

const RATIO: Record<Aspect, number> = { "16:9": 16 / 9, "9:16": 9 / 16, "1:1": 1, "4:5": 4 / 5 };
const TRAIL = 6;
const BOX_MAX_HEIGHT = 340;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const round1 = (v: number) => Math.round(v * 10) / 10;

/**
 * The box shows the whole photo. The video frame at zoom 1 covers the photo's middle (cw × ch of it);
 * a view (fractions of that frame) becomes a rectangle in box fractions.
 */
function rect(v: CameraView, cw: number, ch: number) {
  const w = cw / v.zoom, h = ch / v.zoom;
  return { left: 0.5 + v.x * cw - w / 2, top: 0.5 + v.y * ch - h / 2, width: w, height: h, rotation: -v.rotation };
}
const pct = (n: number) => `${n * 100}%`;

export function MovementPanel({ spec, setSpec, photoUrl, photoSize, aspect, busy, canApply, applyLabel, onApply }: {
  spec: CameraSpec;
  setSpec: (fn: (s: CameraSpec) => CameraSpec, key?: string) => void;
  photoUrl: string | null;
  photoSize: { width: number; height: number } | null;
  aspect: Aspect;
  busy: boolean;
  canApply: boolean;
  applyLabel: string;
  onApply: () => void;
}) {
  const m: ManualMove = spec.manual ?? ZERO_MANUAL;
  const box = useRef<HTMLDivElement>(null);
  // the path exactly as it renders (same keyframes as the preview and the MP4, edge guard included)
  const canvas = CANVAS_1080[aspect];
  const photoRatio = photoSize?.width && photoSize.height ? photoSize.width / photoSize.height : RATIO[aspect];
  const cw = Math.min(1, RATIO[aspect] / photoRatio), ch = Math.min(1, photoRatio / RATIO[aspect]);
  const render = cameraKeyframes(spec, 1, canvas, photoSize);
  const viewAt = (t: number): CameraView => {
    const tr = transformAt(render.keyframes, t);
    return { x: -tr.x / (tr.scale * canvas.width), y: -tr.y / (tr.scale * canvas.height), zoom: tr.scale, rotation: tr.rotation };
  };
  const end = viewAt(1);

  const update = (patch: Partial<ManualMove>, key: string) =>
    setSpec((s) => {
      const next = { ...(s.manual ?? ZERO_MANUAL), ...patch };
      for (const a of MANUAL_AXES) next[a] = round1(clamp(next[a], -10, 10));
      return { ...s, manual: next, startFrame: null, endFrame: null, keyframes: null };
    }, key);

  /* Drag the end frame (move) or one of its handles (zoom). */
  function startDrag(e: React.PointerEvent, kind: "move" | "zoom") {
    const el = box.current;
    if (!el) return;
    e.preventDefault(); e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const b = el.getBoundingClientRect();
    const from = { x: e.clientX, y: e.clientY, m: { ...m } };
    const centre = { x: b.left + (0.5 + end.x * cw) * b.width, y: b.top + (0.5 + end.y * ch) * b.height };
    const d0 = Math.max(0.01, Math.hypot((e.clientX - centre.x) / b.width, (e.clientY - centre.y) / b.height));
    const endZoom0 = 1 + Math.max(0, m.zoom) * MANUAL_SCALE.zoom;
    const onMove = (ev: PointerEvent) => {
      if (kind === "move") {
        // box fractions → video-frame fractions (the edge guard's zoom shrinks the travel a little; good enough to steer)
        const dx = (ev.clientX - from.x) / b.width / cw, dy = (ev.clientY - from.y) / b.height / ch;
        update({ horizontal: from.m.horizontal + dx / MANUAL_SCALE.slide, vertical: from.m.vertical - dy / MANUAL_SCALE.slide }, "manual-drag");
      } else {
        const d = Math.hypot((ev.clientX - centre.x) / b.width, (ev.clientY - centre.y) / b.height);
        // smaller frame = closer; a frame pulled past the full photo means "pull back"
        const zoomFactor = (endZoom0 * d0) / Math.max(0.01, d);
        const z = zoomFactor >= 1 ? (zoomFactor - 1) / MANUAL_SCALE.zoom : -((1 / zoomFactor) - 1) / MANUAL_SCALE.zoom;
        update({ zoom: z }, "manual-drag");
      }
    };
    const onUp = () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  const endRect = rect(end, cw, ch);
  const trail = Array.from({ length: TRAIL }, (_, i) => rect(viewAt(i / TRAIL), cw, ch));
  const frameStyle = (r: ReturnType<typeof rect>) => ({
    left: pct(r.left), top: pct(r.top), width: pct(r.width), height: pct(r.height), transform: `rotate(${r.rotation}deg)`,
  });
  const turned = m.pan !== 0 || m.tilt !== 0;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-semibold">Move camera</h2>
        <p className="text-sm text-muted-foreground">Drag the white frame to where the clip should end, pull a handle to zoom, or use the sliders.</p>
      </div>

      <div className="rounded-xl bg-[radial-gradient(circle,_hsl(var(--border))_1px,_transparent_1px)] bg-[length:16px_16px] p-4">
        <div ref={box} className="relative mx-auto w-full touch-none select-none rounded-md bg-neutral-900"
          style={{ aspectRatio: String(photoRatio), maxWidth: Math.round(BOX_MAX_HEIGHT * photoRatio) }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {photoUrl ? <img src={photoUrl} alt="" draggable={false} className="absolute inset-0 size-full rounded-md object-cover" /> : null}
          <div className="pointer-events-none absolute inset-0 rounded-md bg-black/30" />
          {trail.map((r, i) => (
            <div key={i} aria-hidden="true" className="pointer-events-none absolute border border-white/45" style={frameStyle(r)} />
          ))}
          <div role="slider" tabIndex={0} aria-label="End frame — drag to move, arrow keys nudge"
            aria-valuetext={`Horizontal ${m.horizontal}, vertical ${m.vertical}, zoom ${m.zoom}`}
            aria-valuemin={-10} aria-valuemax={10} aria-valuenow={m.horizontal}
            onPointerDown={(e) => startDrag(e, "move")}
            onKeyDown={(e) => {
              const step = e.shiftKey ? 1 : 0.2;
              const map: Record<string, Partial<ManualMove>> = {
                ArrowLeft: { horizontal: m.horizontal - step }, ArrowRight: { horizontal: m.horizontal + step },
                ArrowUp: { vertical: m.vertical + step }, ArrowDown: { vertical: m.vertical - step },
                "+": { zoom: m.zoom + step }, "=": { zoom: m.zoom + step }, "-": { zoom: m.zoom - step },
              };
              if (map[e.key]) { e.preventDefault(); update(map[e.key]!, "manual-key"); }
            }}
            className="absolute cursor-move border-2 border-white bg-white/10 shadow-[0_0_12px_rgba(0,0,0,0.5)] outline-none focus-visible:ring-2 focus-visible:ring-primary"
            style={frameStyle(endRect)}>
            <span className="absolute left-1/2 top-1/2 flex size-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-md bg-black/70 text-white">
              <Camera className="size-4" aria-hidden="true" />
            </span>
            {(["top", "bottom", "left", "right"] as const).map((side) => (
              <span key={side} aria-hidden="true" onPointerDown={(e) => startDrag(e, "zoom")}
                className={cn("absolute rounded-full bg-white shadow",
                  side === "top" && "left-1/2 top-0 h-2.5 w-7 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize",
                  side === "bottom" && "bottom-0 left-1/2 h-2.5 w-7 -translate-x-1/2 translate-y-1/2 cursor-ns-resize",
                  side === "left" && "left-0 top-1/2 h-7 w-2.5 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize",
                  side === "right" && "right-0 top-1/2 h-7 w-2.5 -translate-y-1/2 translate-x-1/2 cursor-ew-resize")} />
            ))}
          </div>
        </div>
        <p className="mt-2 text-center text-xs text-muted-foreground">Faint frames: the camera&apos;s path from the start to the end frame, exactly as it will render.</p>
      </div>

      <div className="grid grid-cols-2 gap-x-5 gap-y-4">
        {MANUAL_AXES.map((a: ManualAxis) => (
          <div key={a} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between">
              <label htmlFor={`manual-${a}`} className="text-sm font-medium text-muted-foreground" title={MANUAL_LABELS[a].hint}>{MANUAL_LABELS[a].label}</label>
              <span className={cn("text-sm tabular-nums", m[a] !== 0 ? "font-semibold text-foreground" : "text-muted-foreground")}>{m[a].toFixed(1)}</span>
            </div>
            <CentredSlider id={`manual-${a}`} value={m[a]} hint={MANUAL_LABELS[a].hint} onChange={(v) => update({ [a]: v }, `manual-${a}`)} />
          </div>
        ))}
      </div>

      {turned ? (
        <p className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">
          Pan and tilt turn the camera. On a flat photo the Standard clip shows them as a slide; the AI depth version turns the camera for real.
        </p>
      ) : null}

      <div className="grid grid-cols-[1fr_auto] gap-2">
        <Button size="xl" className=" bg-brand text-white hover:bg-brand/90" disabled={busy || !canApply || isManualZero(m)} onClick={onApply}>
          {busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Check aria-hidden="true" />}
          {applyLabel}
        </Button>
        <Button size="xl" variant="outline" disabled={isManualZero(m)} onClick={() => setSpec((s) => ({ ...s, manual: null }))}>
          <RotateCcw aria-hidden="true" />Reset
        </Button>
      </div>
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
