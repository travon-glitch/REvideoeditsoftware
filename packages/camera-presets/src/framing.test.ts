/*
 * Framing modes. Each check redoes FableCut's own drawing math (fit → translate → rotate →
 * scale about the centre) instead of calling the engine's helpers, so a bug in the engine's
 * geometry can't hide itself.
 */
import { describe, expect, it } from "vitest";
import {
  MOVE_PRESETS, applyMovePreset, cameraKeyframes, defaultSpec, manualFrames, photoFraming, photoScale, safeAreaFromPixels,
  transformAt, withManualFrame, type CameraSpec, type PhotoFit,
} from "./index.ts";

const CANVAS = { "9:16": { width: 1080, height: 1920 }, "16:9": { width: 1920, height: 1080 }, "1:1": { width: 1080, height: 1080 } } as const;
const PHOTOS = {
  landscape: { width: 1920, height: 1080 },
  portrait: { width: 1200, height: 1600 },
  square: { width: 1500, height: 1500 },
  veryWide: { width: 4000, height: 1000 },
} as const;

/** Corners of the drawn photo (canvas px from the centre), exactly as FableCut draws a `fit` image. */
function photoCorners(tr: { x: number; y: number; scale: number; rotation: number }, canvas: { width: number; height: number }, photo: { width: number; height: number }, fit: "contain" | "cover") {
  const f = (fit === "cover" ? Math.max : Math.min)(canvas.width / photo.width, canvas.height / photo.height) * tr.scale;
  const dw = photo.width * f, dh = photo.height * f, th = (tr.rotation * Math.PI) / 180;
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([ux, uy]) => {
    const px = (ux! * dw) / 2, py = (uy! * dh) / 2;
    return [tr.x + px * Math.cos(th) - py * Math.sin(th), tr.y + px * Math.sin(th) + py * Math.cos(th)] as const;
  });
}
const inside = (pts: readonly (readonly [number, number])[], c: { width: number; height: number }) =>
  pts.every(([x, y]) => Math.abs(x) <= c.width / 2 + 1 && Math.abs(y) <= c.height / 2 + 1);

function samples(spec: CameraSpec, canvas: { width: number; height: number }, photo: { width: number; height: number }, duration = 5) {
  const r = cameraKeyframes(spec, duration, canvas, photo);
  return { r, trs: Array.from({ length: 61 }, (_, i) => transformAt(r.keyframes, (duration * i) / 60)) };
}
const REST = { x: 0, y: 0, zoom: 1, rotation: 0 };
const fitSpec = (fit: PhotoFit, patch: Partial<CameraSpec> = {}) => defaultSpec("push_in", { fit, ...patch });

describe("Show Entire Photo (contain)", () => {
  it("1. a 16:9 photo in a 9:16 video shows the whole house", () => {
    const { r, trs } = samples(fitSpec("contain", { startFrame: REST, endFrame: REST }), CANVAS["9:16"], PHOTOS.landscape);
    expect(r.props.fit).toBe("contain");
    for (const tr of trs) expect(inside(photoCorners(tr, CANVAS["9:16"], PHOTOS.landscape, "contain"), CANVAS["9:16"])).toBe(true);
    // at rest the photo is exactly as wide as the frame: 1.0×, no hidden zoom
    expect(photoScale(r.framing, trs[0]!, CANVAS["9:16"])).toBeCloseTo(1, 3);
    expect(r.background?.kind).toBe("blur");
  });

  it("2. Move Left keeps the house fully visible and still moves", () => {
    const spec = applyMovePreset(fitSpec("contain"), "move_left");
    const { r, trs } = samples(spec, CANVAS["9:16"], PHOTOS.landscape);
    for (const tr of trs) expect(inside(photoCorners(tr, CANVAS["9:16"], PHOTOS.landscape, "contain"), CANVAS["9:16"])).toBe(true);
    const xs = trs.map((t) => t.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(40); // real movement, not disabled
    expect(r.fitScale).toBeLessThan(1); // the photo was made a little smaller to have room to move
    expect(r.fitScale).toBeGreaterThan(0.8);
  });

  it("3. Gentle Zoom does not crop the photo", () => {
    const spec = applyMovePreset(fitSpec("contain"), "gentle_zoom");
    const { trs } = samples(spec, CANVAS["9:16"], PHOTOS.landscape);
    for (const tr of trs) expect(inside(photoCorners(tr, CANVAS["9:16"], PHOTOS.landscape, "contain"), CANVAS["9:16"])).toBe(true);
    expect(trs.at(-1)!.scale).toBeGreaterThan(trs[0]!.scale * 1.08);
    expect(trs.at(-1)!.scale).toBeLessThanOrEqual(1.0001); // ends at the whole photo, never past it
  });

  it("4. switching 9:16 → 16:9 reframes from the same spec", () => {
    const spec = applyMovePreset(fitSpec("contain"), "full_view");
    const v = photoFraming(spec, CANVAS["9:16"], PHOTOS.landscape), h = photoFraming(spec, CANVAS["16:9"], PHOTOS.landscape);
    expect([v.iw, Math.round(v.ih)]).toEqual([1080, 608]);
    expect([h.iw, h.ih]).toEqual([1920, 1080]);
    for (const canvas of [CANVAS["9:16"], CANVAS["16:9"]]) {
      const { trs } = samples(spec, canvas, PHOTOS.landscape);
      for (const tr of trs) expect(inside(photoCorners(tr, canvas, PHOTOS.landscape, "contain"), canvas)).toBe(true);
    }
  });

  it("7. portrait, landscape, square and very wide photos never clip, stretch or flash in any preset", () => {
    for (const [, photo] of Object.entries(PHOTOS)) {
      for (const canvas of Object.values(CANVAS)) {
        for (const p of MOVE_PRESETS) {
          const { r, trs } = samples(applyMovePreset(fitSpec("contain"), p.id), canvas, photo);
          expect(r.props.fit).toBe("contain"); // FableCut keeps the photo's proportions (no stretch)
          for (const tr of trs) {
            expect(Number.isFinite(tr.x + tr.y + tr.scale + tr.rotation)).toBe(true);
            expect(tr.scale).toBeGreaterThan(0.3); // never shrinks to nothing (no black flash)
            expect(inside(photoCorners(tr, canvas, photo, "contain"), canvas)).toBe(true);
          }
        }
      }
    }
  });

  it("a hand-made big move is scaled down, not cut off, and reports it", () => {
    const spec = fitSpec("contain", { manual: { horizontal: 10, vertical: 0, zoom: 8, pan: 0, tilt: 0, rotate: 4 } });
    const { r, trs } = samples(spec, CANVAS["9:16"], PHOTOS.landscape);
    for (const tr of trs) expect(inside(photoCorners(tr, CANVAS["9:16"], PHOTOS.landscape, "contain"), CANVAS["9:16"])).toBe(true);
    expect(r.fitScale).toBeLessThan(0.8);
    expect(r.edgeGuard).toBe(1);
  });
});

describe("Fill Screen (cover)", () => {
  it("5. fills the whole frame at every moment", () => {
    for (const p of MOVE_PRESETS) {
      const spec = applyMovePreset(fitSpec("cover"), p.id);
      const { r, trs } = samples(spec, CANVAS["9:16"], PHOTOS.landscape);
      expect(r.props.fit).toBe("cover");
      expect(r.background).toBeNull();
      for (const tr of trs) {
        // every frame corner must land on the photo
        const f = Math.max(1080 / 1920, 1920 / 1080) * tr.scale, hw = (1920 * f) / 2, hh = (1080 * f) / 2, th = (-tr.rotation * Math.PI) / 180;
        for (const [cx, cy] of [[-540, -960], [540, -960], [540, 960], [-540, 960]] as const) {
          const dx = cx - tr.x, dy = cy - tr.y;
          expect(Math.abs(dx * Math.cos(th) - dy * Math.sin(th))).toBeLessThanOrEqual(hw + 1);
          expect(Math.abs(dx * Math.sin(th) + dy * Math.cos(th))).toBeLessThanOrEqual(hh + 1);
        }
      }
    }
  });

  it("tells how much of the photo is cut", () => {
    const f = photoFraming(fitSpec("cover"), CANVAS["9:16"], PHOTOS.landscape);
    expect(f.visible.w).toBeCloseTo(0.316, 2); // only ~32% of a 16:9 photo's width fits a 9:16 frame
    expect(f.visible.h).toBe(1);
  });

  it("specs saved before framing modes render exactly as before (cover)", () => {
    const old = defaultSpec("truck_left");
    delete (old as Partial<CameraSpec>).fit;
    expect(cameraKeyframes(old, 5, CANVAS["9:16"], PHOTOS.landscape).props.fit).toBe("cover");
  });
});

describe("Smart Fit", () => {
  it("frames the safe area as large as fits and keeps it whole", () => {
    const safeArea = { x0: 0.25, y0: 0.1, x1: 0.75, y1: 0.95 };
    const spec = applyMovePreset(fitSpec("smart", { safeArea }), "move_right");
    const canvas = CANVAS["9:16"], photo = PHOTOS.landscape;
    const { r, trs } = samples(spec, canvas, photo);
    expect(r.framing.zoom).toBeGreaterThan(1.9); // closer than the whole photo …
    expect(r.framing.zoom).toBeLessThanOrEqual(1920 / 1080 / (1080 / 1920) + 1e-6); // … never past Fill Screen
    for (const tr of trs) {
      const f = Math.min(canvas.width / photo.width, canvas.height / photo.height) * tr.scale;
      const pts = [[safeArea.x0, safeArea.y0], [safeArea.x1, safeArea.y0], [safeArea.x1, safeArea.y1], [safeArea.x0, safeArea.y1]]
        .map(([u, v]) => [tr.x + (u! - 0.5) * photo.width * f, tr.y + (v! - 0.5) * photo.height * f] as const);
      expect(inside(pts, canvas)).toBe(true);
    }
  });

  it("finds the detailed part of a photo", () => {
    // 100×60 "photo": flat sky and lawn, a detailed house from x 30…70, y 15…45
    const w = 100, h = 60, g = new Float64Array(w * h).fill(128);
    for (let y = 15; y < 45; y++) for (let x = 30; x < 70; x++) g[y * w + x] = (x * 7 + y * 13) % 2 ? 230 : 20;
    const a = safeAreaFromPixels(g, w, h);
    expect(a.x0).toBeGreaterThan(0.2); expect(a.x0).toBeLessThan(0.3);
    expect(a.x1).toBeGreaterThan(0.7); expect(a.x1).toBeLessThan(0.8);
    expect(a.y0).toBeLessThan(0.25);
    expect(a.y1).toBeGreaterThanOrEqual(0.9); // keeps the ground in front of the home
  });
});

describe("start and end frames", () => {
  it("placing the start frame keeps the end frame where it was", () => {
    let spec = applyMovePreset(fitSpec("contain"), "move_right");
    const before = manualFrames(spec).end;
    spec = withManualFrame(spec, "start", { x: -0.05, y: 0.02, zoom: 1.2 });
    const f = manualFrames(spec);
    expect(f.start.x).toBeCloseTo(-0.05, 2);
    expect(f.start.zoom).toBeCloseTo(1.2, 2);
    expect(f.end.x).toBeCloseTo(before.x, 2);
    expect(f.end.zoom).toBeCloseTo(before.zoom, 2);
    spec = withManualFrame(spec, "end", { x: 0.08, y: 0, zoom: 1 });
    expect(manualFrames(spec).end.x).toBeCloseTo(0.08, 2);
    expect(manualFrames(spec).start.zoom).toBeCloseTo(1.2, 2);
  });
});
