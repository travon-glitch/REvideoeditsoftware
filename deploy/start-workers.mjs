#!/usr/bin/env node
/*
 * Starts everything that can't run on Vercel, in one container, and restarts any part that stops:
 *   • render worker(s)  — makes the MP4s (Chrome + FFmpeg)            RENDER_WORKERS (default 1)
 *   • AI worker         — AI depth camera moves, generative clips     AI_WORKER=0 to switch off
 *   • voice service     — AI narration and captions over HTTPS        runs when LVS_VOICE_SERVICE_SECRET is set
 * Logs from each part are prefixed. SIGTERM stops everything cleanly.
 */
import { spawn } from "node:child_process";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const required = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) { console.error(`[start] Missing settings: ${missing.join(", ")}`); process.exit(1); }

const parts = [];
for (let i = 0; i < Math.max(1, Number(process.env.RENDER_WORKERS ?? 1)); i++) parts.push({ name: `render-${i + 1}`, file: "packages/render-worker/src/worker.ts" });
if (process.env.AI_WORKER !== "0") parts.push({ name: "ai", file: "packages/ai-motion/src/worker.ts" });
if (process.env.LVS_VOICE_SERVICE_SECRET) parts.push({ name: "voice", file: "packages/voice/src/server.ts" });
else console.log("[start] LVS_VOICE_SERVICE_SECRET isn't set: the voice service (narration and captions for Vercel) won't start.");

let stopping = false;
const children = new Set();
function run(part, delay = 1000) {
  const child = spawn(process.execPath, [join(root, part.file)], { cwd: root, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
  children.add(child);
  const prefix = (stream, out) => stream.on("data", (d) => { for (const line of String(d).split("\n")) if (line) out.write(`[${part.name}] ${line}\n`); });
  prefix(child.stdout, process.stdout); prefix(child.stderr, process.stderr);
  const started = Date.now();
  child.on("exit", (code) => {
    children.delete(child);
    if (stopping) return;
    // back off when a part keeps failing right away (bad settings), up to a minute
    const next = Date.now() - started > 60_000 ? 1000 : Math.min(delay * 2, 60_000);
    console.error(`[start] ${part.name} stopped (code ${code}); restarting in ${Math.round(next / 1000)} s`);
    setTimeout(() => run(part, next), next);
  });
}
parts.forEach((p) => run(p));
console.log(`[start] running: ${parts.map((p) => p.name).join(", ")}`);
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => {
  stopping = true;
  for (const c of children) c.kill("SIGTERM");
  setTimeout(() => process.exit(0), 10_000).unref();
  if (!children.size) process.exit(0);
  let left = children.size;
  for (const c of children) c.on("exit", () => { if (--left === 0) process.exit(0); });
});
