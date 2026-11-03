"use client";
/*
 * Multitrack timeline (Advanced editor): video scenes, overlays, text, captions, narration and music.
 * Drag a clip to move it, drag its right edge to trim it (music: both edges), click the ruler to
 * move the playhead. Keyframes of the selected text or overlay show as diamonds.
 */
import { useRef, useState } from "react";
import { Diamond, Minus, Plus } from "lucide-react";
import { moveItem } from "@/lib/listings";
import { MAX_SCENE_SECONDS, MIN_SCENE_SECONDS, resolveScene, sceneStarts, sceneTransition, totalDuration, type EditPlan } from "@/lib/video/plan";
import { narrationStart } from "@/lib/video/editor-layers";
import { moveText, textStart } from "@/lib/video/timeline";
import { cn } from "@/lib/utils";

export type Selection =
  | { kind: "scene"; id: string } | { kind: "text"; id: string } | { kind: "overlay"; id: string }
  | { kind: "voice" } | { kind: "captions"; cue?: string } | { kind: "music" } | null;

const LABEL = 92;
const r2 = (n: number) => Math.round(n * 100) / 100;

export function Timeline({ plan, time, onSeek, sel, onSelect, update, thumbs }: {
  plan: EditPlan; time: number; onSeek: (t: number) => void; sel: Selection; onSelect: (s: Selection) => void;
  update: (fn: (p: EditPlan) => EditPlan, mergeKey?: string) => void; thumbs: Record<string, string | null>;
}) {
  const [pps, setPps] = useState(48); // pixels per second
  const total = totalDuration(plan);
  const width = Math.max(600, Math.ceil(total * pps) + 120);
  const starts = sceneStarts(plan);
  const scroller = useRef<HTMLDivElement>(null);
  const [dragScene, setDragScene] = useState<{ id: string; x: number } | null>(null);

  /** Pointer drag in seconds; `move(dt)` runs live, `end(dt)` once. */
  const drag = (e: React.PointerEvent, move: (dt: number) => void, end?: (dt: number) => void) => {
    e.preventDefault(); e.stopPropagation();
    const x0 = e.clientX;
    const onMove = (ev: PointerEvent) => move((ev.clientX - x0) / pps);
    const onUp = (ev: PointerEvent) => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); end?.((ev.clientX - x0) / pps); };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  const seekAt = (clientX: number) => {
    const box = scroller.current!.getBoundingClientRect();
    onSeek(Math.min(total, Math.max(0, (clientX - box.left + scroller.current!.scrollLeft - LABEL) / pps)));
  };

  const isSel = (k: string, id?: string) => !!sel && sel.kind === k && (id == null || ("id" in sel && sel.id === id));
  const keyTimes = (() => {
    if (sel?.kind === "text") { const t = plan.texts.find((x) => x.id === sel.id); return t?.keys?.map((k) => textStart(plan, t) + k.t) ?? []; }
    if (sel?.kind === "overlay") { const o = (plan.overlays ?? []).find((x) => x.id === sel.id); return o?.keys?.map((k) => o.start + k.t) ?? []; }
    return [];
  })();

  const row = (label: string, h: number, children: React.ReactNode, hint?: string) => (
    <div className="relative flex border-b" style={{ height: h }}>
      <div className="sticky left-0 z-20 flex shrink-0 items-center border-r bg-card px-2 text-xs font-semibold text-muted-foreground" style={{ width: LABEL }} title={hint}>{label}</div>
      <div className="relative flex-1">{children}</div>
    </div>
  );
  const block = (opts: { key: string; left: number; w: number; selected: boolean; label: string; color: string; onDown?: (e: React.PointerEvent) => void; onTrim?: (e: React.PointerEvent) => void; onTrimStart?: (e: React.PointerEvent) => void; onClick: () => void; aria: string; children?: React.ReactNode }) => (
    <div key={opts.key} role="button" tabIndex={0} aria-label={opts.aria} aria-pressed={opts.selected}
      onPointerDown={opts.onDown} onClick={(e) => { e.stopPropagation(); opts.onClick(); }} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); opts.onClick(); } }}
      className={cn("absolute inset-y-1 cursor-grab touch-none overflow-hidden rounded-md border text-[11px] font-medium text-white shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring", opts.color, opts.selected && "ring-2 ring-yellow-300")}
      style={{ left: opts.left, width: Math.max(8, opts.w) }}>
      {opts.children}
      <span className="pointer-events-none relative z-10 block truncate px-1.5 leading-5 [text-shadow:0_1px_2px_rgba(0,0,0,.6)]">{opts.label}</span>
      {opts.onTrimStart ? <span onPointerDown={opts.onTrimStart} className="absolute inset-y-0 left-0 z-20 w-2 cursor-ew-resize bg-white/30 hover:bg-white/60" aria-hidden="true" /> : null}
      {opts.onTrim ? <span onPointerDown={opts.onTrim} className="absolute inset-y-0 right-0 z-20 w-2 cursor-ew-resize bg-white/30 hover:bg-white/60" aria-hidden="true" /> : null}
    </div>
  );

  const vo = plan.voiceover;
  const cap = plan.captions;
  const capBase = narrationStart(plan);
  const mStart = plan.music.start ?? 0, mEnd = Math.min(total, plan.music.end ?? total);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>Drag clips to move them, drag an edge to trim. Click the ruler to move the playhead.</span>
        <div className="flex items-center gap-1">
          <button type="button" className="rounded border p-1" aria-label="Zoom out" onClick={() => setPps((p) => Math.max(12, p / 1.4))}><Minus className="size-3.5" /></button>
          <button type="button" className="rounded border p-1" aria-label="Zoom in" onClick={() => setPps((p) => Math.min(200, p * 1.4))}><Plus className="size-3.5" /></button>
        </div>
      </div>
      <div ref={scroller} className="relative overflow-x-auto rounded-lg border bg-muted/30" role="group" aria-label="Timeline">
        <div style={{ width: width + LABEL }} className="relative select-none">
          {/* ruler */}
          <div className="relative flex h-7 border-b bg-card" onPointerDown={(e) => { seekAt(e.clientX); drag(e, () => undefined); const m = (ev: PointerEvent) => seekAt(ev.clientX); const u = () => { window.removeEventListener("pointermove", m); window.removeEventListener("pointerup", u); }; window.addEventListener("pointermove", m); window.addEventListener("pointerup", u); }}>
            <div className="sticky left-0 z-20 shrink-0 border-r bg-card" style={{ width: LABEL }} />
            <div className="relative flex-1 cursor-pointer">
              {Array.from({ length: Math.ceil(width / pps) + 1 }, (_, s) => (
                <span key={s} className="absolute top-0 h-full border-l border-border/70 text-[10px] text-muted-foreground" style={{ left: s * pps }}>
                  {s % (pps < 30 ? 5 : 1) === 0 ? <span className="ml-1">{s}s</span> : null}
                </span>
              ))}
            </div>
          </div>

          {row("Video", 60, plan.scenes.map((s, i) => {
            const left = starts.get(s.id)! * pps, w = s.duration * pps;
            const tr = sceneTransition(plan, i);
            return [
              block({
                key: s.id, left: dragScene?.id === s.id ? left + dragScene.x : left, w, selected: isSel("scene", s.id), label: `${i + 1}${s.clipAssetId ? " · AI clip" : ""}`,
                color: s.clipAssetId ? "bg-violet-700 border-violet-900" : "bg-slate-700 border-slate-900", aria: `Scene ${i + 1}, ${s.duration} seconds`,
                onClick: () => onSelect({ kind: "scene", id: s.id }),
                onDown: (e) => drag(e, (dt) => setDragScene({ id: s.id, x: dt * pps }), (dt) => {
                  setDragScene(null);
                  if (Math.abs(dt * pps) < 6) return;
                  const centre = starts.get(s.id)! + s.duration / 2 + dt;
                  let to = plan.scenes.findIndex((x) => centre < starts.get(x.id)! + x.duration);
                  if (to < 0) to = plan.scenes.length - 1;
                  if (to !== i) update((p) => ({ ...p, scenes: moveItem(p.scenes, i, to) }));
                }),
                onTrim: (e) => { const d0 = s.duration; drag(e, (dt) => update((p) => ({ ...p, scenes: p.scenes.map((x) => (x.id === s.id ? { ...x, duration: Math.min(MAX_SCENE_SECONDS, Math.max(MIN_SCENE_SECONDS, r2(d0 + dt))) } : x)) }), `trim-${s.id}`)); },
                children: thumbs[s.assetId] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={thumbs[s.assetId]!} alt="" className="pointer-events-none absolute inset-0 size-full object-cover opacity-70" />
                ) : null,
              }),
              tr.seconds > 0 ? (
                <button key={`tr-${s.id}`} type="button" title={`Transition: ${tr.type} (${tr.seconds}s)`} aria-label={`Transition into scene ${i + 1}: ${tr.type}`}
                  onClick={(e) => { e.stopPropagation(); onSelect({ kind: "scene", id: s.id }); }}
                  className="absolute -top-1 z-30 size-3.5 -translate-x-1/2 rotate-45 rounded-sm border border-white bg-amber-500" style={{ left }} />
              ) : null,
            ];
          }))}

          {row("Overlays", 34, (plan.overlays ?? []).map((o) => block({
            key: o.id, left: o.start * pps, w: o.duration * pps, selected: isSel("overlay", o.id), label: o.text || o.preset, color: "bg-amber-600 border-amber-800",
            aria: `Overlay ${o.preset} at ${o.start} seconds`, onClick: () => onSelect({ kind: "overlay", id: o.id }),
            onDown: (e) => { const s0 = o.start; drag(e, (dt) => update((p) => ({ ...p, overlays: (p.overlays ?? []).map((x) => (x.id === o.id ? { ...x, start: Math.max(0, r2(s0 + dt)) } : x)) }), `move-${o.id}`)); },
            onTrim: (e) => { const d0 = o.duration; drag(e, (dt) => update((p) => ({ ...p, overlays: (p.overlays ?? []).map((x) => (x.id === o.id ? { ...x, duration: Math.max(0.3, r2(d0 + dt)) } : x)) }), `trim-${o.id}`)); },
          })), "Animated overlays")}

          {row("Text", 34, plan.texts.map((t) => {
            const st = textStart(plan, t);
            const scene = resolveScene(plan, t.sceneId);
            const d = t.duration ?? (scene ? scene.duration - (t.offset ?? 0) : 2);
            return block({
              key: t.id, left: st * pps, w: d * pps, selected: isSel("text", t.id), label: t.text.split("\n")[0]!, color: "bg-sky-700 border-sky-900",
              aria: `Text “${t.text.slice(0, 30)}” at ${st.toFixed(1)} seconds`, onClick: () => onSelect({ kind: "text", id: t.id }),
              onDown: (e) => drag(e, (dt) => update((p) => moveText(p, t.id, st + dt), `move-${t.id}`)),
              onTrim: (e) => drag(e, (dt) => update((p) => ({ ...p, texts: p.texts.map((x) => (x.id === t.id ? { ...x, duration: Math.min(30, Math.max(1, r2(d + dt))) } : x)) }), `trim-${t.id}`)),
            });
          }))}

          {row("Captions", 30, cap?.enabled ? cap.cues.map((c) => block({
            key: c.id, left: (capBase + c.start) * pps, w: (c.end - c.start) * pps, selected: isSel("captions") && (sel as { cue?: string }).cue === c.id, label: c.text,
            color: "bg-emerald-700 border-emerald-900", aria: `Caption “${c.text}”`, onClick: () => onSelect({ kind: "captions", cue: c.id }),
          })) : null, "Subtitles (timing follows the narration; adjust in the inspector)")}

          {row("Voice", 34, vo ? block({
            key: "voice", left: vo.start * pps, w: vo.duration * pps, selected: isSel("voice"), label: `Narration · ${vo.voice}`, color: "bg-rose-700 border-rose-900",
            aria: `Narration at ${vo.start} seconds`, onClick: () => onSelect({ kind: "voice" }),
            onDown: (e) => { const s0 = vo.start; drag(e, (dt) => update((p) => (p.voiceover ? { ...p, voiceover: { ...p.voiceover, start: Math.max(0, r2(s0 + dt)) } } : p), "move-voice")); },
            children: (vo.sentences ?? []).map((s, i) => <span key={i} className="pointer-events-none absolute inset-y-2 bg-white/25" style={{ left: s.start * pps, width: (s.end - s.start) * pps }} />),
          }) : null)}

          {row("Music", 34, plan.music.assetId ? block({
            key: "music", left: mStart * pps, w: (mEnd - mStart) * pps, selected: isSel("music"), label: `Music · ${Math.round(plan.music.volume * 100)}%`, color: "bg-indigo-700 border-indigo-900",
            aria: "Background music", onClick: () => onSelect({ kind: "music" }),
            onDown: (e) => { const s0 = mStart, e0 = plan.music.end; drag(e, (dt) => update((p) => ({ ...p, music: { ...p.music, start: Math.max(0, r2(s0 + dt)), ...(e0 != null ? { end: r2(e0 + dt) } : {}) } }), "move-music")); },
            onTrimStart: (e) => { const s0 = mStart, in0 = plan.music.in ?? 0; drag(e, (dt) => { const d = Math.max(-in0, Math.min(dt, mEnd - s0 - 1)); update((p) => ({ ...p, music: { ...p.music, start: r2(s0 + d), in: r2(in0 + d) } }), "trim-music-start"); }); },
            onTrim: (e) => { drag(e, (dt) => update((p) => ({ ...p, music: { ...p.music, end: Math.min(total, Math.max(mStart + 1, r2(mEnd + dt))) } }), "trim-music-end")); },
            children: (
              <>
                {plan.music.fadeIn ? <span className="pointer-events-none absolute inset-y-0 left-0 bg-gradient-to-r from-black/50 to-transparent" style={{ width: plan.music.fadeIn * pps }} /> : null}
                {(plan.music.fadeOutSeconds ?? (plan.music.fadeOut ? 2 : 0)) ? <span className="pointer-events-none absolute inset-y-0 right-0 bg-gradient-to-l from-black/50 to-transparent" style={{ width: (plan.music.fadeOutSeconds ?? 2) * pps }} /> : null}
              </>
            ),
          }) : null)}

          {/* keyframes of the selected item */}
          {keyTimes.map((t, i) => (
            <Diamond key={i} className="pointer-events-none absolute z-30 size-3 -translate-x-1/2 fill-yellow-300 text-yellow-600" style={{ left: LABEL + t * pps, top: 30 }} aria-hidden="true" />
          ))}
          {/* playhead */}
          <div className="pointer-events-none absolute inset-y-0 z-40 w-0.5 bg-red-500" style={{ left: LABEL + time * pps }} aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}
