/*
 * Original background music for listing videos, composed by code in this repository.
 * Because the company owns this code, the tracks are free of third-party rights and may be
 * used commercially. Deterministic: the same script always produces the same audio.
 *
 *   node tools/music/generate.mjs        → apps/web/assets/music/*.m4a
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SR = 44100;
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "apps", "web", "assets", "music");
const midi = (n) => 440 * 2 ** ((n - 69) / 12);

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

/** Chord tones (midi) from a root and quality. */
const CH = { maj: [0, 4, 7, 11], min: [0, 3, 7, 10], sus: [0, 5, 7, 10], add9: [0, 4, 7, 14] };

function render(track) {
  const beat = 60 / track.bpm;
  const bars = Math.ceil(track.seconds / (beat * 4));
  const n = Math.ceil(bars * 4 * beat * SR) + SR * 2;
  const L = new Float32Array(n), R = new Float32Array(n);
  const rand = rng(track.seed);
  const add = (buf, i, v) => { if (i >= 0 && i < n) buf[i] += v; };

  for (let bar = 0; bar < bars; bar++) {
    const [root, quality] = track.progression[bar % track.progression.length];
    const tones = CH[quality].map((x) => root + x);
    const t0 = bar * 4 * beat;
    // pad: detuned saws, slow swell, soft low-pass
    if (track.pad) {
      for (const [k, tone] of tones.entries()) {
        for (const det of [-0.08, 0.08]) {
          const f = midi(tone + 12 + det);
          let lp = 0, ph = rand();
          const start = Math.floor(t0 * SR), len = Math.floor(4 * beat * SR * 1.15);
          for (let i = 0; i < len; i++) {
            const t = i / SR, env = Math.min(1, t / 0.9) * Math.min(1, (len / SR - t) / 0.6);
            ph += f / SR; const saw = 2 * (ph - Math.floor(ph)) - 1;
            lp += 0.06 * (saw - lp);
            const v = lp * env * track.pad * 0.05;
            add(L, start + i, v * (k % 2 ? 0.7 : 1)); add(R, start + i, v * (k % 2 ? 1 : 0.7));
          }
        }
      }
    }
    // arpeggio pluck / piano-like
    if (track.arp) {
      const steps = track.arpSteps;
      for (let s = 0; s < steps; s++) {
        const tone = tones[(s * track.arpStride) % tones.length] + 24 + (s % 8 >= 4 && track.arpOctave ? 12 : 0);
        const f = midi(tone), start = Math.floor((t0 + (s * 4 * beat) / steps) * SR), len = Math.floor(SR * track.arpDecay * 2);
        const pan = 0.5 + 0.35 * Math.sin(s);
        for (let i = 0; i < len; i++) {
          const t = i / SR, env = Math.exp(-t / track.arpDecay) * Math.min(1, t / 0.004);
          const v = (Math.sin(2 * Math.PI * f * t) + 0.35 * Math.sin(4 * Math.PI * f * t) + 0.12 * Math.sin(6 * Math.PI * f * t)) * env * track.arp * 0.09;
          add(L, start + i, v * (1 - pan) * 1.4); add(R, start + i, v * pan * 1.4);
        }
      }
    }
    // bass
    if (track.bass) {
      for (let q = 0; q < 4; q += track.bassEvery) {
        const f = midi(root - 12 + (q === 2 && track.bassFifth ? 7 : 0)), start = Math.floor((t0 + q * beat) * SR), len = Math.floor(beat * track.bassEvery * SR * 0.95);
        for (let i = 0; i < len; i++) {
          const t = i / SR, env = Math.min(1, t / 0.01) * Math.exp(-t / (beat * 2));
          const v = Math.sin(2 * Math.PI * f * t) * env * track.bass * 0.22;
          add(L, start + i, v); add(R, start + i, v);
        }
      }
    }
    // drums
    if (track.drums) {
      for (let q = 0; q < 4; q++) {
        const kStart = Math.floor((t0 + q * beat) * SR);
        if (q % 2 === 0 || track.fourOnFloor) for (let i = 0; i < SR * 0.35; i++) {
          const t = i / SR, f = 50 + 90 * Math.exp(-t * 30), v = Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 9) * 0.5 * track.drums;
          add(L, kStart + i, v); add(R, kStart + i, v);
        }
        if (q % 2 === 1) for (let i = 0; i < SR * 0.18; i++) {
          const v = (rand() * 2 - 1) * Math.exp(-(i / SR) * 28) * 0.16 * track.drums;
          add(L, kStart + i, v); add(R, kStart + i, v * 0.9);
        }
        for (let h = 0; h < 2; h++) {
          const hs = Math.floor((t0 + (q + h / 2 + 0.5 * 0) * beat) * SR) + (h ? Math.floor(beat * SR / 2) : 0);
          let prev = 0;
          for (let i = 0; i < SR * 0.05; i++) {
            const x = rand() * 2 - 1, hp = x - prev; prev = x;
            const v = hp * Math.exp(-(i / SR) * 90) * 0.05 * track.drums;
            add(L, hs + i, v * 0.8); add(R, hs + i, v);
          }
        }
      }
    }
  }
  // simple stereo echo for space
  const d = Math.floor(beat * 0.75 * SR);
  for (let i = d; i < n; i++) { L[i] += R[i - d] * 0.22; R[i] += L[i - d] * 0.22; }
  // fade in/out, normalise
  const total = Math.floor(track.seconds * SR);
  let peak = 0;
  for (let i = 0; i < total; i++) {
    const g = Math.min(1, i / (SR * 1.5)) * Math.min(1, (total - i) / (SR * 3));
    L[i] = Math.tanh(L[i] * 1.2) * g; R[i] = Math.tanh(R[i] * 1.2) * g;
    peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  }
  const pcm = Buffer.alloc(total * 4);
  for (let i = 0; i < total; i++) {
    pcm.writeInt16LE(Math.round((L[i] / peak) * 0.85 * 32767), i * 4);
    pcm.writeInt16LE(Math.round((R[i] / peak) * 0.85 * 32767), i * 4 + 2);
  }
  return pcm;
}

export const TRACKS = [
  { key: "elegant-evening", title: "Elegant Evening", mood: "elegant", bpm: 72, seconds: 75, seed: 11,
    progression: [[57, "min"], [53, "maj"], [48, "maj"], [55, "sus"]], pad: 1, arp: 1, arpSteps: 8, arpStride: 1, arpDecay: 0.9, arpOctave: true, bass: 0.7, bassEvery: 2, drums: 0 },
  { key: "bright-open-house", title: "Bright Open House", mood: "upbeat", bpm: 116, seconds: 75, seed: 23,
    progression: [[48, "maj"], [55, "maj"], [57, "min"], [53, "maj"]], pad: 0.5, arp: 1, arpSteps: 8, arpStride: 2, arpDecay: 0.18, arpOctave: false, bass: 1, bassEvery: 1, bassFifth: true, drums: 1, fourOnFloor: true },
  { key: "calm-morning", title: "Calm Morning", mood: "calm", bpm: 80, seconds: 75, seed: 37,
    progression: [[50, "add9"], [55, "maj"], [47, "min"], [52, "sus"]], pad: 1.2, arp: 0.6, arpSteps: 4, arpStride: 1, arpDecay: 1.4, arpOctave: true, bass: 0.5, bassEvery: 4, drums: 0 },
  { key: "warm-welcome", title: "Warm Welcome", mood: "warm", bpm: 96, seconds: 75, seed: 41,
    progression: [[53, "maj"], [57, "min"], [50, "min"], [48, "maj"]], pad: 0.7, arp: 0.9, arpSteps: 8, arpStride: 1, arpDecay: 0.45, arpOctave: false, bass: 0.8, bassEvery: 2, bassFifth: true, drums: 0.55 },
  { key: "inspiring-skyline", title: "Inspiring Skyline", mood: "inspiring", bpm: 104, seconds: 75, seed: 53,
    progression: [[45, "min"], [53, "maj"], [48, "maj"], [55, "maj"]], pad: 0.9, arp: 1, arpSteps: 16, arpStride: 1, arpDecay: 0.22, arpOctave: true, bass: 0.9, bassEvery: 1, bassFifth: false, drums: 0.8, fourOnFloor: false },
];

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  mkdirSync(OUT, { recursive: true });
  for (const t of TRACKS) {
    const raw = join(OUT, `${t.key}.pcm`);
    writeFileSync(raw, render(t));
    const out = join(OUT, `${t.key}.m4a`);
    const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "s16le", "-ar", String(SR), "-ac", "2", "-i", raw, "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart",
      "-metadata", `title=${t.title}`, "-metadata", "comment=Original music generated by this app; owned by the company", out], { encoding: "utf8" });
    rmSync(raw);
    if (r.status !== 0) throw new Error(r.stderr);
    console.log(`${out}`);
  }
}
