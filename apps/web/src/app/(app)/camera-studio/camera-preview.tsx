"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { cameraKeyframes, photoScale, transformAt, type CameraSpec, type FrameBackground, type Transform } from "@lvs/camera-presets";
import { PhotoLayer } from "@/components/video/photo-layer";
import { Button } from "@/components/ui/button";
import { CANVAS_1080, type Aspect } from "@/lib/video/plan";
import { cn } from "@/lib/utils";

export interface PreviewPhoto { url: string | null; width: number | null; height: number | null }

/** The FableCut keyframes for this spec (same call the server makes when it renders). */
export function useCameraKeys(spec: CameraSpec, duration: number, aspect: Aspect, photo: PreviewPhoto | null) {
  return useMemo(() => {
    const size = photo?.width && photo.height ? { width: photo.width, height: photo.height } : null;
    return cameraKeyframes(spec, duration, CANVAS_1080[aspect], size);
  }, [spec, duration, aspect, photo?.width, photo?.height]);
}

/** One frame: the photo moved and framed exactly like the export (x/y in 1080p px → % of the frame). */
export function Frame({ url, tr, aspect, fit = "cover", background = null, drawn = null, className, children }: {
  url: string | null; tr: Transform; aspect: Aspect; fit?: "contain" | "cover"; background?: FrameBackground | null;
  drawn?: { iw: number; ih: number } | null; className?: string; children?: React.ReactNode;
}) {
  const c = CANVAS_1080[aspect];
  return (
    <div className={cn("relative w-full overflow-hidden bg-black", className)} style={{ aspectRatio: `${c.width} / ${c.height}` }}>
      <PhotoLayer url={url} tr={tr} canvas={c} fit={fit} background={background} drawn={drawn} />
      {children}
    </div>
  );
}

const fmt = (s: number) => `${s.toFixed(1)} s`;

/** The large live preview with play / pause / scrub. */
export function CameraPreview({
  photo, spec, duration, aspect, note, onTime, replay = 0,
}: {
  photo: PreviewPhoto | null; spec: CameraSpec; duration: number; aspect: Aspect; note?: React.ReactNode;
  onTime?: (t: number) => void;
  /** Change it to play the movement again from the start ("Preview Movement"). */
  replay?: number;
}) {
  const keys = useCameraKeys(spec, duration, aspect, photo);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(true);
  const began = useRef(0);
  const raf = useRef<number | null>(null);

  const stop = useCallback(() => { if (raf.current) cancelAnimationFrame(raf.current); raf.current = null; }, []);
  useEffect(() => {
    if (!playing) return;
    began.current = performance.now() - time * 1000;
    const tick = (now: number) => {
      // play, hold the last frame for half a second, loop
      const t = ((now - began.current) / 1000) % (duration + 0.5);
      setTime(Math.min(duration, t));
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, duration, stop]);
  useEffect(() => { onTime?.(time); }, [time, onTime]);
  useEffect(() => {
    if (!replay) return;
    setTime(0); began.current = performance.now(); setPlaying(true);
  }, [replay]);

  const tr = transformAt(keys.keyframes, time);
  return (
    <div className="flex flex-col gap-3">
      <div className="mx-auto w-full" style={{ maxWidth: aspect === "16:9" ? "100%" : aspect === "1:1" ? "520px" : "340px" }}>
        <Frame url={photo?.url ?? null} tr={tr} aspect={aspect} fit={keys.props.fit} background={keys.background} drawn={keys.framing} className="rounded-xl">
          {note ? <div className="absolute inset-x-2 bottom-2 rounded-md bg-black/70 px-3 py-1.5 text-center text-xs font-medium text-white">{note}</div> : null}
        </Frame>
      </div>
      <div className="flex items-center gap-3">
        <Button type="button" size="icon" onClick={() => setPlaying((p) => !p)} aria-label={playing ? "Pause preview" : "Play preview"}>
          {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
        </Button>
        <Button type="button" size="icon" variant="outline" onClick={() => { setTime(0); began.current = performance.now(); }} aria-label="Back to start"><RotateCcw aria-hidden="true" /></Button>
        <input type="range" min={0} max={duration} step={0.02} value={time} aria-label="Position in the clip"
          onChange={(e) => { setPlaying(false); setTime(Number(e.target.value)); }} className="h-2 flex-1 cursor-pointer accent-[hsl(var(--primary))]" />
        <span className="w-24 text-right text-sm tabular-nums text-muted-foreground">{fmt(time)} / {fmt(duration)}</span>
      </div>
      <p className="text-xs text-muted-foreground">
        {keys.mode === "cover"
          ? `Fill Screen shows ${Math.round(keys.framing.visible.w * keys.framing.visible.h * 100)}% of this photo${keys.edgeGuard > 1.001 ? `, zoomed in ${Math.round((keys.edgeGuard - 1) * 100)}% more so its edges never show` : ""}.`
          : `Photo size now: ${photoScale(keys.framing, tr, CANVAS_1080[aspect]).toFixed(2)}× (1.00× = the whole photo just fits).`}
        {keys.fitScale < 0.999 ? ` The movement was made ${Math.round((1 - keys.fitScale) * 100)}% smaller so the ${keys.mode === "smart" ? "home" : "whole photo"} stays in view.` : ""}
      </p>
    </div>
  );
}

/** Small looping sample for the move cards. Pauses off-screen; still for reduced motion. */
export function MiniCameraPreview({ photo, spec, aspect = "16:9", seconds = 3 }: { photo: PreviewPhoto | null; spec: CameraSpec; aspect?: Aspect; seconds?: number }) {
  const keys = useCameraKeys(spec, seconds, aspect, photo);
  const [t, setT] = useState(seconds * 0.6);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let visible = true, raf = 0, last = 0;
    const io = new IntersectionObserver(([e]) => { visible = !!e?.isIntersecting; });
    if (box.current) io.observe(box.current);
    const start = performance.now();
    const tick = (now: number) => {
      if (visible && now - last > 33) { last = now; setT(((now - start) / 1000) % (seconds + 0.4)); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); io.disconnect(); };
  }, [seconds]);
  return (
    <div ref={box} aria-hidden="true">
      <Frame url={photo?.url ?? null} tr={transformAt(keys.keyframes, Math.min(seconds, t))} aspect={aspect} fit={keys.props.fit} background={keys.background} drawn={keys.framing} />
    </div>
  );
}
