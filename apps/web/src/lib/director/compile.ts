/*
 * Storyboard (Claude's JSON) → EditPlan (the editor's model), deterministically.
 *
 * Nothing Claude returns is trusted blindly:
 *  - photo refs must name photos that were sent (unknown refs are dropped);
 *  - durations are clamped to what the editor allows; the opener goes first;
 *  - camera moves become Camera Studio specs (moves that need AI are swapped for
 *    their closest honest Standard move, and that is reported);
 *  - every text overlay passes the fact checker, otherwise it is dropped and reported;
 *  - the result is validated by the editor's own plan schema.
 */
import { defaultSpec, getStudioMove, INTENSITY_STRENGTH, type StudioMoveId } from "@lvs/camera-presets";
import {
  FIRST_SCENE, LAST_SCENE, MAX_SCENE_SECONDS, MAX_SCENES, MAX_TEXTS, MIN_SCENE_SECONDS, planSchema,
  type EditPlan, type Scene, type TextOverlay,
} from "@/lib/video/plan";
import { checkClaim, type VerifiedFacts } from "./facts";
import { DIRECTOR_STYLE_INFO, type DirectorStyle, type PhotoAnalysis, type RoomType, type Storyboard } from "./schema";

export interface DirectorPhoto { ref: string; assetId: string }
export interface CompileWarning { kind: "unknown_photo" | "removed_text" | "camera_changed" | "duration_adjusted" | "opener_fixed" | "duplicate_photo" | "removed_highlight"; message: string }

export interface CompiledStoryboard {
  plan: EditPlan;
  warnings: CompileWarning[];
  /** Kept with the plan for the review page. */
  director: {
    style: DirectorStyle; musicMood: string; callToAction: string | null; highlights: string[];
    captions: Storyboard["captions"]; reasons: string[]; title: string;
  };
}

/** For moves that need AI depth/generative video, the closest Standard (2D) move. */
const STANDARD_FOR: Partial<Record<StudioMoveId, StudioMoveId>> = {
  orbit_left: "truck_left", orbit_right: "truck_right", arc_left: "truck_left", arc_right: "truck_right",
  parallax: "truck_right", drone_reveal: "pull_out",
};

const round = (n: number) => Math.round(n * 100) / 100;

export function photoRefs(assetIds: string[]): DirectorPhoto[] {
  return assetIds.map((assetId, i) => ({ ref: `P${String(i + 1).padStart(2, "0")}`, assetId }));
}

export function compileStoryboard(input: {
  storyboard: Storyboard;
  analysis: PhotoAnalysis;
  photos: DirectorPhoto[];
  facts: VerifiedFacts;
  style: DirectorStyle;
}): CompiledStoryboard {
  const { storyboard: sb, photos, facts, style } = input;
  const warnings: CompileWarning[] = [];
  const byRef = new Map(photos.map((p) => [p.ref.toUpperCase(), p]));
  const rooms = new Set<RoomType>(input.analysis.photos.filter((p) => byRef.has(p.ref.toUpperCase())).map((p) => p.room_type));

  // scenes: known refs only, no duplicates, opener first
  const seen = new Set<string>();
  let raw = sb.scenes.map((s, i) => ({ ...s, ref: s.photo.trim().toUpperCase(), index: i }));
  raw = raw.filter((s) => {
    if (!byRef.has(s.ref)) { warnings.push({ kind: "unknown_photo", message: `Scene ${s.index + 1} named photo "${s.photo}", which wasn't sent — skipped.` }); return false; }
    if (seen.has(s.ref)) { warnings.push({ kind: "duplicate_photo", message: `${s.ref} was used twice — kept the first.` }); return false; }
    seen.add(s.ref);
    return true;
  });
  const opener = sb.opening_photo.trim().toUpperCase();
  if (byRef.has(opener) && raw[0]?.ref !== opener) {
    const at = raw.findIndex((s) => s.ref === opener);
    if (at > 0) raw = [raw[at]!, ...raw.filter((_, i) => i !== at)];
    warnings.push({ kind: "opener_fixed", message: `Moved the chosen opening photo ${opener} to the start.` });
  }
  raw = raw.slice(0, MAX_SCENES);
  if (raw.length === 0) throw new Error("The storyboard didn't use any of the uploaded photos");

  const sceneIdOf = new Map<number, string>();
  const scenes: Scene[] = raw.map((s, i) => {
    const seconds = Math.min(MAX_SCENE_SECONDS, Math.max(MIN_SCENE_SECONDS, round(Number(s.seconds) || 3)));
    if (seconds !== round(Number(s.seconds))) warnings.push({ kind: "duration_adjusted", message: `Scene ${i + 1}: ${s.seconds}s adjusted to ${seconds}s.` });
    let move = s.camera_move as StudioMoveId;
    const info = getStudioMove(move);
    if (!info || info.requiresAI) {
      const swap = STANDARD_FOR[move] ?? "push_in";
      warnings.push({ kind: "camera_changed", message: `Scene ${i + 1}: "${info?.name ?? move}" needs AI video, so the Standard "${getStudioMove(swap)!.name}" is used. You can make an AI version in Camera Studio.` });
      move = swap;
    }
    const id = `s${i + 1}`;
    sceneIdOf.set(s.index, id);
    return { id, assetId: byRef.get(s.ref)!.assetId, move: "still", duration: seconds, camera: defaultSpec(move, { strength: INTENSITY_STRENGTH[s.intensity] }) };
  });

  // one transition for the whole video (the editor's model): the storyboard's most common choice
  const counts = new Map<string, number>();
  raw.slice(1).forEach((s) => counts.set(s.transition, (counts.get(s.transition) ?? 0) + 1));
  const transition = ([...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "fade") as EditPlan["transition"];

  // texts: on known scenes, fact-checked
  const texts: TextOverlay[] = [];
  sb.text_overlays.forEach((t, i) => {
    const sceneId = t.scene === 0 ? FIRST_SCENE : sceneIdOf.get(t.scene);
    const clean = t.text.replace(/\s+\n/g, "\n").trim().slice(0, 200);
    if (!sceneId || !clean) return;
    const check = checkClaim(clean, facts, rooms);
    if (!check.ok) { warnings.push({ kind: "removed_text", message: `Removed "${clean.replace(/\n/g, " ")}": ${check.reason}.` }); return; }
    texts.push({ id: `t${i + 1}`, text: clean, sceneId, style: t.style, position: t.position, duration: null });
  });
  const cta = sb.call_to_action.trim().slice(0, 200);
  let callToAction: string | null = null;
  if (cta) {
    const check = checkClaim(cta, facts, rooms);
    if (check.ok) {
      callToAction = cta;
      if (!texts.some((t) => t.sceneId === LAST_SCENE || t.sceneId === scenes.at(-1)!.id)) {
        texts.push({ id: "t_cta", text: cta, sceneId: LAST_SCENE, style: "banner", position: "center", duration: null });
      }
    } else warnings.push({ kind: "removed_text", message: `Removed call to action "${cta}": ${check.reason}.` });
  }
  const highlights = sb.highlights.filter((h) => {
    const c = checkClaim(h, facts, rooms);
    if (!c.ok) warnings.push({ kind: "removed_highlight", message: `Removed highlight "${h}": ${c.reason}.` });
    return c.ok;
  }).slice(0, 6);
  const captions = Object.fromEntries(Object.entries(sb.captions).map(([k, v]) => {
    const c = checkClaim(v, facts, rooms);
    if (!c.ok) warnings.push({ kind: "removed_text", message: `Rewrote the ${k} caption: ${c.reason}.` });
    return [k, c.ok ? v : [facts.address, facts.city, facts.price].filter(Boolean).join(" · ")];
  })) as Storyboard["captions"];

  const plan = planSchema.parse({
    version: 1,
    aspect: DIRECTOR_STYLE_INFO[style].aspect,
    transition,
    scenes,
    texts: texts.slice(0, MAX_TEXTS),
    music: { assetId: null, volume: 0.7, fadeOut: true },
  });
  return {
    plan, warnings,
    director: { style, musicMood: sb.music_mood, callToAction, highlights, captions, reasons: raw.map((s) => s.reason), title: sb.title.slice(0, 160) },
  };
}
