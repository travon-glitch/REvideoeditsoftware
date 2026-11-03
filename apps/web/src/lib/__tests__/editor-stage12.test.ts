import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { defaultSpec, evalChannel } from "@lvs/camera-presets";
import { CANVAS_1080, OVERLAY_PRESETS, composeDocument, planSchema, sceneCamera, totalDuration, type EditPlan } from "@/lib/video/plan";
import { splitScene, duplicateScene, insertAiClip, trimScene, moveText } from "@/lib/video/timeline";
import { validateFableCutDocument } from "@/lib/video/validate-document";

const ids = Array.from({ length: 4 }, () => randomUUID());
const musicId = randomUUID(), voiceId = randomUUID(), clipId = randomUUID();
const photos = ids.map((id) => ({ id, storage_path: `o/listings/l/${id}.jpg`, file_name: "p.jpg", width: 1600, height: 1200 }));
const music = [
  { id: musicId, storage_path: `o/music/${musicId}.m4a`, file_name: "m.m4a", duration_seconds: 75 },
  { id: voiceId, storage_path: `o/projects/p/${voiceId}.m4a`, file_name: "narration.m4a", duration_seconds: 9.5 },
];
const aiClips = [{ id: clipId, storage_path: `o/listings/l/${clipId}.mp4`, file_name: "c.mp4", width: 1920, height: 1080, duration_seconds: 5, source_asset_id: ids[1]! }];

function fullPlan(aspect: EditPlan["aspect"] = "9:16"): EditPlan {
  return planSchema.parse({
    version: 1, aspect, transition: "fade",
    scenes: [
      { id: "s1", assetId: ids[0], move: "still", duration: 3, camera: defaultSpec("push_in") },
      { id: "s2", assetId: ids[1], move: "still", duration: 3, transition: "wipe", transitionSeconds: 0.8, position: { x: 0.1, y: -0.05, zoom: 1.4, rotation: 3 } },
      { id: "s3", assetId: ids[2], move: "pan_right", duration: 3, transition: "zoom" },
      { id: "s4", assetId: ids[3], move: "still", duration: 3, camera: defaultSpec("pull_out") },
    ],
    texts: [
      { id: "t1", text: "742 Evergreen Terrace", sceneId: "@first", style: "title", position: "bottom", duration: null, x: 0.1, y: 0.3,
        keys: [{ t: 0, x: -0.2, opacity: 0 }, { t: 1, x: 0.1, opacity: 1, ease: "ease-out" }] },
    ],
    music: { assetId: musicId, volume: 0.6, fadeOut: true, fadeIn: 1.5, fadeOutSeconds: 2, in: 4, start: 0.5, duck: 0.3 },
    overlays: OVERLAY_PRESETS.map((p, i) => ({ id: `o${i}`, preset: p, start: i * 1.2, duration: 2.5, x: 0, y: -0.2, scale: 0.8, rotation: 0, color: "#1D4ED8", text: p === "badge" ? "NEW" : undefined,
      animIn: i % 2 ? "pop" : "draw", animOut: "fade", keys: i === 0 ? [{ t: 0, scale: 0.8 }, { t: 2, scale: 1.1 }] : undefined })),
    voiceover: { assetId: voiceId, script: "Welcome to 742 Evergreen Terrace. Offered at $525,000.", voice: "af_heart", speed: 1, start: 1, volume: 1, duration: 9.5,
      sentences: [{ start: 0, end: 3.2 }, { start: 3.5, end: 9.4 }] },
    captions: { enabled: true, style: "highlight", position: "bottom", offset: 0.1, size: 1, source: "narration",
      cues: [
        { id: "c1", start: 0, end: 3.2, text: "Welcome to 742 Evergreen Terrace.", words: [[0, 0.4], [0.4, 0.6], [0.6, 1.5], [1.5, 2.2], [2.2, 3.1]] },
        { id: "c2", start: 3.5, end: 9.4, text: "Offered at $525,000.", words: [[3.5, 4], [4, 4.2], [4.2, 9.3]] },
      ] },
  });
}
const compose = (plan: EditPlan) => composeDocument({ plan, title: "t", photos, music, brand: { primary_color: "#1D4ED8", heading_font: "Montserrat", body_font: "Inter" }, clips: aiClips });
type C = { id: string; kind: string; track: string; start: number; in: number; duration: number; props: Record<string, unknown>; keyframes?: Record<string, { t: number; v: number }[]>; transitionIn?: { type: string; duration: number }; parent?: string };

describe("Stage 12 composer", () => {
  for (const aspect of ["16:9", "9:16", "1:1", "4:5"] as const) {
    it(`a plan with every layer is a valid FableCut document (${aspect})`, () => {
      const doc = compose(fullPlan(aspect));
      expect(validateFableCutDocument(doc)).toEqual({ ok: true });
      expect([doc.width, doc.height]).toEqual([CANVAS_1080[aspect].width, CANVAS_1080[aspect].height]);
    });
  }

  it("narration, captions with word times, music with trim, fades and ducking", () => {
    const clips = compose(fullPlan()).clips as C[];
    const voice = clips.find((c) => c.id === "c_voice")!;
    expect(voice).toMatchObject({ track: "A2", start: 1, duration: 9.5, props: { volume: 1 } });
    const caps = clips.filter((c) => c.id.startsWith("c_cap_"));
    expect(caps.map((c) => c.start)).toEqual([1.1, 4.6]); // narration start + offset + cue start
    expect(caps[0]!.props.wordTimes).toEqual([[0, 0.4], [0.4, 0.6], [0.6, 1.5], [1.5, 2.2], [2.2, 3.1]]);
    expect(caps[0]!.props.textAnim).toBe("highlight");
    const m = clips.find((c) => c.id === "c_music")!;
    expect(m).toMatchObject({ track: "A1", start: 0.5, in: 4 });
    expect(m.duration).toBeCloseTo(totalDuration(fullPlan()) - 0.5, 2);
    const vol = m.keyframes!.volume!;
    const at = (t: number) => evalChannel(vol as never, t, 0);
    expect(at(0)).toBe(0); // fade in
    expect(at(1.5)).toBeCloseTo(0.6 * 0.3, 3); // narration starts at 1.0 (music clock 0.5) → ducked
    expect(at(m.duration)).toBe(0); // fade out
    expect(at(4.0 - 0.5 + 0.15)).toBeCloseTo(0.6 * 0.3, 2); // the 0.3 s pause between sentences stays ducked
  });

  it("per-scene transitions, still placement and AI clip trim", () => {
    const plan = fullPlan();
    const clips = compose(plan).clips as C[];
    const s = (id: string) => clips.find((c) => c.id === `c_${id}`)!;
    expect(s("s2").transitionIn).toEqual({ type: "wipe", duration: 0.8 });
    expect(s("s1").duration).toBe(3.8); // overlaps into the wipe
    expect(s("s3").transitionIn).toEqual({ type: "zoom", duration: 0.5 });
    expect(s("s2").props).toMatchObject({ scale: 1.4, rotation: 3 });
    const withClip = insertAiClip(plan, { clipAssetId: clipId, sourceAssetId: ids[1]!, at: 2, duration: 4 });
    const trimmed = { ...withClip, scenes: withClip.scenes.map((x) => (x.clipAssetId ? { ...x, clipIn: 1.5 } : x)) };
    const ai = (compose(trimmed).clips as C[]).find((c) => c.kind === "video")!;
    expect(ai).toMatchObject({ in: 1.5, duration: 3.5 });
  });

  it("splitting a scene keeps the camera path continuous", () => {
    const plan = fullPlan();
    const split = splitScene(plan, "s1", 1.5);
    expect(split.scenes.map((x) => x.duration).slice(0, 2)).toEqual([1.5, 1.5]);
    const [a, b] = split.scenes;
    const canvas = CANVAS_1080["9:16"];
    const ka = sceneCamera(a!, a!.duration, canvas)!.keyframes, kb = sceneCamera(b!, b!.duration, canvas)!.keyframes;
    expect(evalChannel(ka.scale!, a!.duration, 1)).toBeCloseTo(evalChannel(kb.scale!, 0, 1), 3);
    const whole = sceneCamera(plan.scenes[0]!, 3, canvas)!.keyframes;
    expect(evalChannel(kb.scale!, 1.5, 1)).toBeCloseTo(evalChannel(whole.scale!, 3, 1), 3);
    expect(() => splitScene(plan, "s1", 0.4)).toThrow(/too short/);
  });

  it("duplicating, trimming and moving text on the timeline", () => {
    const plan = fullPlan();
    const dup = duplicateScene(plan, "s2");
    expect(dup.scenes).toHaveLength(5);
    expect(dup.scenes[2]!.assetId).toBe(ids[1]);
    expect(dup.scenes[2]!.id).not.toBe("s2");
    expect(trimScene(plan, "s3", 5.25).scenes[2]!.duration).toBe(5.25);
    expect(trimScene(plan, "s3", 0.2).scenes[2]!.duration).toBe(1.5);
    const moved = moveText(plan, "t1", 7.4); // into scene 3 (starts at 6)
    expect(moved.texts[0]).toMatchObject({ sceneId: "s3", offset: 1.4 });
  });

  it("text keyframes and position reach the document", () => {
    const t = (compose(fullPlan()).clips as C[]).find((c) => c.id === "c_text_t1")!;
    expect(t.props.x).toBe(108);
    expect(t.keyframes!.x).toEqual([{ t: 0, v: -216 }, { t: 1, v: 108, ease: "ease-out" }]);
    expect(t.keyframes!.opacity).toEqual([{ t: 0, v: 0 }, { t: 1, v: 1, ease: "ease-out" }]);
  });

  it("overlays: animated shape layers with their words parented", () => {
    const clips = compose(fullPlan()).clips as C[];
    const badge = clips.find((c) => c.id === "c_ov_o1")!;
    expect(badge.kind).toBe("shape");
    expect(badge.keyframes!.scale![0]!.v).toBeCloseTo(0.24, 2); // pop in from 30 %
    const words = clips.find((c) => c.id === "c_ovt_o1")!;
    expect(words).toMatchObject({ kind: "text", parent: "c_ov_o1", props: { text: "NEW" } });
    expect(clips.find((c) => c.id === "c_ov_o0")!.keyframes!.scale).toEqual([{ t: 0, v: 0.8 }, { t: 2, v: 1.1 }]);
  });
});
