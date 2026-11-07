"use client";
import { useState } from "react";
import { Crosshair, Plus, Sparkles, Trash2 } from "lucide-react";
import {
  AI_METHOD_LABELS, CINEMATIC_PRESETS, EASINGS, EASING_LABELS, LENS_DISCLAIMER, LENS_FEEL, LENS_STYLES, STUDIO_MOVES,
  PHOTO_FITS, PHOTO_FIT_LABELS, defaultSpec, presetSpec, specFit, type CameraKey, type CameraSpec, type CameraView, type Easing, type StandardQuality, type StudioMove,
} from "@lvs/camera-presets";
import { Button } from "@/components/ui/button";
import { GimbalPicker } from "./gimbal-picker";
import { cn } from "@/lib/utils";

/** A new move keeps the chosen framing. */
const keepFraming = (from: CameraSpec, to: CameraSpec): CameraSpec => ({ ...to, fit: from.fit, background: from.background ?? null, safeArea: from.safeArea ?? null, gimbal: from.gimbal ?? 0 });

type SetSpec = (fn: (s: CameraSpec) => CameraSpec, mergeKey?: string) => void;

export function QualityBadge({ move }: { move: StudioMove }) {
  const tone: Record<StandardQuality, string> = {
    exact: "bg-success/15 text-success",
    close: "bg-primary/10 text-primary",
    "stand-in": "bg-warning/15 text-warning",
  };
  return (
    <span className="flex flex-wrap gap-1">
      {move.requiresAI ? (
        <span className="flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-semibold text-brand"><Sparkles className="size-3" aria-hidden="true" />Needs AI</span>
      ) : null}
      <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", tone[move.standard])}>
        {move.standard === "exact" ? "Standard: exact" : move.standard === "close" ? "Standard: close" : "Standard: 2D stand-in"}
      </span>
    </span>
  );
}

function Slider({ label, value, min, max, step, onChange, format, hint, disabled }: {
  label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void;
  format?: (v: number) => string; hint?: string; disabled?: boolean;
}) {
  const id = `sl-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div className={cn("flex flex-col gap-1", disabled && "opacity-50")}>
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-sm font-semibold">{label}</label>
        <span className="text-sm tabular-nums text-muted-foreground">{format ? format(value) : value}</span>
      </div>
      <input id={id} type="range" min={min} max={max} step={step} value={value} disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))} className="h-2 cursor-pointer accent-[hsl(var(--primary))]" />
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const TABS = [["move", "Movement"], ["look", "Presets & lens"], ["settings", "Settings"], ["frames", "Frames & keyframes"]] as const;

export function AdvancedPanel({
  spec, setSpec, duration, setDuration, currentView, photoUrl,
}: {
  spec: CameraSpec; setSpec: SetSpec; duration: number; setDuration: (d: number) => void;
  /** What the preview shows right now (for "add a keyframe here"). */
  currentView: () => CameraView & { t: number };
  photoUrl: string | null;
}) {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("move");
  const move = STUDIO_MOVES.find((m) => m.id === spec.move)!;
  const set = <K extends keyof CameraSpec>(k: K, v: CameraSpec[K], merge = true) => setSpec((s) => ({ ...s, [k]: v }), merge ? `adv-${String(k)}` : undefined);
  const groups = [...new Set(STUDIO_MOVES.map((m) => m.group))];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="adv-fit" className="text-sm font-semibold">Framing</label>
        <select id="adv-fit" value={specFit(spec)} onChange={(e) => setSpec((s) => ({ ...s, fit: e.target.value as CameraSpec["fit"] }))}
          className="h-10 rounded-md border bg-background px-2 text-sm">
          {PHOTO_FITS.map((f) => <option key={f} value={f}>{PHOTO_FIT_LABELS[f].label}</option>)}
        </select>
        <p className="text-xs text-muted-foreground">{PHOTO_FIT_LABELS[specFit(spec)].hint} Backgrounds and Smart Fit&apos;s area are set in Move camera.</p>
      </div>
      <GimbalPicker spec={spec} setSpec={setSpec} id="adv-gimbal" />
      <div role="tablist" aria-label="Advanced camera" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {TABS.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={cn("min-h-11 rounded-lg px-2 text-sm font-semibold", tab === k ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground")}>
            {label}
          </button>
        ))}
      </div>

      {tab === "move" ? (
        <div className="flex flex-col gap-4">
          {groups.map((g) => (
            <div key={g} className="flex flex-col gap-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g}</h4>
              <div role="radiogroup" aria-label={g} className="grid gap-2 sm:grid-cols-2">
                {STUDIO_MOVES.filter((m) => m.group === g).map((m) => (
                  <button key={m.id} type="button" role="radio" aria-checked={spec.move === m.id}
                    onClick={() => setSpec((s) => ({ ...s, move: m.id, startFrame: null, endFrame: null, keyframes: null, manual: null }))}
                    className={cn("flex flex-col items-start gap-1 rounded-lg border-2 p-2.5 text-left", spec.move === m.id ? "border-primary bg-primary/5" : "border-border hover:border-primary/40")}>
                    <span className="text-sm font-semibold">{m.name}</span>
                    <QualityBadge move={m} />
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="rounded-lg bg-muted p-3 text-sm">
            <p className="font-semibold">{move.name}</p>
            <p className="text-muted-foreground">{move.description}</p>
            {move.ai.length ? <p className="mt-1 text-muted-foreground">True version: {move.ai.map((a) => AI_METHOD_LABELS[a]).join(" or ")}.</p> : null}
          </div>
        </div>
      ) : null}

      {tab === "look" ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <h4 className="text-sm font-semibold">Cinematic presets</h4>
            <div className="grid gap-2 sm:grid-cols-2">
              {CINEMATIC_PRESETS.map((p) => (
                <button key={p.id} type="button" onClick={() => setSpec((s) => keepFraming(s, presetSpec(p.id)!))}
                  className="flex flex-col items-start gap-0.5 rounded-lg border-2 border-border p-2.5 text-left hover:border-primary/50">
                  <span className="text-sm font-semibold">{p.name}</span>
                  <span className="text-xs text-muted-foreground">{p.description}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <h4 className="text-sm font-semibold">Lens-inspired style</h4>
            <div role="radiogroup" aria-label="Lens-inspired style" className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              <button type="button" role="radio" aria-checked={spec.lens === null} onClick={() => set("lens", null, false)}
                className={cn("min-h-11 rounded-lg border-2 text-sm font-semibold", spec.lens === null ? "border-primary bg-primary/5" : "border-border")}>None</button>
              {LENS_STYLES.map((l) => (
                <button key={l} type="button" role="radio" aria-checked={spec.lens === l} onClick={() => set("lens", l, false)} title={LENS_FEEL[l].label}
                  className={cn("min-h-11 rounded-lg border-2 text-sm font-semibold", spec.lens === l ? "border-primary bg-primary/5" : "border-border")}>{l}mm</button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{spec.lens ? `${LENS_FEEL[spec.lens].label}. ` : ""}{LENS_DISCLAIMER}</p>
          </div>
        </div>
      ) : null}

      {tab === "settings" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Slider label="Duration" value={duration} min={2} max={10} step={0.5} onChange={setDuration} format={(v) => `${v} s`} />
          <Slider label="Motion strength" value={spec.strength} min={0} max={1} step={0.05} onChange={(v) => set("strength", v)} format={pct} />
          <Slider label="Speed" value={spec.speed} min={0.5} max={2} step={0.05} onChange={(v) => set("speed", v)} format={(v) => `${v.toFixed(2)}×`}
            hint="Below 1× covers less ground; above 1× arrives sooner and holds." />
          <Slider label="Movement distance" value={spec.distance} min={0.02} max={0.4} step={0.01} onChange={(v) => set("distance", v)} format={pct} hint="Share of the frame the camera travels." />
          <Slider label="Direction" value={spec.direction} min={-180} max={180} step={5} onChange={(v) => set("direction", v)} format={(v) => `${v}°`}
            disabled={!move.lateral} hint={move.lateral ? "Turns the travel direction (0° = as named)." : "For sideways and turning moves."} />
          <Slider label="Zoom" value={spec.zoom} min={1} max={2} step={0.05} onChange={(v) => set("zoom", v)} format={(v) => `${v.toFixed(2)}×`} hint="Starting magnification." />
          <Slider label="Rotation" value={spec.rotation} min={-15} max={15} step={0.5} onChange={(v) => set("rotation", v)} format={(v) => `${v}°`} hint="Roll over the move." />
          <Slider label="Depth intensity" value={spec.depth} min={0} max={1} step={0.05} onChange={(v) => set("depth", v)} format={pct} hint="Used by AI depth: how much near things move against far things." />
          <Slider label="Motion blur" value={spec.motionBlur} min={0} max={360} step={15} onChange={(v) => set("motionBlur", v)} format={(v) => (v ? `${v}° shutter` : "Off")} hint="Film look is 180°. Shows in the exported MP4." />
          <div className="flex flex-col gap-1">
            <label htmlFor="easing" className="text-sm font-semibold">Easing</label>
            <select id="easing" value={spec.easing} onChange={(e) => set("easing", e.target.value as Easing, false)} className="h-10 rounded-md border bg-background px-2 text-sm">
              {EASINGS.map((e) => <option key={e} value={e}>{EASING_LABELS[e]}</option>)}
            </select>
          </div>
          <label className="flex min-h-10 items-center gap-2 text-sm font-semibold">
            <input type="checkbox" className="size-5" checked={spec.reverse} onChange={(e) => set("reverse", e.target.checked, false)} />Play the move in reverse
          </label>
          {move.targeted ? (
            <div className="flex flex-col gap-2 sm:col-span-2">
              <span className="flex items-center gap-2 text-sm font-semibold"><Crosshair className="size-4" aria-hidden="true" />Target point — click the photo</span>
              <TargetPicker url={photoUrl} target={spec.target} onPick={(t) => set("target", t, false)} />
            </div>
          ) : null}
          <Button type="button" variant="outline" className="self-start" onClick={() => setSpec((s) => keepFraming(s, defaultSpec(s.move)))}>Reset settings</Button>
        </div>
      ) : null}

      {tab === "frames" ? (
        <FramesEditor spec={spec} setSpec={setSpec} duration={duration} currentView={currentView} />
      ) : null}
    </div>
  );
}

function TargetPicker({ url, target, onPick }: { url: string | null; target: { x: number; y: number }; onPick: (t: { x: number; y: number }) => void }) {
  return (
    <button type="button" aria-label="Choose the target point on the photo"
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const clampT = (v: number) => Math.max(-0.45, Math.min(0.45, v));
        onPick({ x: clampT((e.clientX - r.left) / r.width - 0.5), y: clampT((e.clientY - r.top) / r.height - 0.5) });
      }}
      className="relative aspect-video w-full max-w-sm overflow-hidden rounded-lg border bg-muted">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {url ? <img src={url} alt="" className="size-full object-cover" /> : null}
      <span className="absolute size-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-brand/70 shadow"
        style={{ left: `${(target.x + 0.5) * 100}%`, top: `${(target.y + 0.5) * 100}%` }} />
    </button>
  );
}

function ViewFields({ label, view, onChange }: { label: string; view: CameraView; onChange: (v: CameraView) => void }) {
  const field = (k: keyof CameraView, min: number, max: number, step: number) => (
    <label className="flex flex-col gap-0.5 text-xs font-semibold text-muted-foreground">{k === "x" ? "Left/right" : k === "y" ? "Up/down" : k === "zoom" ? "Zoom" : "Rotation"}
      <input type="number" min={min} max={max} step={step} value={view[k]} aria-label={`${label} ${k}`}
        onChange={(e) => onChange({ ...view, [k]: Number(e.target.value) })} className="h-9 rounded-md border bg-background px-2 text-sm text-foreground" />
    </label>
  );
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <span className="text-sm font-semibold">{label}</span>
      <div className="grid grid-cols-4 gap-2">{field("x", -0.5, 0.5, 0.01)}{field("y", -0.5, 0.5, 0.01)}{field("zoom", 1, 4, 0.05)}{field("rotation", -30, 30, 0.5)}</div>
    </div>
  );
}

function FramesEditor({ spec, setSpec, duration, currentView }: { spec: CameraSpec; setSpec: SetSpec; duration: number; currentView: () => CameraView & { t: number } }) {
  const usingFrames = !!(spec.startFrame && spec.endFrame);
  const here = () => { const v = currentView(); return { x: round(v.x), y: round(v.y), zoom: round(v.zoom), rotation: round(v.rotation) }; };
  const keys = spec.keyframes ?? [];
  const setKeys = (k: CameraKey[] | null) => setSpec((s) => ({ ...s, keyframes: k && k.length >= 2 ? [...k].sort((a, b) => a.t - b.t) : k && k.length ? k : null }));
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h4 className="text-sm font-semibold">Starting and ending frame</h4>
        <p className="text-xs text-muted-foreground">Set exactly what the camera shows at the start and the end. Positions are shares of the photo from its centre.</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => setSpec((s) => ({ ...s, startFrame: here(), endFrame: s.endFrame ?? here(), keyframes: null }))}>Use preview as start frame</Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setSpec((s) => ({ ...s, endFrame: here(), startFrame: s.startFrame ?? here(), keyframes: null }))}>Use preview as end frame</Button>
          {usingFrames ? <Button type="button" size="sm" variant="ghost" onClick={() => setSpec((s) => ({ ...s, startFrame: null, endFrame: null }))}>Clear frames</Button> : null}
        </div>
        {usingFrames ? (
          <div className="grid gap-2">
            <ViewFields label="Start frame" view={spec.startFrame!} onChange={(v) => setSpec((s) => ({ ...s, startFrame: v }), "start-frame")} />
            <ViewFields label="End frame" view={spec.endFrame!} onChange={(v) => setSpec((s) => ({ ...s, endFrame: v }), "end-frame")} />
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-2 border-t pt-4">
        <h4 className="text-sm font-semibold">Custom keyframes</h4>
        <p className="text-xs text-muted-foreground">Pause the preview where you like the view, then add a keyframe. Two or more keyframes replace the move&apos;s path.</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" disabled={keys.length >= 24} onClick={() => {
            const v = currentView();
            setKeys([...keys.filter((k) => Math.abs(k.t - v.t / duration) > 0.01), { ...here(), t: round(v.t / duration) }]);
          }}><Plus aria-hidden="true" />Add keyframe at the preview time</Button>
          {keys.length ? <Button type="button" size="sm" variant="ghost" onClick={() => setKeys(null)}>Clear keyframes</Button> : null}
        </div>
        {keys.length === 1 ? <p className="text-xs text-warning">Add one more keyframe to use them.</p> : null}
        {keys.length ? (
          <ol className="flex flex-col gap-2">
            {keys.map((k, i) => (
              <li key={i} className="flex flex-wrap items-end gap-2 rounded-lg border p-2">
                <label className="flex flex-col gap-0.5 text-xs font-semibold text-muted-foreground">Time (s)
                  <input type="number" min={0} max={duration} step={0.1} value={round(k.t * duration)} className="h-9 w-20 rounded-md border bg-background px-2 text-sm text-foreground"
                    onChange={(e) => setKeys(keys.map((x, j) => (j === i ? { ...x, t: Math.max(0, Math.min(1, Number(e.target.value) / duration)) } : x)))} />
                </label>
                {(["x", "y", "zoom", "rotation"] as const).map((f) => (
                  <label key={f} className="flex flex-col gap-0.5 text-xs font-semibold text-muted-foreground">{f}
                    <input type="number" step={f === "zoom" ? 0.05 : f === "rotation" ? 0.5 : 0.01} value={k[f]} className="h-9 w-20 rounded-md border bg-background px-2 text-sm text-foreground"
                      onChange={(e) => setKeys(keys.map((x, j) => (j === i ? { ...x, [f]: Number(e.target.value) } : x)))} />
                  </label>
                ))}
                <label className="flex flex-col gap-0.5 text-xs font-semibold text-muted-foreground">Easing in
                  <select value={k.ease ?? spec.easing} className="h-9 rounded-md border bg-background px-1 text-sm text-foreground"
                    onChange={(e) => setKeys(keys.map((x, j) => (j === i ? { ...x, ease: e.target.value as Easing } : x)))}>
                    {EASINGS.map((e) => <option key={e} value={e}>{EASING_LABELS[e]}</option>)}
                  </select>
                </label>
                <Button type="button" size="icon" variant="ghost" className="text-destructive" aria-label={`Remove keyframe ${i + 1}`} onClick={() => setKeys(keys.filter((_, j) => j !== i))}><Trash2 aria-hidden="true" /></Button>
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    </div>
  );
}

const round = (n: number) => Math.round(n * 1000) / 1000;
