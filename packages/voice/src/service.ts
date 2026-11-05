/*
 * What the app asks of the voice engine, in one place, so it can run either inside the web server
 * (a normal Node server with the models installed) or on a separate voice service (when the web
 * app is hosted on Vercel, which can't hold the models). See server.ts.
 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_VOICE, VOICES, readWav, synthesize, transcribe, unknownWords, voiceModelsAvailable, wavBytes, type TimedWord, type VoiceId } from "./engine.ts";

export interface SpokenNarration {
  /** The narration as AAC in an MP4 container (.m4a). */
  audio: Uint8Array;
  seconds: number;
  sentences: { text: string; start: number; end: number }[];
  /** Every word as heard by speech recognition (null when it wasn't asked for or isn't installed). */
  heard: TimedWord[] | null;
  unknownWords: string[];
}

/** FFmpeg demuxers the service accepts for audio sent to listen() (the caller checked the file's content). */
export const LISTEN_FORMATS = ["mp3", "mov", "wav", "aac"] as const;
export type ListenFormat = (typeof LISTEN_FORMATS)[number];

export const isVoiceId = (v: unknown): v is VoiceId => typeof v === "string" && VOICES.some((x) => x.id === v);

function ffmpeg(args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const p = spawn(process.env.FFMPEG_PATH ?? "ffmpeg", ["-v", "error", "-y", ...args], { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [], err: Buffer[] = [];
    p.stdout.on("data", (d: Buffer) => out.push(d));
    p.stderr.on("data", (d: Buffer) => err.push(d));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(Buffer.concat(err).toString().slice(0, 300) || `ffmpeg exited ${code}`))));
  });
}

/** Speaks the script; with `withTiming`, also listens to the result so every word gets its time. */
export async function speakToM4a(script: string, voice: VoiceId = DEFAULT_VOICE, speed = 1, withTiming = true): Promise<SpokenNarration> {
  const n = synthesize(script, voice, speed);
  if (n.samples.length === 0) return { audio: new Uint8Array(), seconds: 0, sentences: [], heard: null, unknownWords: unknownWords(script) };
  const dir = await mkdtemp(join(tmpdir(), "lvs-voice-"));
  try {
    await writeFile(join(dir, "in.wav"), wavBytes(n.samples, n.sampleRate));
    await ffmpeg(["-protocol_whitelist", "file", "-f", "wav", "-i", join(dir, "in.wav"), "-c:a", "aac", "-b:a", "128k", "-ac", "1", "-ar", "48000", "-movflags", "+faststart", join(dir, "out.m4a")]);
    const audio = new Uint8Array(await readFile(join(dir, "out.m4a")));
    const heard = withTiming && voiceModelsAvailable().asr ? transcribe(n.samples, n.sampleRate) : null;
    return { audio, seconds: n.seconds, sentences: n.sentences.map((s) => ({ text: s.text, start: s.start, end: s.end })), heard, unknownWords: unknownWords(script) };
  } finally { await rm(dir, { recursive: true, force: true }); }
}

/** Speech recognition of an audio file whose format the caller already checked from its content. */
export async function listenTo(bytes: Uint8Array, format: ListenFormat): Promise<TimedWord[]> {
  if (!LISTEN_FORMATS.includes(format)) throw new Error("Unsupported audio format");
  const dir = await mkdtemp(join(tmpdir(), "lvs-asr-"));
  try {
    await writeFile(join(dir, "in"), bytes);
    // never let FFmpeg guess the format or open anything but this local file
    const wav = await ffmpeg(["-protocol_whitelist", "file,pipe", "-f", format, "-i", join(dir, "in"), "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-f", "wav", "pipe:1"]);
    const { samples, sampleRate } = readWav(new Uint8Array(wav));
    return transcribe(samples, sampleRate);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

/** A short spoken sample (WAV) of the first sentences; nothing is stored. */
export function previewWav(script: string, voice: VoiceId, speed: number): { wav: Uint8Array; seconds: number } {
  const sample = script.split(/(?<=[.!?])\s+/).slice(0, 2).join(" ").slice(0, 240);
  const n = synthesize(sample || "This is how your narration will sound.", voice, speed);
  return { wav: wavBytes(n.samples, n.sampleRate), seconds: n.seconds };
}

export function engineStatus(): { tts: boolean; asr: boolean } {
  return voiceModelsAvailable();
}
