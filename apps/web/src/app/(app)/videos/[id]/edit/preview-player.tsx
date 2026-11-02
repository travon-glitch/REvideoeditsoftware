"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { getMove } from "@lvs/camera-presets";
import { Button } from "@/components/ui/button";
import {
  CANVAS_1080, STILL, TRANSITION_SECONDS, resolveScene, sceneStarts, totalDuration, type EditPlan, type TextOverlay,
} from "@/lib/video/plan";
import { cn } from "@/lib/utils";

const easeInOut = (x: number) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/**
 * Instant in-browser preview. It uses the same scene timing, camera-move
 * keyframes, fades and text placement as the FableCut document; the final MP4
 * is rendered by FableCut's own compositor.
 */
export function PreviewPlayer({
  plan, photoUrls, musicUrl, brandColor,
}: {
  plan: EditPlan; photoUrls: Record<string, string | null>; musicUrl: string | null; brandColor: string;
}) {
  const total = totalDuration(plan);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const raf = useRef<number | null>(null);
  const startedAt = useRef(0);
  const audio = useRef<HTMLAudioElement>(null);

  const stop = useCallback(() => {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = null;
    setPlaying(false);
    audio.current?.pause();
  }, []);

  const play = () => {
    const from = time >= total - 0.05 ? 0 : time;
    startedAt.current = performance.now() - from * 1000;
    setPlaying(true);
    if (audio.current && musicUrl) {
      audio.current.currentTime = from;
      audio.current.volume = plan.music.volume;
      void audio.current.play().catch(() => undefined);
    }
    const tick = () => {
      const t = (performance.now() - startedAt.current) / 1000;
      if (t >= total) { setTime(total); stop(); return; }
      setTime(t);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  };

  useEffect(() => () => stop(), [stop]);
  useEffect(() => { if (time > total) setTime(total); }, [total, time]);

  const seek = (t: number) => {
    setTime(t);
    if (playing) { startedAt.current = performance.now() - t * 1000; if (audio.current) audio.current.currentTime = t; }
  };

  const canvas = CANVAS_1080[plan.aspect];
  const starts = sceneStarts(plan);
  const T = plan.transition === "none" ? 0 : TRANSITION_SECONDS;

  return (
    <div className="flex flex-col gap-3">
      <div className="mx-auto w-full" style={{ maxWidth: plan.aspect === "16:9" ? "100%" : plan.aspect === "1:1" ? "520px" : "340px" }}>
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
          {plan.texts.map((t) => <PreviewText key={t.id} t={t} plan={plan} time={time} brandColor={brandColor} />)}
        </div>
      </div>
      {musicUrl ? <audio ref={audio} src={musicUrl} preload="auto" /> : null}
      <div className="flex items-center gap-3">
        <Button type="button" size="icon" onClick={() => (playing ? stop() : play())} aria-label={playing ? "Pause" : "Play"}>
          {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
        </Button>
        <Button type="button" size="icon" variant="outline" onClick={() => { stop(); seek(0); }} aria-label="Back to start"><RotateCcw aria-hidden="true" /></Button>
        <input
          type="range" min={0} max={total} step={0.05} value={Math.min(time, total)} aria-label="Position in the video"
          onChange={(e) => seek(Number(e.target.value))} className="h-2 flex-1 cursor-pointer accent-[hsl(var(--primary))]"
        />
        <span className="w-24 text-right text-sm tabular-nums text-muted-foreground">{fmt(time)} / {fmt(total)}</span>
      </div>
    </div>
  );
}

function PreviewText({ t, plan, time, brandColor }: { t: TextOverlay; plan: EditPlan; time: number; brandColor: string }) {
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
