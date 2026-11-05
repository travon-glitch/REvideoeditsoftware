/*
 * Voice service: AI narration and automatic captions over HTTPS, for a web app that can't hold the
 * voice models itself (Vercel). Runs next to the render and AI workers (deploy/worker.Dockerfile).
 *
 *   LVS_VOICE_SERVICE_SECRET=<at least 32 random characters> PORT=8790 npm run serve -w @lvs/voice
 *
 * Every request needs "Authorization: Bearer <secret>" (the same secret is set on the web app).
 * Requests are handled one at a time (speech is CPU-heavy). Nothing is stored: audio comes in,
 * audio or word timings go out. Put it behind HTTPS (your host's TLS) — never plain HTTP on the internet.
 *
 *   GET  /ping                     → { ok }  (no secret needed; for health checks)
 *   GET  /health                   → { ok, tts, asr }
 *   POST /speak   {script, voice, speed, withTiming} → { audio (base64 m4a), seconds, sentences, heard, unknownWords }
 *   POST /preview {script, voice, speed}             → audio/wav (X-Seconds header)
 *   POST /listen?format=mp3|mov|wav|aac  <audio bytes> → { words }
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { LISTEN_FORMATS, engineStatus, isVoiceId, listenTo, previewWav, speakToM4a, type ListenFormat } from "./service.ts";
import type { VoiceId } from "./engine.ts";

const SECRET = process.env.LVS_VOICE_SERVICE_SECRET ?? "";
const PORT = Number(process.env.PORT ?? process.env.LVS_VOICE_PORT ?? 8790);
const MAX_JSON = 64 * 1024;
const MAX_AUDIO = 30 * 1024 * 1024;

if (SECRET.length < 32) {
  console.error("[voice-service] Set LVS_VOICE_SERVICE_SECRET to at least 32 random characters (the same value on the web app).");
  process.exit(1);
}

function authorized(req: IncomingMessage): boolean {
  const got = Buffer.from((req.headers.authorization ?? "").replace(/^Bearer\s+/i, ""));
  const want = Buffer.from(SECRET);
  return got.length === want.length && timingSafeEqual(got, want);
}

function body(req: IncomingMessage, max: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > max) { reject(new Error("too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(value));
}

// one job at a time: speech synthesis and recognition use every core
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

function speechInput(raw: Buffer): { script: string; voice: VoiceId; speed: number; withTiming: boolean } | null {
  try {
    const j = JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
    const script = typeof j.script === "string" ? j.script.trim().slice(0, 4000) : "";
    const speed = Number(j.speed ?? 1);
    if (!isVoiceId(j.voice) || !(speed >= 0.7 && speed <= 1.3)) return null;
    return { script, voice: j.voice, speed, withTiming: j.withTiming !== false };
  } catch { return null; }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://voice");
  try {
    // for the hosting platform's health check: says only that the process is up
    if (req.method === "GET" && url.pathname === "/ping") return json(res, 200, { ok: true });
    if (!authorized(req)) return json(res, 401, { error: "unauthorized" });
    if (req.method === "GET" && url.pathname === "/health") return json(res, 200, { ok: true, ...engineStatus() });
    if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });

    if (url.pathname === "/speak" || url.pathname === "/preview") {
      const input = speechInput(await body(req, MAX_JSON));
      if (!input) return json(res, 400, { error: "Check the script, voice and speed." });
      if (!engineStatus().tts) return json(res, 503, { error: "The voice model isn't installed on the voice service." });
      if (url.pathname === "/preview") {
        const p = await serial(async () => previewWav(input.script, input.voice, input.speed));
        res.writeHead(200, { "Content-Type": "audio/wav", "X-Seconds": String(p.seconds), "Cache-Control": "no-store" });
        return res.end(Buffer.from(p.wav));
      }
      if (!input.script) return json(res, 400, { error: "Write the narration first." });
      const n = await serial(() => speakToM4a(input.script, input.voice, input.speed, input.withTiming));
      return json(res, 200, { ...n, audio: Buffer.from(n.audio).toString("base64") });
    }

    if (url.pathname === "/listen") {
      const format = url.searchParams.get("format") as ListenFormat;
      if (!LISTEN_FORMATS.includes(format)) return json(res, 400, { error: "Unsupported audio format" });
      if (!engineStatus().asr) return json(res, 503, { error: "The speech recognition model isn't installed on the voice service." });
      const audio = await body(req, MAX_AUDIO);
      const words = await serial(() => listenTo(new Uint8Array(audio), format));
      return json(res, 200, { words });
    }
    return json(res, 404, { error: "not found" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "failed";
    if (msg === "too large") return json(res, 413, { error: "too large" });
    console.error(JSON.stringify({ event: "lvs.voice_error", path: url.pathname, error: msg.slice(0, 300) }));
    if (!res.headersSent) json(res, 500, { error: "The voice service couldn't finish." });
  }
});
server.requestTimeout = 10 * 60_000;
server.listen(PORT, () => console.log(`[voice-service] listening on ${PORT} · models: ${JSON.stringify(engineStatus())}`));
for (const sig of ["SIGTERM", "SIGINT"] as const) process.on(sig, () => server.close(() => process.exit(0)));
