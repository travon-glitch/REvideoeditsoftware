/*
 * The voice service (used when the web app runs on Vercel): start the real service, then make
 * narration, captions and a preview through the web app's own client — exactly as production does.
 * Skipped when the voice models aren't installed on this machine.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { alignWords, voiceModelsAvailable } from "@lvs/voice";

const ready = voiceModelsAvailable();
const PORT = 18790 + Math.floor(Math.random() * 1000);
const SECRET = randomBytes(24).toString("hex");
let proc: ChildProcess | null = null;

describe.skipIf(!ready.tts || !ready.asr)("voice service", () => {
  beforeAll(async () => {
    proc = spawn(process.execPath, [join(__dirname, "../../../../../packages/voice/src/server.ts")], {
      env: { ...process.env, LVS_VOICE_SERVICE_SECRET: SECRET, PORT: String(PORT) }, stdio: "ignore",
    });
    for (let i = 0; i < 60; i++) {
      try { if ((await fetch(`http://127.0.0.1:${PORT}/health`)).status === 401) break; } catch { /* starting */ }
      await new Promise((r) => setTimeout(r, 250));
    }
    process.env.LVS_VOICE_SERVICE_URL = `http://127.0.0.1:${PORT}`;
    process.env.LVS_VOICE_SERVICE_SECRET = SECRET;
  }, 30_000);
  afterAll(() => { proc?.kill(); delete process.env.LVS_VOICE_SERVICE_URL; delete process.env.LVS_VOICE_SERVICE_SECRET; });

  it("the web app uses the service when it's configured, and it reports both models", async () => {
    const { voiceEngine } = await import("@/lib/video/voice-engine");
    const e = voiceEngine();
    expect(e.where).toBe("service");
    expect(await e.status()).toEqual({ tts: true, asr: true });
  });

  it("narration comes back as M4A with a time for every word; captions can be timed from it", async () => {
    const { voiceEngine } = await import("@/lib/video/voice-engine");
    const script = "Welcome to 742 Evergreen Terrace. It has four bedrooms.";
    const n = await voiceEngine().speak(script, "af_heart", 1, true);
    expect(Buffer.from(n.audio.subarray(4, 8)).toString()).toBe("ftyp");
    expect(n.seconds).toBeGreaterThan(2);
    expect(n.sentences).toHaveLength(2);
    const words = alignWords(script, n.heard!);
    expect(words.map((w) => w.text)).toEqual(script.split(/\s+/));
    expect(words.every((w, i) => i === 0 || w.start >= words[i - 1]!.start)).toBe(true);
    // and the service can listen to that same file (recorded-narration captions)
    const heard = await voiceEngine().listen(n.audio, "mov");
    expect(heard.map((w) => w.word).join(" ")).toMatch(/welcome to seven forty two evergreen terrace/);
  }, 120_000);

  it("previews a voice, and refuses a wrong secret", async () => {
    const { voiceEngine, VoiceServiceError } = await import("@/lib/video/voice-engine");
    const p = await voiceEngine().preview("Hello there.", "bm_george", 1.1);
    expect(Buffer.from(p.wav.subarray(0, 4)).toString()).toBe("RIFF");
    process.env.LVS_VOICE_SERVICE_SECRET = "x".repeat(48);
    await expect(voiceEngine().preview("Hi.", "af_heart", 1)).rejects.toBeInstanceOf(VoiceServiceError);
    expect(await voiceEngine().status()).toEqual({ tts: false, asr: false });
    process.env.LVS_VOICE_SERVICE_SECRET = SECRET;
  }, 60_000);

  it("without the service settings it uses the models on this server", async () => {
    const { voiceEngine } = await import("@/lib/video/voice-engine");
    const url = process.env.LVS_VOICE_SERVICE_URL;
    delete process.env.LVS_VOICE_SERVICE_URL;
    expect(voiceEngine().where).toBe("local");
    process.env.LVS_VOICE_SERVICE_URL = url;
  });
});
