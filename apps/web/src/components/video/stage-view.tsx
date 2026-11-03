"use client";
import { useEffect, useRef, useState } from "react";
import { evalChannel, transformAt } from "@lvs/camera-presets";
import {
  CANVAS_1080, resolveScene, sceneCamera, sceneStarts, sceneTransition, totalDuration, type EditPlan, type ItemKey, type Overlay, type TextOverlay,
} from "@/lib/video/plan";
import { narrationStart } from "@/lib/video/editor-layers";
import { cn } from "@/lib/utils";

/**
 * One frame of the video at `time` seconds. Uses the same scene timing,
 * camera-move keyframes, fades and text placement as the FableCut document;
 * the final MP4 is rendered by FableCut's own compositor.
 */
export function StageView({
  plan, time, photoUrls, brandColor, className, fit = true, clipUrls,
}: {
  plan: EditPlan; time: number; photoUrls: Record<string, string | null>; brandColor: string; className?: string;
  /** Playable links of AI camera clips used by scenes. */
  clipUrls?: Record<string, string | null>;
  /** Limit the width of tall and square videos so they fit on screen. */
  fit?: boolean;
}) {
  const canvas = CANVAS_1080[plan.aspect];
  const starts = sceneStarts(plan);
  const maxWidth = !fit || plan.aspect === "16:9" ? "100%" : plan.aspect === "1:1" || plan.aspect === "4:5" ? "460px" : "340px";

  return (
    <div className={cn("mx-auto w-full", className)} style={{ maxWidth }}>
      <div className="relative w-full overflow-hidden rounded-xl bg-black" style={{ aspectRatio: `${canvas.width} / ${canvas.height}`, containerType: "size" }} aria-label="Video preview" role="img">
        {plan.scenes.map((s, i) => {
          const start = starts.get(s.id)!;
          const next = sceneTransition(plan, i + 1).seconds, into = sceneTransition(plan, i).seconds;
          const len = s.duration + (i < plan.scenes.length - 1 ? next : 0);
          const local = time - start;
          if (local < 0 || local >= len) return null;
          const opacity = i > 0 && into > 0 && local < into ? local / into : 1;
          const clipUrl = s.clipAssetId ? clipUrls?.[s.clipAssetId] : null;
          if (clipUrl) {
            return (
              <div key={s.id} className="absolute inset-0" style={{ opacity, zIndex: i }}>
                <ClipFrame url={clipUrl} time={local} />
              </div>
            );
          }
          // exactly the keyframes FableCut renders (x/y in px of the 1080p canvas → % of the frame)
          const cam = sceneCamera(s, len, canvas);
          const placed = cam?.props && s.position && !s.camera && s.move === "still";
          const tr = placed ? { x: cam!.props!.x ?? 0, y: cam!.props!.y ?? 0, scale: cam!.props!.scale ?? 1, rotation: cam!.props!.rotation ?? 0 } : transformAt(cam?.keyframes, local);
          const url = photoUrls[s.assetId];
          return (
            <div key={s.id} className="absolute inset-0" style={{ opacity, zIndex: i }}>
              {url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={url} alt="" className="size-full object-cover"
                  style={{ transform: `translate(${(tr.x / canvas.width) * 100}%, ${(tr.y / canvas.height) * 100}%) rotate(${tr.rotation}deg) scale(${tr.scale})` }} />
              ) : <div className="size-full bg-muted" />}
            </div>
          );
        })}
        {plan.texts.map((t) => <StageText key={t.id} t={t} plan={plan} time={time} brandColor={brandColor} />)}
        {(plan.overlays ?? []).map((o) => <StageOverlay key={o.id} o={o} time={time} />)}
        <StageCaption plan={plan} time={time} brandColor={brandColor} />
      </div>
    </div>
  );
}

/** A video frame at `time` seconds (AI clips in the preview). */
function ClipFrame({ url, time }: { url: string; time: number }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (v && Math.abs(v.currentTime - time) > 0.08) v.currentTime = time;
  }, [time]);
  return <video ref={ref} src={url} muted playsInline preload="auto" className="size-full object-cover" />;
}

function StageText({ t, plan, time, brandColor }: { t: TextOverlay; plan: EditPlan; time: number; brandColor: string }) {
  const scene = resolveScene(plan, t.sceneId);
  if (!scene) return null;
  const start = sceneStarts(plan).get(scene.id)! + (t.offset ?? 0);
  const end = start + (t.duration ?? scene.duration - (t.offset ?? 0));
  if (time < start || time >= end) return null;
  const k = keyed(t.keys, time - start, { x: t.x ?? 0, y: t.y ?? 0, scale: 1, rotation: 0, opacity: 1 });
  const free = t.x != null || t.y != null || !!t.keys?.length;
  const pos = free ? "" : t.position === "top" ? "top-[10%]" : t.position === "bottom" ? "bottom-[10%]" : "top-1/2 -translate-y-1/2";
  // font sizes follow composeDocument (share of the short side), in container units
  const short = plan.aspect === "16:9" ? "cqh" : "cqw";
  const size = t.style === "title" ? 7.5 : t.style === "banner" ? 6 : 4.5;
  return (
    <div className={cn("pointer-events-none absolute inset-x-[7%] z-[100] flex justify-center text-center", pos)}
      style={free ? { top: `${50 + k.y * 100}%`, transform: `translate(${k.x * 100}%, -50%) scale(${k.scale}) rotate(${k.rotation}deg)`, opacity: k.opacity } : undefined}>
      <span
        className={cn("whitespace-pre-line rounded-md px-[0.6em] py-[0.2em] leading-tight text-white", t.style !== "caption" && "font-bold")}
        style={{
          fontSize: `${size}${short}`,
          background: t.style === "banner" ? brandColor : t.style === "caption" ? "rgba(0,0,0,0.6)" : "transparent",
          textShadow: t.style === "title" ? "0 2px 12px rgba(0,0,0,0.7)" : undefined,
        }}
      >
        {t.text}
      </span>
    </div>
  );
}

/** Values of item keyframes at local time t (linear, matching the export closely enough for a preview). */
function keyed(keys: ItemKey[] | undefined, t: number, base: { x: number; y: number; scale: number; rotation: number; opacity: number }) {
  if (!keys?.length) return base;
  const out = { ...base };
  for (const name of ["x", "y", "scale", "rotation", "opacity"] as const) {
    const ks = keys.filter((k) => k[name] != null).map((k) => ({ t: k.t, v: k[name]! }));
    if (ks.length) out[name] = evalChannel(ks, t, base[name]);
  }
  return out;
}

const OVERLAY_SHAPE: Record<Overlay["preset"], string> = {
  "lower-third": "rounded-md px-[1.2em] py-[0.5em]", badge: "aspect-square rounded-full p-[1em]", "price-tag": "rounded-full px-[1.5em] py-[0.5em]",
  "sold-stamp": "rounded-md border-[0.25em] bg-transparent px-[1em] py-[0.2em]", arrow: "", frame: "", underline: "", sparkle: "",
};

/** A preview of an animated overlay (the MP4 uses FableCut shape layers). */
function StageOverlay({ o, time }: { o: Overlay; time: number }) {
  const local = time - o.start;
  if (local < 0 || local >= o.duration) return null;
  const k = keyed(o.keys, local, { x: o.x, y: o.y, scale: o.scale, rotation: o.rotation ?? 0, opacity: 1 });
  const inP = o.animIn === "none" ? 1 : Math.min(1, local / 0.4);
  const outP = o.animOut === "none" ? 1 : Math.min(1, (o.duration - local) / 0.4);
  const opacity = k.opacity * Math.min(inP, outP);
  const pop = o.animIn === "pop" && local < 0.4 ? 0.3 + 0.7 * inP : 1;
  const slide = o.animIn === "slide-up" ? (1 - inP) * 8 : 0;
  if (o.preset === "frame") return <div className="pointer-events-none absolute inset-[3%] z-[90] rounded-lg border-[1cqmin]" style={{ borderColor: o.color, opacity }} />;
  const shape = OVERLAY_SHAPE[o.preset];
  const label = o.text ?? (o.preset === "badge" ? "NEW" : o.preset === "sold-stamp" ? "SOLD" : o.preset === "arrow" ? "" : o.preset === "lower-third" ? "Your text" : "");
  const body = o.preset === "arrow" ? <span style={{ color: o.color }} className="text-[12cqmin] font-black leading-none">➜</span>
    : o.preset === "underline" ? <span className="block h-[1.2cqmin] w-[50cqmin] rounded-full" style={{ background: o.color }} />
    : o.preset === "sparkle" ? <span style={{ color: o.color }} className="text-[10cqmin] leading-none">✦ ✧</span>
    : <span className={cn("flex items-center justify-center whitespace-nowrap text-[4.5cqmin] font-bold text-white", shape)}
        style={o.preset === "sold-stamp" ? { borderColor: o.color, color: o.color } : { background: o.color }}>{label}</span>;
  return (
    <div className="pointer-events-none absolute z-[95]" style={{ left: `${50 + k.x * 100}%`, top: `${50 + k.y * 100 + slide}%`, opacity,
      transform: `translate(-50%, -50%) scale(${k.scale * pop}) rotate(${k.rotation}deg)` }}>
      {body}
    </div>
  );
}

/** The caption line at this moment (highlighting the spoken word for karaoke / highlight / pop). */
function StageCaption({ plan, time, brandColor }: { plan: EditPlan; time: number; brandColor: string }) {
  const c = plan.captions;
  if (!c?.enabled || !c.cues.length) return null;
  const t = time - narrationStart(plan);
  const cue = c.cues.find((x) => t >= x.start && t < x.end);
  if (!cue) return null;
  const words = cue.text.split(/\s+/);
  const active = cue.words && cue.words.length === words.length ? cue.words.findIndex(([a, b]) => t >= a && t < b) : -1;
  const pos = c.position === "top" ? "top-[12%]" : c.position === "center" ? "top-1/2 -translate-y-1/2" : "bottom-[12%]";
  const size = (c.style === "highlight" ? 6.8 : c.style === "pop" ? 8 : 4.8) * c.size;
  return (
    <div className={cn("pointer-events-none absolute inset-x-[5%] z-[110] flex justify-center text-center", pos)} data-caption={cue.id}>
      <span className={cn("rounded-md px-[0.5em] py-[0.15em] leading-tight", c.style === "subtitle" ? "bg-black/60 text-white" : "font-black text-white [text-shadow:0_0_6px_#000,0_2px_4px_#000]")}
        style={{ fontSize: `${size}cqmin` }}>
        {words.map((w, i) => {
          if (c.style === "pop" && cue.words && i > Math.max(active, 0) && active >= 0) return null;
          return <span key={i} style={i === active && (c.style === "highlight" || c.style === "karaoke") ? { color: brandColor } : undefined}>{(c.style === "highlight" ? w.toUpperCase() : w) + (i < words.length - 1 ? " " : "")}</span>;
        })}
      </span>
    </div>
  );
}

/**
 * A small looping sample (no controls) — used on the style cards. It plays the
 * first `seconds` of the plan while it is on screen, and stays still for people
 * who prefer reduced motion.
 */
export function MiniPreview({
  plan, photoUrls, brandColor, seconds = 8, className,
}: { plan: EditPlan; photoUrls: Record<string, string | null>; brandColor: string; seconds?: number; className?: string }) {
  const [time, setTime] = useState(0.6);
  const box = useRef<HTMLDivElement>(null);
  const loop = Math.max(1, Math.min(seconds, totalDuration(plan)));

  useEffect(() => {
    if (typeof window === "undefined" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    let visible = true;
    const began = performance.now();
    const io = typeof IntersectionObserver !== "undefined" && box.current
      ? new IntersectionObserver(([e]) => { visible = !!e?.isIntersecting; })
      : null;
    if (io && box.current) io.observe(box.current);
    let last = 0;
    const tick = (now: number) => {
      // ~30 fps is plenty for a thumbnail-sized sample
      if (visible && now - last > 33) { last = now; setTime(((now - began) / 1000) % loop); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); io?.disconnect(); };
  }, [loop]);

  return (
    <div ref={box} className={className} aria-hidden="true">
      <StageView plan={plan} time={time} photoUrls={photoUrls} brandColor={brandColor} fit={false} />
    </div>
  );
}
