/*
 * One photo drawn the way FableCut draws it in the MP4: `fit` (contain or cover) into the frame,
 * then moved by x/y (1080p px), rotated and scaled about the centre. With Show Entire Photo or
 * Smart Fit, the background (blurred photo, colour or gradient) sits behind it, matching
 * composeDocument's background layer. Used by the Camera Studio preview, the Move camera frame
 * editor and the video editor's preview, so they all show exactly what will be exported.
 */
import { BACKGROUND_LOOK, type FrameBackground, type Transform } from "@lvs/camera-presets";

export function PhotoLayer({ url, tr, canvas, fit, background, drawn, ghost }: {
  url: string | null;
  tr: Transform;
  canvas: { width: number; height: number };
  fit: "contain" | "cover";
  background: FrameBackground | null;
  /**
   * The photo's size at scale 1 in canvas px (Framing.iw / ih). The picture element gets exactly
   * this box — an object-fit image would be clipped to the frame and show black where the export
   * still shows photo once it moves. Missing: the photo is assumed to have the frame's shape.
   */
  drawn?: { iw: number; ih: number } | null;
  /** Draw only the photo, without its background (for the dimmed "what gets cut" view). */
  ghost?: boolean;
}) {
  const iw = drawn?.iw || canvas.width, ih = drawn?.ih || canvas.height;
  const box = { width: `${(iw / canvas.width) * 100}%`, height: `${(ih / canvas.height) * 100}%`, left: `${((canvas.width - iw) / 2 / canvas.width) * 100}%`, top: `${((canvas.height - ih) / 2 / canvas.height) * 100}%` };
  const transform = `translate(${(tr.x / iw) * 100}%, ${(tr.y / ih) * 100}%) rotate(${tr.rotation}deg) scale(${tr.scale})`;
  // FableCut's blur is in canvas px; in container units it scales with the preview's size
  const blurCqw = (Math.min(canvas.width, canvas.height) * BACKGROUND_LOOK.blurOfShortSide / canvas.width) * 100;
  return (
    <div className="absolute inset-0" style={{ containerType: "size" }}>
      {!ghost && fit === "contain" && background ? (
        background.kind === "color" ? <div className="absolute inset-0" style={{ background: background.color }} />
          : background.kind === "gradient" ? <div className="absolute inset-0" style={{ background: `linear-gradient(to bottom, ${background.color}, ${background.color2})` }} />
          : url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="" draggable={false} className="absolute inset-0 size-full object-cover"
              style={{ transform: `scale(${BACKGROUND_LOOK.scale})`, filter: `blur(${blurCqw.toFixed(3)}cqw) brightness(${BACKGROUND_LOOK.brightness}%)` }} />
          ) : null
      ) : null}
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" draggable={false} className={`absolute max-w-none will-change-transform ${drawn ? "" : fit === "contain" ? "object-contain" : "object-cover"}`}
          style={{ ...box, transform }} />
      ) : null}
    </div>
  );
}
