"use client";
import { useEffect, useRef, useState } from "react";
import { getMove } from "@lvs/camera-presets";
import {
  CANVAS_1080, STILL, TRANSITION_SECONDS, resolveScene, sceneStarts, totalDuration, type EditPlan, type TextOverlay,
} from "@/lib/video/plan";
import { cn } from "@/lib/utils";

const easeInOut = (x: number) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);

/**
 * One frame of the video at `time` seconds. Uses the same scene timing,
 * camera-move keyframes, fades and text placement as the FableCut document;
 * the final MP4 is rendered by FableCut's own compositor.
 */
export function StageView({
  plan, time, photoUrls, brandColor, className, fit = true,
}: {
  plan: EditPlan; time: number; photoUrls: Record<string, string | null>; brandColor: string; className?: string;
  /** Limit the width of tall and square videos so they fit on screen. */
  fit?: boolean;
}) {
  const canvas = CANVAS_1080[plan.aspect];
  const starts = sceneStarts(plan);
  const T = plan.transition === "none" ? 0 : TRANSITION_SECONDS;
  const maxWidth = !fit || plan.aspect === "16:9" ? "100%" : plan.aspect === "1:1" ? "520px" : "340px";

  return (
    <div className={cn("mx-auto w-full", className)} style={{ maxWidth }}>
      <div className="relative w-full overflow-hidden rounded-xl bg-black" style={{ aspectRatio: `${canvas.width} / ${canvas.height}`, containerType: "size" }} aria-label="Video preview" role="img">
        {plan.scenes.map((s, i) => {
          const start = starts.get(s.id)!;
          const len = s.duration + (i < plan.scenes.length - 1 ? T : 0);
          const local = time - start;
          if (local < 0 || local >= len) return null;
          const opacity = i > 0 && T > 0 && local < T ? local / T : 1;
          const kb = s.move === STILL ? null : getMove(s.move)?.kenBurns;
          const p = easeInOut(Math.min(1, local / len));
          const scale = kb ? kb.scaleFrom + (kb.scaleTo - kb.scaleFrom) * p : 1;
          const url = photoUrls[s.assetId];
          return (
            <div key={s.id} className="absolute inset-0" style={{ opacity, zIndex: i }}>
              {url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={url} alt="" className="size-full object-cover"
                  style={{ transform: `translate(${(kb?.panX ?? 0) * p}%, ${(kb?.panY ?? 0) * p}%) scale(${scale})` }} />
              ) : <div className="size-full bg-muted" />}
            </div>
          );
        })}
        {plan.texts.map((t) => <StageText key={t.id} t={t} plan={plan} time={time} brandColor={brandColor} />)}
      </div>
    </div>
  );
}

function StageText({ t, plan, time, brandColor }: { t: TextOverlay; plan: EditPlan; time: number; brandColor: string }) {
  const scene = resolveScene(plan, t.sceneId);
  if (!scene) return null;
  const start = sceneStarts(plan).get(scene.id)!;
  const end = start + (t.duration ?? scene.duration);
  if (time < start || time >= end) return null;
  const pos = t.position === "top" ? "top-[10%]" : t.position === "bottom" ? "bottom-[10%]" : "top-1/2 -translate-y-1/2";
  // font sizes follow composeDocument (share of the short side), in container units
  const short = plan.aspect === "16:9" ? "cqh" : "cqw";
  const size = t.style === "title" ? 7.5 : t.style === "banner" ? 6 : 4.5;
  return (
    <div className={cn("pointer-events-none absolute inset-x-[7%] z-[100] flex justify-center text-center", pos)}>
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
