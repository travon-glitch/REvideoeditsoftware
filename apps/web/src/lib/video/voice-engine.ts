import "server-only";
/*
 * Where narration and captions are made:
 *   • LVS_VOICE_SERVICE_URL set  → the voice service (packages/voice/src/server.ts), used when the web app
 *     runs on Vercel, which can't hold the voice models;
 *   • otherwise                  → right here, when the models are installed on this server.
 * Both give exactly the same results (same code, packages/voice/src/service.ts).
 */
import type { TimedWord, VoiceId } from "@lvs/voice";
import type { ListenFormat, SpokenNarration } from "@lvs/voice/service";

export interface VoiceEngine {
  where: "service" | "local";
  status(): Promise<{ tts: boolean; asr: boolean }>;
  speak(script: string, voice: VoiceId, speed: number, withTiming: boolean): Promise<SpokenNarration>;
  listen(audio: Uint8Array, format: ListenFormat): Promise<TimedWord[]>;
  preview(script: string, voice: VoiceId, speed: number): Promise<{ wav: Uint8Array; seconds: number }>;
}

export class VoiceServiceError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

function remote(base: string, secret: string): VoiceEngine {
  const url = base.replace(/\/+$/, "");
  const call = async (path: string, init: RequestInit & { timeoutMs: number }) => {
    const res = await fetch(`${url}${path}`, {
      ...init, cache: "no-store", signal: AbortSignal.timeout(init.timeoutMs),
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${secret}` },
    });
    if (!res.ok) {
      const msg = ((await res.json().catch(() => ({}))) as { error?: string }).error ?? `voice service answered ${res.status}`;
      throw new VoiceServiceError(msg, res.status);
    }
    return res;
  };
  return {
    where: "service",
    async status() {
      try {
        const j = (await (await call("/health", { method: "GET", timeoutMs: 8000 })).json()) as { tts?: boolean; asr?: boolean };
        return { tts: !!j.tts, asr: !!j.asr };
      } catch { return { tts: false, asr: false }; }
    },
    async speak(script, voice, speed, withTiming) {
      const j = (await (await call("/speak", { method: "POST", timeoutMs: 280_000, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ script, voice, speed, withTiming }) })).json()) as
        Omit<SpokenNarration, "audio"> & { audio: string };
      return { ...j, audio: new Uint8Array(Buffer.from(j.audio, "base64")) };
    },
    async listen(audio, format) {
      const j = (await (await call(`/listen?format=${format}`, { method: "POST", timeoutMs: 280_000, headers: { "Content-Type": "application/octet-stream" }, body: Buffer.from(audio) })).json()) as { words: TimedWord[] };
      return j.words;
    },
    async preview(script, voice, speed) {
      const res = await call("/preview", { method: "POST", timeoutMs: 60_000, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ script, voice, speed }) });
      return { wav: new Uint8Array(await res.arrayBuffer()), seconds: Number(res.headers.get("X-Seconds") ?? 0) };
    },
  };
}

function local(): VoiceEngine {
  // loaded only when used, so a web app that relies on the voice service never loads the native engine
  const svc = () => import("@lvs/voice/service");
  return {
    where: "local",
    async status() { return (await svc()).engineStatus(); },
    async speak(script, voice, speed, withTiming) { return (await svc()).speakToM4a(script, voice, speed, withTiming); },
    async listen(audio, format) { return (await svc()).listenTo(audio, format); },
    async preview(script, voice, speed) { return (await svc()).previewWav(script, voice, speed); },
  };
}

export function voiceEngine(): VoiceEngine {
  const url = process.env.LVS_VOICE_SERVICE_URL?.trim();
  const secret = process.env.LVS_VOICE_SERVICE_SECRET?.trim() ?? "";
  if (url && /^https?:\/\//.test(url) && secret.length >= 32) return remote(url, secret);
  return local();
}

/** For messages: how to install voice, depending on where it runs. */
export function voiceSetupHint(): string {
  return process.env.LVS_VOICE_SERVICE_URL
    ? "The voice service isn't answering. Ask an administrator to check it (Admin → System health)."
    : "The voice engine isn't installed on this server yet. Ask an administrator to set up the voice service (docs/VERCEL.md) or run: npm run fetch-models -w @lvs/voice";
}
