/*
 * AI camera worker. Run it next to the render worker (needs FFmpeg and the depth model):
 *
 *   npm run fetch-model -w @lvs/ai-motion
 *   npm start -w @lvs/ai-motion
 *
 * It always serves the local depth method; generative providers are added when
 * their API keys are set (see providers/muapi.ts). Keys stay on this machine.
 */
import { hostname } from "node:os";
import { depthModelAvailable } from "./depth.ts";
import { LOCAL_DEPTH_PROVIDER, processGenerationJob } from "./process-job.ts";
import { claimGenerationJob, providersFromEnv, supabaseDeps, supabaseFromEnv } from "./supabase-deps.ts";

const POLL_MS = Number(process.env.AI_POLL_MS ?? 3000);
const workerId = `${hostname()}:${process.pid}:ai`;
let stopping = false;
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });

async function main() {
  const db = supabaseFromEnv();
  const providers = providersFromEnv();
  const served = [...(depthModelAvailable() ? [LOCAL_DEPTH_PROVIDER] : []), ...Object.keys(providers)];
  if (served.length === 0) throw new Error("Nothing to serve: install the depth model (npm run fetch-model) or set a provider key.");
  console.log(`[ai-worker] ${workerId} serving: ${served.join(", ")}`);
  let lastSweep = 0;
  while (!stopping) {
    if (Date.now() - lastSweep > 60_000) { lastSweep = Date.now(); await db.rpc("requeue_stale_generation_jobs", { p_older_than_minutes: 30 }); }
    const job = await claimGenerationJob(db, workerId, served).catch((e) => { console.error(e); return null; });
    if (!job) { await new Promise((r) => setTimeout(r, POLL_MS)); continue; }
    const started = Date.now();
    const r = await processGenerationJob(job, supabaseDeps(db, providers));
    console.log(`[ai-worker] job ${job.id} (${job.provider}) ${r.ok ? "done" : `failed: ${r.error}`} in ${Math.round((Date.now() - started) / 1000)} s`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
