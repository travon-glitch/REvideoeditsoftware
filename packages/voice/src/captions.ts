/*
 * Captions: written words at spoken times.
 *  - alignWords(): the written script vs. what speech recognition heard → each written word gets
 *    the start/end of the spoken words it became (dynamic-programming alignment, tolerant of
 *    recognition mistakes); written words that weren't heard get times between their neighbours.
 *  - buildCues(): words → caption lines (sentence ends, pauses, commas and length limits).
 */
import { speakable } from "./speakable.ts";
import type { TimedWord } from "./engine.ts";

export interface CaptionWord { text: string; start: number; end: number }
export interface CaptionCue { id: string; start: number; end: number; words: CaptionWord[] }

const norm = (w: string) => w.toLowerCase().replace(/[^a-z0-9']/g, "");

function similar(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length > 3 && b.length > 3 && (a.startsWith(b.slice(0, 4)) || b.startsWith(a.slice(0, 4)))) return true;
  return false;
}

/** Written script + recognised words → written words with times. */
export function alignWords(script: string, heard: TimedWord[], offset = 0): CaptionWord[] {
  const { words } = speakable(script);
  // flatten spoken tokens, remembering their written word
  const spoken: { w: string; owner: number }[] = [];
  words.forEach((x, i) => x.spoken.forEach((s) => spoken.push({ w: norm(s), owner: i })));
  const h = heard.map((x) => norm(x.word));
  const n = spoken.length, m = h.length;
  // edit-distance alignment
  const cost = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
  const back = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1));
  for (let i = 1; i <= n; i++) { cost[i]![0] = i; back[i]![0] = 1; }
  for (let j = 1; j <= m; j++) { cost[0]![j] = j; back[0]![j] = 2; }
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    const sub = cost[i - 1]![j - 1]! + (similar(spoken[i - 1]!.w, h[j - 1]!) ? 0 : 1);
    const del = cost[i - 1]![j]! + 1, ins = cost[i]![j - 1]! + 1;
    if (sub <= del && sub <= ins) { cost[i]![j] = sub; back[i]![j] = 0; }
    else if (del <= ins) { cost[i]![j] = del; back[i]![j] = 1; }
    else { cost[i]![j] = ins; back[i]![j] = 2; }
  }
  const match = new Array<number>(n).fill(-1);
  for (let i = n, j = m; i > 0 || j > 0;) {
    const b = back[i]![j]!;
    if (i > 0 && j > 0 && b === 0) { match[i - 1] = j - 1; i--; j--; } else if (i > 0 && (j === 0 || b === 1)) i--; else j--;
  }
  // written word times from its spoken tokens
  const times: ({ start: number; end: number } | null)[] = words.map(() => null);
  spoken.forEach((s, k) => {
    const j = match[k]!;
    if (j < 0) return;
    const t = times[s.owner];
    const hw = heard[j]!;
    times[s.owner] = t ? { start: Math.min(t.start, hw.start), end: Math.max(t.end, hw.end) } : { start: hw.start, end: hw.end };
  });
  // fill gaps between known neighbours
  const out: CaptionWord[] = [];
  for (let i = 0; i < words.length; i++) {
    let t = times[i];
    if (!t) {
      let a = i - 1; while (a >= 0 && !times[a]) a--;
      let b = i + 1; while (b < words.length && !times[b]) b++;
      const from = a >= 0 ? times[a]!.end : (b < words.length ? Math.max(0, times[b]!.start - 0.3 * (b - i)) : 0);
      const to = b < words.length ? times[b]!.start : from + 0.3 * (i - a);
      const slots = b - a - 1, k = i - a - 1;
      const step = (to - from) / Math.max(1, slots);
      t = { start: from + step * k, end: from + step * (k + 1) };
      times[i] = t;
    }
    out.push({ text: words[i]!.written, start: r3(t.start + offset), end: r3(Math.max(t.end, t.start + 0.05) + offset) });
  }
  return out;
}

/** Words → caption lines. */
export function buildCues(words: CaptionWord[], opts: { maxWords?: number; maxChars?: number; maxSeconds?: number } = {}): CaptionCue[] {
  const maxWords = opts.maxWords ?? 7, maxChars = opts.maxChars ?? 34, maxSeconds = opts.maxSeconds ?? 3.5;
  const cues: CaptionCue[] = [];
  let cur: CaptionWord[] = [];
  const flush = () => {
    if (!cur.length) return;
    cues.push({ id: `cue${cues.length + 1}`, start: cur[0]!.start, end: cur[cur.length - 1]!.end, words: cur });
    cur = [];
  };
  words.forEach((w, i) => {
    const next = words[i + 1];
    if (cur.length) {
      const chars = cur.map((x) => x.text).join(" ").length + 1 + w.text.length;
      if (cur.length >= maxWords || chars > maxChars || w.end - cur[0]!.start > maxSeconds || w.start - cur[cur.length - 1]!.end > 0.6) flush();
    }
    cur.push(w);
    if (/[.!?]$/.test(w.text) || (/[,;:]$/.test(w.text) && cur.length >= 3) || (next && next.start - w.end > 0.6)) flush();
  });
  flush();
  // keep each line up for a moment after its last word, never into the next one
  for (let i = 0; i < cues.length; i++) {
    const nextStart = cues[i + 1]?.start ?? Infinity;
    cues[i]!.end = r3(Math.min(cues[i]!.end + 0.25, nextStart - 0.02));
  }
  return cues;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
