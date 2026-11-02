"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { totalDuration, type EditPlan } from "@/lib/video/plan";
import { StageView } from "./stage-view";

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/**
 * Instant in-browser preview. It uses the same scene timing, camera-move
 * keyframes, fades and text placement as the FableCut document; the final MP4
 * is rendered by FableCut's own compositor.
 */
export function PreviewPlayer({
  plan, photoUrls, musicUrl, brandColor, clipUrls,
}: {
  plan: EditPlan; photoUrls: Record<string, string | null>; musicUrl: string | null; brandColor: string;
  clipUrls?: Record<string, string | null>;
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

  return (
    <div className="flex flex-col gap-3">
      <StageView plan={plan} time={time} photoUrls={photoUrls} clipUrls={clipUrls} brandColor={brandColor} />
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
