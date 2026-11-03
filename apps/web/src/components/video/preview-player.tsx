"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { totalDuration, type EditPlan } from "@/lib/video/plan";
import { StageView } from "./stage-view";

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/**
 * Instant in-browser preview. It uses the same scene timing, camera-move keyframes, fades, text,
 * overlays and captions as the FableCut document, and plays the music and the narration where the
 * timeline puts them; the final MP4 is rendered by FableCut's own compositor.
 * With `time` / `onTime` the playhead is shared with the timeline.
 */
export function PreviewPlayer({
  plan, photoUrls, musicUrl, brandColor, clipUrls, voiceUrl, time: controlled, onTime,
}: {
  plan: EditPlan; photoUrls: Record<string, string | null>; musicUrl: string | null; brandColor: string;
  clipUrls?: Record<string, string | null>; voiceUrl?: string | null;
  time?: number; onTime?: (t: number) => void;
}) {
  const total = totalDuration(plan);
  const [own, setOwn] = useState(0);
  const time = controlled ?? own;
  const setTime = useCallback((t: number) => { setOwn(t); onTime?.(t); }, [onTime]);
  const [playing, setPlaying] = useState(false);
  const raf = useRef<number | null>(null);
  const startedAt = useRef(0);
  const music = useRef<HTMLAudioElement>(null);
  const voice = useRef<HTMLAudioElement>(null);

  const stop = useCallback(() => {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = null;
    setPlaying(false);
    music.current?.pause();
    voice.current?.pause();
  }, []);

  /** Start / position the audio for timeline time t. */
  const syncAudio = useCallback((t: number, play: boolean) => {
    const m = music.current, mStart = plan.music.start ?? 0;
    if (m && musicUrl) {
      const at = t - mStart + (plan.music.in ?? 0);
      if (t >= mStart && (plan.music.end == null || t < plan.music.end)) {
        m.currentTime = Math.max(0, at); m.volume = Math.min(1, plan.music.volume);
        if (play) void m.play().catch(() => undefined);
      } else m.pause();
    }
    const v = voice.current, vo = plan.voiceover;
    if (v && vo && voiceUrl) {
      const at = t - vo.start;
      if (at >= 0 && at < vo.duration) { v.currentTime = at; v.volume = Math.min(1, vo.volume); if (play) void v.play().catch(() => undefined); }
      else v.pause();
    }
  }, [plan.music, plan.voiceover, musicUrl, voiceUrl]);

  const play = () => {
    const from = time >= total - 0.05 ? 0 : time;
    startedAt.current = performance.now() - from * 1000;
    setPlaying(true);
    syncAudio(from, true);
    let lastSync = from;
    const tick = () => {
      const t = (performance.now() - startedAt.current) / 1000;
      if (t >= total) { setTime(total); stop(); return; }
      setTime(t);
      // audio that starts later on the timeline (music start, narration start)
      if (Math.floor(t * 4) !== Math.floor(lastSync * 4)) {
        const vo = plan.voiceover, ms = plan.music.start ?? 0;
        if ((vo && lastSync < vo.start && t >= vo.start) || (lastSync < ms && t >= ms)) syncAudio(t, true);
        if (plan.music.end != null && t >= plan.music.end) music.current?.pause();
        lastSync = t;
      }
      // music ducking under the narration (preview approximation)
      if (music.current && plan.voiceover && plan.music.duck != null) {
        const vo = plan.voiceover, local = t - vo.start;
        const speaking = (vo.sentences ?? [{ start: 0, end: vo.duration }]).some((s) => local >= s.start - 0.2 && local <= s.end + 0.2);
        music.current.volume = Math.min(1, plan.music.volume * (speaking ? plan.music.duck : 1));
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  };

  useEffect(() => () => stop(), [stop]);
  useEffect(() => { if (time > total) setTime(total); }, [total, time, setTime]);

  const seek = (t: number) => {
    setTime(t);
    if (playing) { startedAt.current = performance.now() - t * 1000; syncAudio(t, true); }
  };

  return (
    <div className="flex flex-col gap-3">
      <StageView plan={plan} time={time} photoUrls={photoUrls} clipUrls={clipUrls} brandColor={brandColor} />
      {musicUrl ? <audio ref={music} src={musicUrl} preload="auto" /> : null}
      {voiceUrl ? <audio ref={voice} src={voiceUrl} preload="auto" /> : null}
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
