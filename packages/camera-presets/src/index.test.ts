import { describe, expect, it } from "vitest";
import {
  CAMERA_MAP,
  CAMERA_MOVES,
  FIDELITY_GUARDRAIL,
  UPSTREAM_SOURCE,
  buildMotionPrompt,
  buildNanoBananaPrompt,
  getMove,
  kenBurnsKeyframes,
} from "./index";

describe("upstream tables (Open-Generative-AI, verbatim)", () => {
  it("are re-exported unchanged", () => {
    expect(Object.keys(CAMERA_MAP)).toContain("Full-Frame Cine Digital");
    expect(buildNanoBananaPrompt("a kitchen", "Full-Frame Cine Digital", "Premium Modern Prime", 35, "f/4"))
      .toContain("full-frame digital cinema camera");
    expect(UPSTREAM_SOURCE.license).toBe("MIT");
  });
});

describe("camera moves", () => {
  it("use plain English instead of camera jargon", () => {
    const names = CAMERA_MOVES.map((m) => m.name);
    expect(names).toContain("Move Closer");
    expect(names).toContain("Move Back");
    for (const jargon of [/dolly/i, /pan\b/i, /crane/i, /orbit/i, /drone/i, /push in/i]) {
      expect(names.some((n) => jargon.test(n)), String(jargon)).toBe(false);
    }
  });

  it("have unique ids and plain-language copy", () => {
    const ids = CAMERA_MOVES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of CAMERA_MOVES) {
      expect(m.name.length).toBeLessThanOrEqual(14);
      expect(m.description).toMatch(/\.$/);
    }
  });

  it("offers free Ken Burns moves", () => {
    expect(CAMERA_MOVES.filter((m) => !m.aiOnly).length).toBeGreaterThanOrEqual(3);
  });

  it("builds a motion prompt that always carries the fidelity guardrail", () => {
    const p = buildMotionPrompt("push_in", { focalLength: 24, aperture: "f/4" }, "living room");
    expect(p).toContain("living room");
    expect(p).toContain("dolly forward");
    expect(p).toContain("24mm (wide-angle dynamic perspective)");
    expect(p.endsWith(FIDELITY_GUARDRAIL)).toBe(true);
  });

  it("rejects unknown moves", () => {
    expect(getMove("barrel_roll")).toBeUndefined();
    expect(() => buildMotionPrompt("barrel_roll")).toThrow(/Unknown camera move/);
  });

  it("writes Ken Burns fallbacks as FableCut keyframes", () => {
    const kf = kenBurnsKeyframes("pan_right", 4, { width: 1920, height: 1080 });
    expect(kf.scale).toEqual([{ t: 0, v: 1.12 }, { t: 4, v: 1.12, ease: "ease-in-out" }]);
    expect(kf.x[1]).toEqual({ t: 4, v: 115.2, ease: "ease-in-out" });
    expect(kf.y[1]?.v).toBe(0);
    expect(() => kenBurnsKeyframes("pan_right", 0, { width: 1, height: 1 })).toThrow();
  });
});
