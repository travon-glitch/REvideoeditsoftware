/*
 * AI camera worker. Run it next to the render worker (needs FFmpeg and the depth model):
 *
 *   npm run fetch-model -w @lvs/ai-motion
 *   npm start -w @lvs/ai-motion
 *
 * It always serves the local depth method. Generative providers are served when
 * a company saved its provider key in the admin panel (this worker needs the same
 * LVS_SECRETS_KEY as the web server to read it) or a key is set here
 * (see providers/muapi.ts). It reports a heartbeat for the System health page.
 */
import { hostname } from "node:os";
import { depthModelAvailable } from "./depth.ts";
import { LOCAL_DEPTH_PROVIDER, processGenerationJob } from "./process-job.ts";
import { claimGenerationJob, heartbeat, providersForJob, providersFromEnv, servableProviders, supabaseDeps, supabaseFromEnv } from "./supabase-deps.ts";

const POLL_MS = Number(process.env.AI_POLL_MS ?? 3000);
const workerId = `${hostname()}:${process.pid}:ai`;
let stopping = false;
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });

async function main() {
  const db = supabaseFromEnv();
  const providers = providersFromEnv();
  const served = [...(depthModelAvailable() ? [LOCAL_DEPTH_PROVIDER] : []), ...servableProviders()];
  if (served.length === 0) throw new Error("Nothing to serve: install the depth model (npm run fetch-model) or set a provider key.");
  console.log(`[ai-worker] ${workerId} serving: ${served.join(", ")}`);
  let lastSweep = 0, lastBeat = 0, done = 0;
  // on-demand mode (GitHub Actions): exit once the queue has been empty this long
  const drainIdleMs = Number(process.env.AI_DRAIN_IDLE_SECONDS ?? 0) * 1000;
  let idleSince = Date.now();
  const beat = (job: string | null, error?: string | null) => { lastBeat = Date.now(); return heartbeat(db, { id: workerId, host: hostname(), providers: served, job, done, error }); };
  await beat(null);
  while (!stopping) {
    if (Date.now() - lastSweep > 60_000) { lastSweep = Date.now(); await db.rpc("requeue_stale_generation_jobs", { p_older_than_minutes: 30 }); }
    if (Date.now() - lastBeat > 30_000) await beat(null);
    const job = await claimGenerationJob(db, workerId, served).catch((e) => { console.error(e); return null; });
    if (!job) {
      if (drainIdleMs > 0 && Date.now() - idleSince > drainIdleMs) { console.log(`[ai-worker] queue empty — ${done} clip(s) made, exiting`); break; }
      await new Promise((r) => setTimeout(r, POLL_MS));
      continue;
    }
    const started = Date.now();
    await beat(job.id);
    const r = await processGenerationJob(job, supabaseDeps(db, await providersForJob(db, job, providers)));
    done++;
    idleSince = Date.now();
    await beat(null, r.ok ? null : `${job.provider}: ${r.error}`.slice(0, 500));
    console.log(`[ai-worker] job ${job.id} (${job.provider}) ${r.ok ? "done" : `failed: ${r.error}`} in ${Math.round((Date.now() - started) / 1000)} s`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
