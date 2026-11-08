"use client";
/*
 * AI Camera Control: pick a movement or describe one in plain English (Claude turns it into
 * camera settings), keep the whole photo visible even in a tall video, preview, and apply it to
 * the scene. Every movement is a set of structured instructions; instructionsToSpec() turns them
 * into the camera settings the existing engine renders — the same code the server uses — so
 * changing Strength or framing re-applies instantly and the export matches the preview.
 */
import { useState } from "react";
import { Check, ChevronDown, Clapperboard, LoaderCircle, Play, RotateCcw, Sparkles, Wand2 } from "lucide-react";
import {
  BACKGROUND_LABELS, DEFAULT_BACKGROUND, EASINGS, EASING_LABELS, INTENSITIES, PHOTO_FIT_LABELS, getStudioMove, specFit,
  type CameraSpec, type Easing, type Intensity,
} from "@lvs/camera-presets";
import { Button } from "@/components/ui/button";
import {
  AI_EASY_LABELS, instructionsToSpec, type AiMovement, type CameraInstructions, type InterpretedMove,
} from "@/lib/camera/ai-camera";
import { ASPECTS, type Aspect } from "@/lib/video/plan";
import { ORIENTATION_LABELS } from "@/lib/video/easy";
import { cn } from "@/lib/utils";
import { MiniCameraPreview, type PreviewPhoto } from "./camera-preview";
import { GimbalPicker } from "./gimbal-picker";

const MAIN_MOVES = ["move_closer", "move_left", "move_right", "move_up", "move_down", "cinematic_reveal"] as const;
const MORE_MOVES = ["move_back", "luxury", "full_property_showcase"] as const;
const ADVANCED_MOVES: { label: string; moves: AiMovement[] }[] = [
  { label: "Push In / Pull Out", moves: ["push_in", "pull_out"] },
  { label: "Pan", moves: ["pan_left", "pan_right"] },
  { label: "Tilt", moves: ["tilt_up", "tilt_down"] },
  { label: "Dolly", moves: ["dolly_in", "dolly_out"] },
  { label: "Truck", moves: ["truck_left", "truck_right"] },
  { label: "Crane", moves: ["crane_up", "crane_down"] },
  { label: "Orbit", moves: ["orbit_left", "orbit_right"] },
  { label: "Arc", moves: ["arc_left", "arc_right"] },
  { label: "Parallax", moves: ["parallax"] },
];
const EASING_FROM: Record<Easing, CameraInstructions["easing"]> = { linear: "linear", "ease-in": "easeIn", "ease-out": "easeOut", "ease-in-out": "easeInOut" };
const FITS = ["contain", "cover", "smart"] as const;

export function AiCameraPanel(p: {
  spec: CameraSpec;
  setSpec: (fn: (s: CameraSpec) => CameraSpec, key?: string) => void;
  assetId: string;
  photo: PreviewPhoto;
  aspect: Aspect;
  setAspect: (a: Aspect) => void;
  /** Set when the shape belongs to the video (opened from a scene): the picker is shown locked with this note. */
  aspectNote?: string | null;
  duration: number;
  setDuration: (d: number) => void;
  canEdit: boolean;
  canUseAi: boolean;
  /** The AI methods switched on for the company, with the model in use. */
  ai: { depth: boolean; generative: { id: string; model: string } | null };
  busy: string | null;
  applyLabel: string;
  onApply: () => void;
  onPreview: () => void;
  onGenerate: (method: "depth" | "generative") => void;
  onOpenMode: (mode: "move" | "advanced") => void;
}) {
  const fit = specFit(p.spec);
  const [ins, setIns] = useState<CameraInstructions | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [source, setSource] = useState<"claude" | "basic" | "preset" | null>(null);
  const [prompt, setPrompt] = useState("");
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const [method, setMethod] = useState<"standard" | "depth" | "generative">("standard");
  const [showAdvancedMoves, setShowAdvancedMoves] = useState(false);
  const intensity: Intensity = ins?.intensity ?? "gentle";
  const preserve = fit === "contain";

  /** Applies instructions (from a preset, Claude or a setting change) through the shared mapping. */
  function apply(next: CameraInstructions, from: "claude" | "basic" | "preset", extraNotes: string[] = []) {
    const r = instructionsToSpec(next, { aspect: next.aspectRatio, duration: next.duration, preserveEntireImage: next.framing === "contain", photo: p.photo }, p.spec, from === "claude" ? "claude" : "basic");
    setIns(r.instructions);
    setNotes([...extraNotes, ...r.notes]);
    setSource(from);
    p.setSpec(() => ({ ...r.spec, background: r.spec.fit === "cover" ? p.spec.background ?? null : r.spec.background }), "ai-camera");
    if (r.aspect !== p.aspect) p.setAspect(r.aspect);
    if (r.duration !== p.duration) p.setDuration(r.duration);
  }
  const base = (movement: AiMovement): CameraInstructions => ({
    movement, framing: fit, preserveEntireImage: preserve, duration: p.duration, intensity, aspectRatio: p.aspect,
    background: (p.spec.background?.kind === "color" || p.spec.background?.kind === "gradient" ? p.spec.background.kind : "blur"),
    easing: EASING_FROM[p.spec.easing], feel: (p.spec.gimbal ?? 0) > 0 ? "gimbal" : "steady", focus: null, suggestedMethod: "standard", explanation: "", conflicts: [],
  });
  const pick = (movement: AiMovement) => apply({ ...base(movement), ...(ins && ins.movement === movement ? { focus: ins.focus } : {}) }, "preset");
  const change = (patch: Partial<CameraInstructions>) => apply({ ...(ins ?? base(currentMovement())), ...patch }, source === "claude" ? "claude" : source ?? "preset");
  /** Before any choice here, keep whatever move the photo has by treating it as "move closer". */
  const currentMovement = (): AiMovement => ins?.movement ?? "move_closer";

  async function ask() {
    setAsking(true); setAskError(null);
    try {
      const res = await fetch("/api/camera/interpret", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId: p.assetId, prompt, aspect: p.aspect, duration: p.duration, preserveEntireImage: preserve, current: p.spec }),
      });
      const data = (await res.json().catch(() => ({}))) as InterpretedMove & { error?: string };
      if (!res.ok) { setAskError(data.error ?? "That didn't work. Please try again."); return; }
      apply(data.instructions, data.source, [
        ...(data.instructions.explanation ? [data.instructions.explanation] : []),
        ...data.notes.filter((n) => !n.startsWith(data.instructions.explanation || "\u0000")),
      ].filter((n, i, a) => a.indexOf(n) === i));
      if (data.instructions.suggestedMethod !== "standard" && !preserve) setMethod(data.instructions.suggestedMethod === "ai_depth" ? "depth" : "generative");
    } catch {
      setAskError("We couldn't reach the server. Please try again.");
    } finally {
      setAsking(false);
    }
  }

  const thumb = { ...p.photo };
  const card = (m: AiMovement, name: string, description: string) => (
    <button key={m} type="button" role="radio" aria-checked={ins?.movement === m} onClick={() => pick(m)} title={description}
      className={cn("flex flex-col overflow-hidden rounded-xl border-2 text-left", ins?.movement === m ? "border-primary ring-2 ring-primary/20" : "border-border hover:border-primary/40")}>
      <div className="mx-auto w-full bg-black" style={{ maxWidth: p.aspect === "9:16" ? "52%" : p.aspect === "4:5" ? "75%" : p.aspect === "1:1" ? "84%" : "100%" }}>
        <MiniCameraPreview photo={thumb} spec={instructionsToSpec(base(m), { aspect: p.aspect, duration: 3, preserveEntireImage: preserve, photo: p.photo }, p.spec).spec} aspect={p.aspect} />
      </div>
      <span className="flex flex-col gap-0.5 p-2">
        <span className="text-sm font-semibold leading-tight">{name}</span>
        <span className="text-[11px] leading-snug text-muted-foreground">{description}</span>
      </span>
    </button>
  );

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold"><Sparkles className="size-5 text-brand" aria-hidden="true" />AI Camera Control</h2>
        <p className="text-sm text-muted-foreground">Pick a movement or describe one. The whole photo can stay in view, even in a tall video.</p>
      </div>

      {/* Framing */}
      <section className="flex flex-col gap-2" aria-labelledby="ai-fit">
        <h3 id="ai-fit" className="text-sm font-semibold">Framing</h3>
        <div role="radiogroup" aria-labelledby="ai-fit" className="grid grid-cols-3 gap-2">
          {FITS.map((f) => (
            <button key={f} type="button" role="radio" aria-checked={fit === f} title={PHOTO_FIT_LABELS[f].hint}
              onClick={() => (ins ? change({ framing: f, preserveEntireImage: f === "contain" }) : p.setSpec((s) => ({ ...s, fit: f, background: s.background ?? DEFAULT_BACKGROUND })))}
              className={cn("min-h-11 rounded-lg border-2 px-1 text-sm font-semibold", fit === f ? "border-primary bg-primary/5" : "border-border")}>
              {PHOTO_FIT_LABELS[f].label}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {preserve ? "Full Image Visibility is on: the whole photo stays visible for the entire clip; a blurred copy fills the space around it." : PHOTO_FIT_LABELS[fit].hint}
        </p>
      </section>

      {/* Movement */}
      <section className="flex flex-col gap-2" aria-labelledby="ai-move">
        <h3 id="ai-move" className="text-sm font-semibold">Movement</h3>
        <div role="radiogroup" aria-labelledby="ai-move" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {MAIN_MOVES.map((m) => card(m, AI_EASY_LABELS[m].name, AI_EASY_LABELS[m].description))}
          {MORE_MOVES.map((m) => card(m, AI_EASY_LABELS[m].name, AI_EASY_LABELS[m].description))}
        </div>
      </section>

      {/* Prompt */}
      <section className="flex flex-col gap-2">
        <label htmlFor="ai-prompt" className="text-sm font-semibold">Describe Your Camera Movement</label>
        <textarea id="ai-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value.slice(0, 1000))} rows={3} maxLength={1000}
          placeholder="Example: Slowly move closer to the house while keeping the entire property visible."
          className="rounded-md border bg-background p-3 text-base" />
        <Button type="button" variant="outline" disabled={asking || prompt.trim().length < 3} onClick={() => void ask()}>
          {asking ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Wand2 aria-hidden="true" />}
          {asking ? "Working out the movement…" : "Create movement"}
        </Button>
        {askError ? <p role="alert" className="text-sm text-destructive">{askError}</p> : null}
      </section>

      {ins ? (
        <div role="status" className="flex flex-col gap-1.5 rounded-lg bg-muted p-3 text-sm">
          <p className="flex flex-wrap items-center gap-2 font-semibold">
            {AI_EASY_LABELS[ins.movement as keyof typeof AI_EASY_LABELS]?.name ?? getStudioMove(ins.movement)?.name ?? ins.movement}
            <span className={cn("rounded-full px-2 py-0.5 text-[11px]", source === "claude" ? "bg-brand/10 text-brand" : "bg-background text-muted-foreground")}>
              {source === "claude" ? "Understood by Claude" : source === "basic" ? "Basic understanding" : "Preset"}
            </span>
            <span className="rounded-full bg-background px-2 py-0.5 text-[11px] text-muted-foreground">
              {getStudioMove(ins.movement)?.requiresAI ? "2D stand-in — real version needs AI" : "Standard 2D camera move"}
            </span>
          </p>
          {notes.map((n, i) => <p key={i} className="text-xs text-muted-foreground">{n}</p>)}
        </div>
      ) : null}

      {/* Strength */}
      <section className="flex flex-col gap-2" aria-labelledby="ai-strength">
        <h3 id="ai-strength" className="text-sm font-semibold">Movement strength</h3>
        <div role="radiogroup" aria-labelledby="ai-strength" className="grid grid-cols-3 gap-2">
          {INTENSITIES.map((i) => (
            <button key={i} type="button" role="radio" aria-checked={intensity === i} onClick={() => change({ intensity: i })}
              className={cn("min-h-11 rounded-lg border-2 text-sm font-semibold capitalize", intensity === i ? "border-primary bg-primary/5" : "border-border")}>
              {i}
            </button>
          ))}
        </div>
      </section>

      {/* Method */}
      <section className="flex flex-col gap-2" aria-labelledby="ai-method">
        <h3 id="ai-method" className="text-sm font-semibold">How to make it</h3>
        <div role="radiogroup" aria-labelledby="ai-method" className="flex flex-col gap-2">
          {([
            ["standard", "Standard camera movement", "Moves your original photo. Exact, never changes the picture, and keeps the whole photo when Show Entire Photo is on.", true],
            ["depth", "AI depth (3D perspective)", "A depth model on our server moves a virtual camera through the photo. Real parallax; fills the frame, so edges are cropped.", p.ai.depth && p.canUseAi],
            ["generative", `Generative AI${p.ai.generative ? ` — ${p.ai.generative.model}` : ""}`, "An image-to-video model makes a new clip. Most filmed-looking, but it can change details — every clip is reviewed against your photo.", !!p.ai.generative && p.canUseAi],
          ] as const).map(([id, label, hint, available]) => (
            <button key={id} type="button" role="radio" aria-checked={method === id} disabled={!available} onClick={() => setMethod(id)}
              className={cn("flex flex-col items-start gap-0.5 rounded-lg border-2 p-2.5 text-left disabled:cursor-not-allowed disabled:opacity-40", method === id ? "border-primary bg-primary/5" : "border-border")}>
              <span className="text-sm font-semibold">{label}{id !== "standard" ? <span className="ml-2 rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-semibold text-brand">AI</span> : null}</span>
              <span className="text-[11px] leading-snug text-muted-foreground">{available ? hint : id === "generative" ? "Not connected. Your Super Admin can connect a video AI service in the AI control panel." : "Not switched on for your account or company."}</span>
            </button>
          ))}
        </div>
        {method !== "standard" && preserve ? (
          <p className="rounded-md bg-warning/10 p-2 text-xs text-warning">AI clips fill the whole frame, so they can&apos;t keep the entire photo visible. For a strict full-photo clip, use Standard.</p>
        ) : null}
      </section>

      {/* Advanced */}
      <details className="rounded-lg border p-3">
        <summary className="cursor-pointer text-sm font-semibold">Advanced settings</summary>
        <div className="mt-4 flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <span id="ai-aspect" className="text-sm font-semibold">Video shape</span>
            <div role="radiogroup" aria-labelledby="ai-aspect" className="grid grid-cols-4 gap-1.5">
              {ASPECTS.map((a) => (
                <button key={a} type="button" role="radio" aria-checked={p.aspect === a} disabled={!!p.aspectNote} onClick={() => (ins ? change({ aspectRatio: a }) : p.setAspect(a))}
                  className={cn("min-h-10 rounded-lg border-2 text-xs font-semibold disabled:opacity-50", p.aspect === a ? "border-primary bg-primary/5" : "border-border")}>
                  {ORIENTATION_LABELS[a].label}<span className="block text-[10px] font-normal text-muted-foreground">{a}</span>
                </button>
              ))}
            </div>
            {p.aspectNote ? <p className="text-[11px] text-muted-foreground">{p.aspectNote}</p> : null}
          </div>
          {fit !== "cover" ? (
            <label className="flex flex-col gap-1 text-sm font-semibold">Background around the photo
              <select value={p.spec.background?.kind === "ai" ? "blur" : p.spec.background?.kind ?? "blur"} onChange={(e) => (ins ? change({ background: e.target.value as CameraInstructions["background"] }) : p.setSpec((s) => ({ ...s, background: { ...(s.background ?? DEFAULT_BACKGROUND), kind: e.target.value as "blur" } })))}
                className="h-10 rounded-md border bg-background px-2 font-normal">
                {(["blur", "color", "gradient"] as const).map((k) => <option key={k} value={k}>{BACKGROUND_LABELS[k]}</option>)}
              </select>
              <span className="text-[11px] font-normal text-muted-foreground">Colours, and AI extended (when a service is connected), are in Move camera.</span>
            </label>
          ) : null}
          <GimbalPicker spec={p.spec} setSpec={p.setSpec} id="ai-gimbal" />
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm font-semibold">Duration
              <select value={p.duration} onChange={(e) => (ins ? change({ duration: Number(e.target.value) }) : p.setDuration(Number(e.target.value)))} className="h-10 rounded-md border bg-background px-2 font-normal">
                {[...new Set([3, 4, 5, 6, 8, 10, p.duration])].sort((a, b) => a - b).map((d) => <option key={d} value={d}>{d} seconds</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold">Easing
              <select value={p.spec.easing} onChange={(e) => (ins ? change({ easing: EASING_FROM[e.target.value as Easing] }) : p.setSpec((s) => ({ ...s, easing: e.target.value as Easing })))} className="h-10 rounded-md border bg-background px-2 font-normal">
                {EASINGS.map((x) => <option key={x} value={x}>{EASING_LABELS[x]}</option>)}
              </select>
            </label>
          </div>
          <div className="flex flex-col gap-2">
            <button type="button" onClick={() => setShowAdvancedMoves((v) => !v)} className="flex items-center gap-1 self-start text-sm font-semibold" aria-expanded={showAdvancedMoves}>
              <ChevronDown className={cn("size-4 transition-transform", showAdvancedMoves && "rotate-180")} aria-hidden="true" />Advanced movements
            </button>
            {showAdvancedMoves ? (
              <div className="flex flex-col gap-1.5">
                {ADVANCED_MOVES.map((g) => (
                  <div key={g.label} className="flex flex-wrap items-center gap-1.5">
                    <span className="w-28 text-xs font-semibold">{g.label}</span>
                    {g.moves.map((m) => {
                      const sm = getStudioMove(m);
                      return (
                        <button key={m} type="button" onClick={() => pick(m)} title={sm?.description}
                          className={cn("min-h-8 rounded-md border px-2 text-xs", ins?.movement === m ? "border-primary bg-primary/5 font-semibold" : "border-border")}>
                          {sm?.name}{sm?.requiresAI ? " · needs AI" : sm?.standard === "stand-in" ? " · 2D" : ""}
                        </button>
                      );
                    })}
                  </div>
                ))}
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="w-28 text-xs font-semibold">Custom path</span>
                  <button type="button" onClick={() => p.onOpenMode("move")} className="min-h-8 rounded-md border px-2 text-xs">Start and end frames (Move camera)</button>
                  <button type="button" onClick={() => p.onOpenMode("advanced")} className="min-h-8 rounded-md border px-2 text-xs">Keyframes (Advanced camera)</button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </details>

      {/* Actions */}
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" size="lg" variant="outline" onClick={p.onPreview}><Play aria-hidden="true" />Preview</Button>
        <Button type="button" size="lg" variant="outline" onClick={() => { setIns(null); setNotes([]); setSource(null); setPrompt(""); setMethod("standard");
          p.setSpec((s) => ({ ...s, manual: null, manualStart: null, startFrame: null, endFrame: null, keyframes: null, move: "push_in", strength: 0.3 }), "ai-reset"); }}>
          <RotateCcw aria-hidden="true" />Reset
        </Button>
      </div>
      {method === "standard" ? (
        <Button size="xl" className="w-full bg-brand text-white hover:bg-brand/90" disabled={!!p.busy || !p.canEdit} onClick={p.onApply}>
          {p.busy === "apply" ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Check aria-hidden="true" />}
          {p.applyLabel}
        </Button>
      ) : (
        <div className="flex flex-col gap-1.5">
          <Button size="xl" className="w-full bg-brand text-white hover:bg-brand/90" disabled={!!p.busy || !p.canEdit} onClick={() => p.onGenerate(method)}>
            {p.busy === method ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Clapperboard aria-hidden="true" />}
            Generate AI Camera Clip
          </Button>
          <p className="text-xs text-muted-foreground">The clip appears under &quot;Your clips&quot; with a side-by-side check against your photo. Review it, then use it in the scene.</p>
        </div>
      )}
    </div>
  );
}
