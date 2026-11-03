/*
 * Text-to-speech and speech recognition on this server (no audio leaves it):
 *   TTS — Kokoro-82M v1.0 (Apache-2.0 weights and voices) with its US-English pronunciation
 *         lexicon, run by sherpa-onnx (Apache-2.0). No eSpeak/GPL code is used.
 *   ASR — icefall Zipformer small, LibriSpeech (Apache-2.0), run by sherpa-onnx; it returns
 *         a time for every word, which subtitles and the sync check need.
 * Models: `npm run fetch-models -w @lvs/voice` (or LVS_VOICE_MODELS=<dir>).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sentences, speakable } from "./speakable.ts";

export const TTS_MODEL = { dir: "kokoro-int8-multi-lang-v1_0", name: "Kokoro-82M v1.0 (int8)", license: "Apache-2.0", source: "https://github.com/k2-fsa/sherpa-onnx/releases/tag/tts-models" } as const;
export const ASR_MODEL = { dir: "sherpa-onnx-zipformer-small-en-2023-06-26", name: "Zipformer small (LibriSpeech, int8)", license: "Apache-2.0", source: "https://github.com/k2-fsa/sherpa-onnx/releases/tag/asr-models" } as const;

/** English voices of Kokoro v1.0 (speaker ids from the model's metadata). */
export const VOICES = [
  { id: "af_heart", sid: 3, name: "Heart", accent: "American", gender: "female" },
  { id: "af_bella", sid: 2, name: "Bella", accent: "American", gender: "female" },
  { id: "af_nicole", sid: 6, name: "Nicole", accent: "American", gender: "female" },
  { id: "af_sarah", sid: 9, name: "Sarah", accent: "American", gender: "female" },
  { id: "am_michael", sid: 16, name: "Michael", accent: "American", gender: "male" },
  { id: "am_adam", sid: 11, name: "Adam", accent: "American", gender: "male" },
  { id: "am_eric", sid: 13, name: "Eric", accent: "American", gender: "male" },
  { id: "bf_emma", sid: 21, name: "Emma", accent: "British", gender: "female" },
  { id: "bm_george", sid: 26, name: "George", accent: "British", gender: "male" },
  { id: "bm_lewis", sid: 27, name: "Lewis", accent: "British", gender: "male" },
] as const;
export type VoiceId = (typeof VOICES)[number]["id"];
export const VOICE_IDS = VOICES.map((v) => v.id) as unknown as readonly [VoiceId, ...VoiceId[]];
export const DEFAULT_VOICE: VoiceId = "af_heart";

export function modelsDir(): string {
  if (process.env.LVS_VOICE_MODELS) return process.env.LVS_VOICE_MODELS;
  // next to this package, or (when bundled by the web app) found from the working directory
  const candidates = [
    join(dirname(fileURLToPath(import.meta.url)), "..", "models"),
    join(process.cwd(), "..", "..", "packages", "voice", "models"),
    join(process.cwd(), "packages", "voice", "models"),
  ];
  return candidates.find((c) => existsSync(join(c, TTS_MODEL.dir))) ?? candidates[0]!;
}
export function voiceModelsAvailable(): { tts: boolean; asr: boolean } {
  const d = modelsDir();
  return { tts: existsSync(join(d, TTS_MODEL.dir, "model.int8.onnx")), asr: existsSync(join(d, ASR_MODEL.dir, "encoder-epoch-99-avg-1.int8.onnx")) };
}

interface Sherpa {
  OfflineTts: new (c: unknown) => { sampleRate: number; generate(o: { text: string; sid: number; speed: number }): { samples: Float32Array; sampleRate: number } };
  OfflineRecognizer: new (c: unknown) => { createStream(): { acceptWaveform(w: { samples: Float32Array; sampleRate: number }): void }; decode(s: unknown): void; getResult(s: unknown): { text: string; tokens: string[]; timestamps: number[] } };
}
let sherpa: Sherpa | null = null;
const load = (): Sherpa => (sherpa ??= createRequire(import.meta.url)("sherpa-onnx-node") as Sherpa);

let tts: InstanceType<Sherpa["OfflineTts"]> | null = null;
let asr: InstanceType<Sherpa["OfflineRecognizer"]> | null = null;
let lexicon: Set<string> | null = null;

function ttsEngine() {
  if (tts) return tts;
  const d = join(modelsDir(), TTS_MODEL.dir);
  if (!existsSync(join(d, "model.int8.onnx"))) throw new Error("The voice model isn't installed. Run: npm run fetch-models -w @lvs/voice");
  tts = new (load().OfflineTts)({
    model: { kokoro: { model: join(d, "model.int8.onnx"), voices: join(d, "voices.bin"), tokens: join(d, "tokens.txt"), lexicon: appLexicon(), lang: "en-us" }, numThreads: 4, debug: false },
    maxNumSentences: 1,
  });
  return tts;
}
function asrEngine() {
  if (asr) return asr;
  const d = join(modelsDir(), ASR_MODEL.dir);
  if (!existsSync(join(d, "encoder-epoch-99-avg-1.int8.onnx"))) throw new Error("The transcription model isn't installed. Run: npm run fetch-models -w @lvs/voice");
  asr = new (load().OfflineRecognizer)({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      transducer: { encoder: join(d, "encoder-epoch-99-avg-1.int8.onnx"), decoder: join(d, "decoder-epoch-99-avg-1.int8.onnx"), joiner: join(d, "joiner-epoch-99-avg-1.int8.onnx") },
      tokens: join(d, "tokens.txt"), numThreads: 4, modelType: "transducer", debug: false,
    },
  });
  return asr;
}

/** Words the voice has no pronunciation for (they would be skipped). */
export function unknownWords(text: string): string[] {
  if (!lexicon) {
    const file = appLexicon();
    lexicon = new Set(existsSync(file) ? readFileSync(file, "utf8").split("\n").map((l) => l.slice(0, l.indexOf(" ")).toLowerCase()) : []);
  }
  if (lexicon.size === 0) return [];
  const words = speakable(text).words.flatMap((w) => w.spoken);
  return [...new Set(words.filter((w) => !lexicon!.has(w) && !lexicon!.has(w.replace(/'s$/, ""))))];
}

/**
 * The pronunciation dictionary the voice uses: the US-English lexicon, plus British entries it
 * lacks, plus regular plurals made from a word's own pronunciation ("bedrooms", "countertops").
 * Built once next to the model.
 */
export function appLexicon(): string {
  const d = join(modelsDir(), TTS_MODEL.dir);
  const out = join(d, "lexicon-app.txt");
  if (existsSync(out)) return out;
  const entries = new Map<string, string>();
  const add = (file: string) => {
    if (!existsSync(file)) return;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const i = line.indexOf(" ");
      if (i <= 0) continue;
      const w = line.slice(0, i).toLowerCase();
      if (!entries.has(w)) entries.set(w, line.slice(i + 1).trim());
    }
  };
  add(join(d, "lexicon-us-en.txt"));
  add(join(d, "lexicon-gb-en.txt"));
  const plurals: [string, string][] = [];
  for (const [w, ph] of entries) {
    if (!/^[a-z]+$/.test(w) || w.length < 3 || /(s|x|z|ch|sh|y)$/.test(w)) continue;
    if (entries.has(`${w}s`)) continue;
    const last = ph.split(" ").pop() ?? "";
    const suffix = /^(p|t|k|f|θ)$/.test(last) ? "s" : "z";
    plurals.push([`${w}s`, `${ph} ${suffix}`]);
  }
  for (const [w, ph] of plurals) entries.set(w, ph);
  writeFileSync(out, [...entries].map(([w, ph]) => `${w} ${ph}`).join("\n") + "\n");
  return out;
}

export interface Narration {
  samples: Float32Array;
  sampleRate: number;
  seconds: number;
  /** Each written sentence and where it is in the audio. */
  sentences: { text: string; start: number; end: number }[];
}

/**
 * Speaks the script, one sentence at a time (exact sentence times), with a short pause between.
 * `speed`: 0.7 (slower) … 1.3 (faster).
 */
export function synthesize(script: string, voice: VoiceId = DEFAULT_VOICE, speed = 1, pause = 0.3): Narration {
  const v = VOICES.find((x) => x.id === voice) ?? VOICES[0];
  const engine = ttsEngine();
  const parts: Float32Array[] = [];
  const out: Narration["sentences"] = [];
  let rate = engine.sampleRate, t = 0;
  for (const s of sentences(script)) {
    const said = speakable(s).spoken;
    if (!said.replace(/[.,!?;:\s]/g, "")) continue;
    const a = engine.generate({ text: said, sid: v.sid, speed: Math.min(1.3, Math.max(0.7, speed)) });
    rate = a.sampleRate;
    const trimmed = trimSilence(a.samples, rate);
    parts.push(trimmed);
    out.push({ text: s, start: round(t), end: round(t + trimmed.length / rate) });
    t += trimmed.length / rate;
    const gap = new Float32Array(Math.round(pause * rate));
    parts.push(gap);
    t += gap.length / rate;
  }
  if (parts.length) parts.pop(); // no pause after the last sentence
  const total = parts.reduce((n, p) => n + p.length, 0);
  const samples = new Float32Array(total);
  let o = 0;
  for (const p of parts) { samples.set(p, o); o += p.length; }
  return { samples, sampleRate: rate, seconds: round(total / rate), sentences: out };
}

/** Removes leading / trailing near-silence (keeps 40 ms). */
function trimSilence(s: Float32Array, rate: number): Float32Array {
  const thr = 0.01, keep = Math.round(rate * 0.04);
  let a = 0, b = s.length - 1;
  while (a < s.length && Math.abs(s[a]!) < thr) a++;
  while (b > a && Math.abs(s[b]!) < thr) b--;
  return s.slice(Math.max(0, a - keep), Math.min(s.length, b + keep));
}

export interface TimedWord { word: string; start: number; end: number }

/** Speech → words with times (seconds). Long audio is decoded in 20 s windows split at quiet points. */
export function transcribe(samples: Float32Array, sampleRate: number): TimedWord[] {
  const engine = asrEngine();
  const words: TimedWord[] = [];
  for (const [from, to] of windows(samples, sampleRate, 20)) {
    const stream = engine.createStream();
    stream.acceptWaveform({ samples: samples.subarray(from, to), sampleRate });
    engine.decode(stream);
    const r = engine.getResult(stream);
    const offset = from / sampleRate;
    let cur: TimedWord | null = null;
    r.tokens.forEach((tok, i) => {
      const t = offset + (r.timestamps[i] ?? 0);
      if (tok.startsWith(" ") || tok.startsWith("▁") || !cur) {
        if (cur) words.push(cur);
        cur = { word: tok.replace(/^[ ▁]+/, "").toLowerCase(), start: round(t), end: round(t + 0.12) };
      } else {
        cur.word += tok.toLowerCase();
        cur.end = round(t + 0.12);
      }
    });
    if (cur) words.push(cur);
  }
  // a word ends where the next begins (minus a little), never later than its own last token + 0.3 s
  for (let i = 0; i < words.length - 1; i++) words[i]!.end = round(Math.max(words[i]!.end, Math.min(words[i + 1]!.start - 0.02, words[i]!.end + 0.3)));
  return words.filter((w) => w.word);
}

/** Up-to-`max`-second windows that end in the quietest 50 ms near the limit. */
function windows(s: Float32Array, rate: number, max: number): [number, number][] {
  const out: [number, number][] = [];
  const hop = Math.round(rate * 0.05);
  let from = 0;
  while (from < s.length) {
    let to = Math.min(s.length, from + Math.round(max * rate));
    if (to < s.length) {
      let best = to, bestE = Infinity;
      for (let p = to - Math.round(rate * 4); p < to; p += hop) {
        let e = 0;
        for (let k = p; k < p + hop; k++) e += s[k]! * s[k]!;
        if (e < bestE) { bestE = e; best = p + Math.round(hop / 2); }
      }
      to = best;
    }
    out.push([from, to]);
    from = to;
  }
  return out;
}

/** Mono float samples → 16-bit PCM WAV bytes. */
export function wavBytes(samples: Float32Array, sampleRate: number): Uint8Array {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, 36 + samples.length * 2, true); str(8, "WAVE"); str(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, "data"); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i]!)) * 0x7fff, true);
  return new Uint8Array(buf);
}

/** WAV bytes (mono or stereo, 16-bit) → float samples (first channel). */
export function readWav(bytes: Uint8Array): { samples: Float32Array; sampleRate: number } {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 12, rate = 16000, channels = 1, bits = 16, data: [number, number] | null = null;
  while (o + 8 <= bytes.length) {
    const id = String.fromCharCode(bytes[o]!, bytes[o + 1]!, bytes[o + 2]!, bytes[o + 3]!);
    const len = v.getUint32(o + 4, true);
    if (id === "fmt ") { channels = v.getUint16(o + 10, true); rate = v.getUint32(o + 12, true); bits = v.getUint16(o + 22, true); }
    if (id === "data") { data = [o + 8, Math.min(len, bytes.length - o - 8)]; break; }
    o += 8 + len + (len % 2);
  }
  if (!data || bits !== 16) throw new Error("Unsupported WAV file");
  const frames = Math.floor(data[1] / (2 * channels));
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) out[i] = v.getInt16(data[0] + i * 2 * channels, true) / 0x8000;
  return { samples: out, sampleRate: rate };
}

const round = (n: number) => Math.round(n * 1000) / 1000;
