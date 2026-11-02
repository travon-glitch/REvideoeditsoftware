import { describe, expect, it } from "vitest";
import {
  CINEMATIC_PRESETS, EASY_CAMERAS, LENS_STYLES, STUDIO_MOVES, STUDIO_MOVE_IDS, cameraKeyframes, coversFrame, defaultSpec,
  depthPose, easySpec, evalChannel, moveViews, presetSpec, transformAt, type CameraSpec,
} from "./index";

const HD = { width: 1920, height: 1080 };
const span = (spec: CameraSpec, d = 5) => {
  const r = cameraKeyframes(spec, d, HD);
  const a = transformAt(r.keyframes, 0), b = transformAt(r.keyframes, d);
  return { r, a, b };
};

describe("studio moves", () => {
  it("has all 19 advanced moves and the 6 easy choices", () => {
    expect(STUDIO_MOVE_IDS).toHaveLength(19);
    expect(STUDIO_MOVES.map((m) => m.name)).toEqual(expect.arrayContaining([
      "Push In", "Pull Out", "Dolly In", "Dolly Out", "Truck Left", "Truck Right", "Pan Left", "Pan Right", "Tilt Up", "Tilt Down",
      "Crane Up", "Crane Down", "Orbit Left", "Orbit Right", "Arc Left", "Arc Right", "Zoom", "Parallax", "Simulated Drone Reveal",
    ]));
    expect(EASY_CAMERAS.map((c) => c.name)).toEqual(["Move Closer", "Move Back", "Move Left", "Move Right", "Look Around", "Reveal Property"]);
  });

  it("labels honestly which moves need AI — no 2D move claims to be a 3D orbit", () => {
    for (const id of ["orbit_left", "orbit_right", "arc_left", "arc_right", "parallax", "drone_reveal"]) {
      const m = STUDIO_MOVES.find((x) => x.id === id)!;
      expect(m.requiresAI, id).toBe(true);
      expect(m.standard, id).toBe("stand-in");
      expect(m.ai.length, id).toBeGreaterThan(0);
    }
    expect(STUDIO_MOVES.find((m) => m.id === "zoom")!.standard).toBe("exact");
    expect(STUDIO_MOVES.find((m) => m.id === "push_in")!.requiresAI).toBe(false);
  });

  it("every move, preset and lens produces valid keyframes that never show past the photo's edge", () => {
    const specs: CameraSpec[] = [
      ...STUDIO_MOVE_IDS.flatMap((m) => [defaultSpec(m), defaultSpec(m, { strength: 1, distance: 0.4, rotation: 15, direction: 35 })]),
      ...CINEMATIC_PRESETS.map((p) => presetSpec(p.id)!),
      ...LENS_STYLES.map((l) => defaultSpec("truck_left", { lens: l, strength: 1 })),
    ];
    for (const s of specs) {
      for (const canvas of [HD, { width: 1080, height: 1920 }, { width: 1080, height: 1080 }]) {
        const r = cameraKeyframes(s, 4, canvas);
        for (let i = 0; i <= 40; i++) expect(coversFrame(transformAt(r.keyframes, (4 * i) / 40), canvas), `${s.move} ${canvas.width}`).toBe(true);
        for (const ch of Object.values(r.keyframes)) for (const k of ch) expect(Number.isFinite(k.v)).toBe(true);
      }
    }
  });

  it("moves in the named direction", () => {
    // Push In: magnifies; Pull Out: the reverse
    const push = span(defaultSpec("push_in"));
    expect(push.b.scale).toBeGreaterThan(push.a.scale * 1.1);
    const pull = span(defaultSpec("pull_out"));
    expect(pull.b.scale).toBeLessThan(pull.a.scale);
    // Truck Right: the camera goes right, so the picture moves left on screen (x decreases)
    const right = span(defaultSpec("truck_right"));
    expect(right.b.x).toBeLessThan(right.a.x);
    const left = span(defaultSpec("truck_left"));
    expect(left.b.x).toBeGreaterThan(left.a.x);
    // Tilt Up: the picture moves down on screen
    const up = span(defaultSpec("tilt_up"));
    expect(up.b.y).toBeGreaterThan(up.a.y);
    // Reverse swaps start and end
    const rev = span(defaultSpec("push_in", { reverse: true }));
    expect(rev.a.scale).toBeCloseTo(push.b.scale, 3);
  });

  it("Push In keeps the chosen target point fixed on screen", () => {
    const spec = defaultSpec("push_in", { target: { x: 0.25, y: -0.1 } });
    const r = cameraKeyframes(spec, 5, HD);
    const screen = (t: number) => {
      const tr = transformAt(r.keyframes, t);
      return [tr.x + tr.scale * 0.25 * HD.width, tr.y + tr.scale * -0.1 * HD.height] as const;
    };
    const [x0, y0] = screen(0), [x1, y1] = screen(5);
    expect(Math.abs(x1 - x0)).toBeLessThan(2);
    expect(Math.abs(y1 - y0)).toBeLessThan(2);
  });

  it("stronger intensity and longer distance move further; speed > 1 arrives early and holds", () => {
    const g = moveViews(easySpec("closer", "gentle"))[1].zoom;
    const d = moveViews(easySpec("closer", "dramatic"))[1].zoom;
    expect(d).toBeGreaterThan(g);
    const fast = cameraKeyframes(defaultSpec("push_in", { speed: 2 }), 6, HD);
    expect(fast.keyframes.scale.map((k) => k.t)).toEqual([0, 3, 6]);
    expect(evalChannel(fast.keyframes.scale, 4.5, 0)).toBe(evalChannel(fast.keyframes.scale, 6, 0));
  });

  it("uses custom keyframes, start/end frames, easing and motion blur", () => {
    const custom = cameraKeyframes(defaultSpec("push_in", {
      keyframes: [{ t: 0, x: 0, y: 0, zoom: 1.2, rotation: 0 }, { t: 0.5, x: 0.1, y: 0, zoom: 1.4, rotation: 2, ease: "linear" }, { t: 1, x: -0.1, y: 0, zoom: 1.2, rotation: 0 }],
      motionBlur: 180,
    }), 4, HD);
    expect(custom.keyframes.scale.map((k) => k.t)).toEqual([0, 2, 4]);
    expect(custom.keyframes.scale[1]!.ease).toBe("linear");
    expect(custom.props).toEqual({ motionBlur: 180, motionBlurSamples: 8 });
    const framed = cameraKeyframes(defaultSpec("zoom", { startFrame: { x: 0, y: 0, zoom: 1.5, rotation: 0 }, endFrame: { x: 0, y: 0, zoom: 1.2, rotation: 0 }, easing: "ease-out" }), 3, HD);
    expect(framed.keyframes.scale.map((k) => k.v)).toEqual([1.5, 1.2]);
    expect(framed.keyframes.scale[1]!.ease).toBe("ease-out");
  });

  it("matches FableCut's interpolation (ease on the destination key)", () => {
    const keys = [{ t: 0, v: 0 }, { t: 2, v: 10, ease: "ease-in" as const }];
    expect(evalChannel(keys, 1, 0)).toBeCloseTo(2.5);
    expect(evalChannel(keys, -1, 0)).toBe(0);
    expect(evalChannel(keys, 9, 0)).toBe(10);
    expect(evalChannel([{ t: 0, v: 0 }, { t: 2, v: 10 }], 1, 0)).toBeCloseTo(5);
  });

  it("gives the AI depth renderer real 3D poses (orbit turns, dolly travels)", () => {
    expect(Math.abs(depthPose(defaultSpec("orbit_right"), 1).yaw)).toBeGreaterThan(3);
    expect(depthPose(defaultSpec("dolly_in"), 1).tz).toBeGreaterThan(0);
    expect(depthPose(defaultSpec("dolly_in"), 0).tz).toBe(0);
    expect(depthPose(defaultSpec("zoom"), 1).fovDeg).toBeLessThan(depthPose(defaultSpec("zoom"), 0).fovDeg);
  });
});
