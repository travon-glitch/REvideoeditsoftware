/*
 * Timeline editing operations on a plan (pure functions; the editor wraps them in undo/redo).
 * Times are seconds on the video's timeline.
 */
import { FIRST_SCENE, LAST_SCENE, MAX_SCENES, MAX_SCENE_SECONDS, MIN_SCENE_SECONDS, resolveScene, sceneStarts, totalDuration, type EditPlan, type Scene, type TextOverlay } from "./plan";

const r = (n: number) => Math.round(n * 100) / 100;
const uid = (p: string) => `${p}${Math.random().toString(36).slice(2, 8)}`;

/** The scene playing at time t (and the time inside it). */
export function sceneAt(plan: Pick<EditPlan, "scenes">, t: number): { scene: Scene; index: number; local: number } {
  const starts = sceneStarts(plan);
  for (let i = plan.scenes.length - 1; i >= 0; i--) {
    const s = plan.scenes[i]!;
    if (t >= starts.get(s.id)!) return { scene: s, index: i, local: t - starts.get(s.id)! };
  }
  return { scene: plan.scenes[0]!, index: 0, local: 0 };
}

/** Split a scene at `local` seconds into it: two scenes of the same photo, each showing its part of the camera move. */
export function splitScene(plan: EditPlan, sceneId: string, local: number): EditPlan {
  const i = plan.scenes.findIndex((s) => s.id === sceneId);
  if (i < 0) throw new Error("Scene not found");
  if (plan.scenes.length >= MAX_SCENES) throw new Error("This video already has the most scenes allowed");
  const s = plan.scenes[i]!;
  const at = r(local);
  if (at < MIN_SCENE_SECONDS || s.duration - at < MIN_SCENE_SECONDS) throw new Error(`Each part must be at least ${MIN_SCENE_SECONDS} s — the split is too short`);
  const seg = s.segment ?? { from: 0, to: 1 };
  const mid = seg.from + (seg.to - seg.from) * (at / s.duration);
  const moving = !!s.camera || s.move !== "still";
  const a: Scene = { ...s, duration: at, ...(moving ? { segment: { from: seg.from, to: r4(mid) } } : {}) };
  const b: Scene = { ...s, id: uid("s"), duration: r(s.duration - at), transition: "none", ...(moving ? { segment: { from: r4(mid), to: seg.to } } : {}) };
  if (s.clipAssetId) b.clipIn = r((s.clipIn ?? 0) + at);
  delete (b as Partial<Scene>).transitionSeconds;
  const scenes = [...plan.scenes];
  scenes.splice(i, 1, a, b);
  return { ...plan, scenes };
}
const r4 = (n: number) => Math.round(n * 10000) / 10000;

/** A copy of a scene right after it. */
export function duplicateScene(plan: EditPlan, sceneId: string): EditPlan {
  const i = plan.scenes.findIndex((s) => s.id === sceneId);
  if (i < 0) throw new Error("Scene not found");
  if (plan.scenes.length >= MAX_SCENES) throw new Error("This video already has the most scenes allowed");
  const copy: Scene = { ...structuredClone(plan.scenes[i]!), id: uid("s") };
  const scenes = [...plan.scenes];
  scenes.splice(i + 1, 0, copy);
  return { ...plan, scenes };
}

/** Trim (or extend) a scene to a new length within the allowed range. */
export function trimScene(plan: EditPlan, sceneId: string, seconds: number): EditPlan {
  const d = Math.min(MAX_SCENE_SECONDS, Math.max(MIN_SCENE_SECONDS, r(seconds)));
  return { ...plan, scenes: plan.scenes.map((s) => (s.id === sceneId ? { ...s, duration: d } : s)) };
}

/** Insert an AI camera clip (made from one of the photos) as a new scene at time `at`. */
export function insertAiClip(plan: EditPlan, input: { clipAssetId: string; sourceAssetId: string; at: number; duration: number }): EditPlan {
  if (plan.scenes.length >= MAX_SCENES) throw new Error("This video already has the most scenes allowed");
  const where = input.at >= totalDuration(plan) ? plan.scenes.length : sceneAt(plan, input.at).index + 1;
  const scene: Scene = { id: uid("s"), assetId: input.sourceAssetId, move: "still", clipAssetId: input.clipAssetId, duration: Math.min(MAX_SCENE_SECONDS, Math.max(MIN_SCENE_SECONDS, r(input.duration))) };
  const scenes = [...plan.scenes];
  scenes.splice(where, 0, scene);
  return { ...plan, scenes };
}

/** Where a text starts on the timeline. */
export function textStart(plan: Pick<EditPlan, "scenes">, t: Pick<TextOverlay, "sceneId" | "offset">): number {
  const s = resolveScene(plan, t.sceneId);
  return s ? sceneStarts(plan).get(s.id)! + (t.offset ?? 0) : 0;
}

/** Move a text to start at timeline time `at` (it follows the scene it lands on). */
export function moveText(plan: EditPlan, textId: string, at: number): EditPlan {
  const hit = sceneAt(plan, Math.max(0, at));
  const offset = Math.min(10, Math.max(0, r(hit.local)));
  const sceneId = hit.index === 0 && offset === 0 ? FIRST_SCENE : hit.scene.id;
  return { ...plan, texts: plan.texts.map((t) => (t.id === textId ? { ...t, sceneId, offset: offset || undefined } : t)) };
}

export { FIRST_SCENE, LAST_SCENE };
