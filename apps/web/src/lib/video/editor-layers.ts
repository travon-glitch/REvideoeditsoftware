/*
 * Stage 12 layers of a plan, as FableCut clips:
 *   - keyframes on texts and overlays (position, scale, rotation, opacity) + in/out animations,
 *   - animated overlays (lower third, badge, arrow, frame, underline, sparkles, stamp, price tag),
 *   - captions (one text clip per line, word times for karaoke / highlight / pop),
 *   - narration (A2) and background music (A1) with trim, fade in/out and ducking under the voice.
 */
import type { Cue, EditPlan, ItemKey, Overlay, PlanLook, PlanMusic } from "./plan";
import { mediaIdFor } from "./plan";

type Clip = Record<string, unknown>;
type Kf = { t: number; v: number; ease?: string };
const r = (n: number) => Math.round(n * 1000) / 1000;

/** Item keyframes (fractions of the frame) + in/out animation → FableCut keyframes (px). */
export function itemKeyframes(input: {
  keys?: ItemKey[]; base: { x: number; y: number; scale: number; rotation: number; opacity: number };
  canvas: { width: number; height: number }; duration: number; animIn?: string; animOut?: string;
}): Record<string, Kf[]> | undefined {
  const { canvas, duration, base } = input;
  const keys = [...(input.keys ?? [])].filter((k) => k.t <= duration + 0.001).sort((a, b) => a.t - b.t);
  const ch: Record<string, Kf[]> = {};
  const px = { x: (v: number) => r(v * canvas.width), y: (v: number) => r(v * canvas.height) };
  for (const name of ["x", "y", "scale", "rotation", "opacity"] as const) {
    const ks = keys.filter((k) => k[name] != null);
    if (!ks.length) continue;
    ch[name] = ks.map((k) => ({ t: r(k.t), v: name === "x" ? px.x(k[name]!) : name === "y" ? px.y(k[name]!) : k[name]!, ...(k.ease ? { ease: k.ease } : {}) }));
  }
  // in / out animation on channels the person didn't key
  const inLen = Math.min(0.5, duration / 3), outLen = Math.min(0.4, duration / 3);
  const add = (name: string, list: Kf[]) => { if (!ch[name]) ch[name] = list; };
  const pxBase = { x: px.x(base.x), y: px.y(base.y) };
  const animIn = input.animIn ?? "none", animOut = input.animOut ?? "none";
  const opacity: Kf[] = [], scale: Kf[] = [], x: Kf[] = [], y: Kf[] = [];
  if (animIn === "fade" || animIn === "slide-up" || animIn === "slide-left" || animIn === "draw") opacity.push({ t: 0, v: 0 }, { t: r(inLen), v: base.opacity, ease: "ease-out" });
  if (animIn === "pop") { scale.push({ t: 0, v: r(base.scale * 0.3) }, { t: r(inLen * 0.7), v: r(base.scale * 1.08), ease: "ease-out" }, { t: r(inLen), v: base.scale }); opacity.push({ t: 0, v: 0 }, { t: r(inLen * 0.4), v: base.opacity }); }
  if (animIn === "slide-up") y.push({ t: 0, v: r(pxBase.y + canvas.height * 0.08) }, { t: r(inLen), v: pxBase.y, ease: "ease-out" });
  if (animIn === "slide-left") x.push({ t: 0, v: r(pxBase.x + canvas.width * 0.12) }, { t: r(inLen), v: pxBase.x, ease: "ease-out" });
  const outAt = r(Math.max(inLen, duration - outLen));
  if (animOut === "fade" || animOut === "slide-down" || animOut === "slide-right") {
    if (!opacity.length) opacity.push({ t: 0, v: base.opacity });
    opacity.push({ t: outAt, v: base.opacity }, { t: r(duration), v: 0, ease: "ease-in" });
  }
  if (animOut === "pop") {
    if (!scale.length) scale.push({ t: 0, v: base.scale });
    scale.push({ t: outAt, v: base.scale }, { t: r(duration), v: r(base.scale * 0.2), ease: "ease-in" });
    if (!opacity.length) opacity.push({ t: 0, v: base.opacity });
    opacity.push({ t: r(duration - outLen / 3), v: base.opacity }, { t: r(duration), v: 0 });
  }
  if (animOut === "slide-down") { if (!y.length) y.push({ t: 0, v: pxBase.y }); y.push({ t: outAt, v: pxBase.y }, { t: r(duration), v: r(pxBase.y + canvas.height * 0.08), ease: "ease-in" }); }
  if (animOut === "slide-right") { if (!x.length) x.push({ t: 0, v: pxBase.x }); x.push({ t: outAt, v: pxBase.x }, { t: r(duration), v: r(pxBase.x + canvas.width * 0.12), ease: "ease-in" }); }
  if (opacity.length) add("opacity", opacity);
  if (scale.length) add("scale", scale);
  if (x.length) add("x", x);
  if (y.length) add("y", y);
  return Object.keys(ch).length ? ch : undefined;
}

/** One overlay → its clips (a shape layer, and a text clip for presets that carry words). */
export function overlayClips(o: Overlay, canvas: { width: number; height: number }, look: Pick<PlanLook, "headingFont" | "bodyFont"> | null, index: number): Clip[] {
  const short = Math.min(canvas.width, canvas.height);
  const S = short / 1080;
  const c = o.color;
  let shapes: Record<string, unknown>[] = [];
  let label: { text: string; size: number; color: string; dx?: number; dy?: number; box?: [number, number] } | null = null;
  const draw = o.animIn === "draw";
  const drawKeys = (len = 0.6) => (draw ? { keys: [{ t: 0, trimEnd: 0 }, { t: len, trimEnd: 100, ease: "ease-out" }] } : {});
  switch (o.preset) {
    case "lower-third":
      shapes = [
        { type: "rect", name: "Bar", w: 760 * S, h: 120 * S, radius: 10 * S, fill: `${c}e6`, ...(draw ? { keys: [{ t: 0, w: 0 }, { t: 0.5, w: 760 * S, ease: "ease-out" }] } : {}) },
        { type: "rect", name: "Accent", x: -380 * S + 8 * S, w: 16 * S, h: 120 * S, fill: "#ffffff" },
      ];
      label = { text: o.text || "Your text", size: 54 * S, color: "#ffffff", box: [700 * S, 110 * S] };
      break;
    case "badge":
      shapes = [{ type: "ellipse", name: "Badge", w: 260 * S, h: 260 * S, fill: c }, { type: "ellipse", w: 230 * S, h: 230 * S, fill: "none", stroke: "#ffffff", strokeWidth: 6 * S, ...drawKeys() }];
      label = { text: o.text || "NEW", size: 58 * S, color: "#ffffff", box: [210 * S, 160 * S] };
      break;
    case "price-tag":
      shapes = [{ type: "rect", w: 520 * S, h: 150 * S, radius: 75 * S, fill: c }, { type: "ellipse", x: -210 * S, w: 34 * S, h: 34 * S, fill: "#ffffff" }];
      label = { text: o.text || "$000,000", size: 64 * S, color: "#ffffff", dx: 25 * S, box: [420 * S, 130 * S] };
      break;
    case "sold-stamp":
      shapes = [{ type: "rect", w: 560 * S, h: 200 * S, radius: 16 * S, fill: "none", stroke: c, strokeWidth: 14 * S, ...drawKeys() }];
      label = { text: o.text || "SOLD", size: 120 * S, color: c, box: [520 * S, 180 * S] };
      break;
    case "arrow":
      shapes = [
        { type: "line", points: [[-200 * S, 0], [150 * S, 0]], stroke: c, strokeWidth: 22 * S, lineCap: "round", ...drawKeys(0.5) },
        { type: "polygon", x: 175 * S, sides: 3, w: 110 * S, h: 110 * S, rotation: 90, fill: c },
      ];
      if (o.text) label = { text: o.text, size: 50 * S, color: "#ffffff", dy: -90 * S, box: [600 * S, 90 * S] };
      break;
    case "frame":
      shapes = [{ type: "rect", w: canvas.width - 80 * S, h: canvas.height - 80 * S, radius: 18 * S, fill: "none", stroke: c, strokeWidth: 12 * S, ...drawKeys(0.8) }];
      break;
    case "underline":
      shapes = [{ type: "path", closed: false, points: [[-300 * S, 0, 0, 0, 120 * S, -18 * S], [300 * S, 6 * S, -120 * S, 18 * S, 0, 0]], stroke: c, strokeWidth: 16 * S, lineCap: "round", keys: [{ t: 0, trimEnd: 0 }, { t: 0.6, trimEnd: 100, ease: "ease-out" }] }];
      break;
    case "sparkle":
      shapes = [
        { type: "group", items: [
          { type: "star", sides: 4, inner: 0.25, w: 120 * S, h: 120 * S, fill: c },
          { type: "star", x: 130 * S, y: -70 * S, sides: 4, inner: 0.25, w: 70 * S, h: 70 * S, fill: c },
          { type: "star", x: -110 * S, y: 80 * S, sides: 4, inner: 0.25, w: 55 * S, h: 55 * S, fill: c },
        ], keys: [{ t: 0, rotation: 0 }, { t: o.duration, rotation: 90, ease: "linear" }] },
      ];
      break;
  }
  const base = { x: o.x, y: o.y, scale: o.scale, rotation: o.rotation ?? 0, opacity: 1 };
  const kf = itemKeyframes({ keys: o.keys, base, canvas, duration: o.duration, animIn: draw ? "fade" : o.animIn, animOut: o.animOut });
  const shapeClip: Clip = {
    id: `c_ov_${o.id}`, mediaId: null, kind: "shape", track: "V4", start: r(o.start), in: 0, duration: r(o.duration), name: o.preset,
    props: { x: r(o.x * canvas.width), y: r(o.y * canvas.height), scale: o.scale, rotation: o.rotation ?? 0, shapes },
    ...(kf ? { keyframes: kf } : {}),
  };
  const out = [shapeClip];
  if (label) {
    // the words ride on the shape (parented), so they move, turn and scale with it
    out.push({
      id: `c_ovt_${o.id}`, mediaId: null, kind: "text", track: "V4", start: r(o.start), in: 0, duration: r(o.duration), name: label.text.slice(0, 40), parent: shapeClip.id,
      props: {
        text: label.text, font: look?.headingFont ?? "Montserrat", bold: true, fontSize: Math.round(label.size), color: label.color, align: "center",
        x: r(label.dx ?? 0), y: r(label.dy ?? 0), boxW: Math.round(label.box?.[0] ?? 600), boxH: Math.round(label.box?.[1] ?? 120), boxFit: true, vAlign: "middle", textShadow: 0,
        textAnim: o.animIn === "none" ? "none" : "clip-reveal",
      },
      ...(kf?.opacity ? { keyframes: { opacity: kf.opacity } } : {}),
    });
  }
  void index;
  return out;
}

/** Where captions and narration sit on the timeline. */
export function narrationStart(plan: Pick<EditPlan, "voiceover" | "captions">): number {
  return (plan.voiceover?.start ?? 0) + (plan.captions?.offset ?? 0);
}

/** Caption lines → text clips (word times relative to each clip, for the word animations). */
export function captionClips(plan: EditPlan, canvas: { width: number; height: number }, look: Pick<PlanLook, "bodyFont" | "headingFont" | "accent"> | null, total: number): Clip[] {
  const c = plan.captions;
  if (!c?.enabled || !c.cues.length) return [];
  const short = Math.min(canvas.width, canvas.height);
  const base = narrationStart(plan);
  const y = c.position === "top" ? -Math.round(canvas.height * 0.3) : c.position === "center" ? 0 : Math.round(canvas.height * 0.33);
  const style = c.style;
  const size = Math.round(short * (style === "highlight" ? 0.068 : style === "pop" ? 0.08 : 0.048) * c.size);
  return c.cues.flatMap((cue: Cue) => {
    const start = r(base + cue.start);
    const end = Math.min(total, r(base + cue.end));
    if (end - start < 0.1 || start >= total) return [];
    const duration = r(end - start);
    const words = cue.text.split(/\s+/).filter(Boolean);
    const wordTimes = cue.words && cue.words.length === words.length
      ? cue.words.map(([a, b]) => [r(Math.max(0, a - cue.start)), r(Math.max(0.05, b - cue.start))])
      : undefined;
    const props: Record<string, unknown> = {
      text: style === "highlight" ? cue.text.toUpperCase() : cue.text, font: style === "subtitle" ? (look?.bodyFont ?? "Inter") : (look?.headingFont ?? "Montserrat"),
      fontSize: size, bold: style !== "subtitle", color: "#ffffff", align: "center", y,
      boxW: Math.round(canvas.width * 0.9), boxH: Math.round(size * 2.8), boxFit: true, vAlign: "middle", lineHeight: 1.15,
      caption: true, captionStyle: style,
      ...(style === "subtitle" ? { bgColor: "#000000", bgOpacity: 0.62, textShadow: 0, textAnim: "none" } : {}),
      ...(style === "karaoke" ? { textAnim: "karaoke", strokeWidth: Math.round(size * 0.08), strokeColor: "#000000", textShadow: 8 } : {}),
      ...(style === "highlight" ? { textAnim: "highlight", highlightColor: look?.accent ?? "#FFD166", strokeWidth: Math.round(size * 0.09), strokeColor: "#000000", textShadow: 10 } : {}),
      ...(style === "pop" ? { textAnim: "word-pop", strokeWidth: Math.round(size * 0.08), strokeColor: "#000000", textShadow: 10 } : {}),
      ...(wordTimes ? { wordTimes } : {}),
    };
    return [{ id: `c_cap_${cue.id}`, mediaId: null, kind: "text", track: "V10", start, in: 0, duration, name: cue.text.slice(0, 40), props }];
  });
}

/** Background music: trim, start/stop, fade in/out, ducking under the narration. */
export function musicClip(plan: EditPlan, music: PlanMusic, total: number): Clip | null {
  const m = plan.music;
  const start = Math.min(total - 0.5, m.start ?? 0);
  const stop = Math.min(total, m.end && m.end > start ? m.end : total);
  const srcLeft = music.duration_seconds ? Number(music.duration_seconds) - (m.in ?? 0) : Infinity;
  const len = r(Math.min(stop - start, srcLeft));
  if (!(len > 0.2)) return null;
  const vol = m.volume;
  const keys: Kf[] = [];
  const fadeIn = Math.min(m.fadeIn ?? 0, len / 2);
  const fadeOut = Math.min(m.fadeOutSeconds ?? (m.fadeOut ? 2 : 0), len / 2);
  // duck: dip during each narration sentence (0.25 s ramps), on the music clip's clock
  const vo = plan.voiceover;
  const dips: [number, number][] = [];
  if (vo && m.duck != null && m.duck < 1) {
    const sents = vo.sentences?.length ? vo.sentences : [{ start: 0, end: vo.duration }];
    for (const s of sents) {
      const a = vo.start + s.start - start - 0.25, b = vo.start + s.end - start + 0.25;
      if (b <= 0 || a >= len) continue;
      const last = dips[dips.length - 1];
      if (last && a - last[1] < 0.6) last[1] = b; else dips.push([a, b]);
    }
  }
  const level = (t: number) => {
    let v = vol;
    if (fadeIn > 0 && t < fadeIn) v *= t / fadeIn;
    if (fadeOut > 0 && t > len - fadeOut) v *= Math.max(0, (len - t) / fadeOut);
    for (const [a, b] of dips) if (t >= a + 0.25 && t <= b - 0.25) v *= m.duck!;
    return r(v);
  };
  const times = new Set<number>([0, len]);
  if (fadeIn > 0) times.add(r(fadeIn));
  if (fadeOut > 0) times.add(r(len - fadeOut));
  for (const [a, b] of dips) for (const t of [a, a + 0.25, b - 0.25, b]) if (t > 0 && t < len) times.add(r(t));
  for (const t of [...times].sort((a, b) => a - b)) keys.push({ t, v: level(t), ...(t > 0 ? { ease: "linear" } : {}) });
  const animated = keys.some((k) => k.v !== vol);
  return {
    id: "c_music", mediaId: mediaIdFor(music.id), kind: "audio", track: "A1", start: r(start), in: r(m.in ?? 0), duration: len,
    name: "Music", props: { volume: vol }, ...(animated ? { keyframes: { volume: keys } } : {}),
  };
}

/** Narration on its own track. */
export function voiceClip(plan: EditPlan, voice: PlanMusic, total: number): Clip | null {
  const vo = plan.voiceover;
  if (!vo) return null;
  const len = r(Math.min(vo.duration, voice.duration_seconds ? Number(voice.duration_seconds) : vo.duration, total - vo.start));
  if (!(len > 0.1)) return null;
  return { id: "c_voice", mediaId: mediaIdFor(voice.id), kind: "audio", track: "A2", start: r(vo.start), in: 0, duration: len, name: "Narration", props: { volume: vo.volume } };
}
