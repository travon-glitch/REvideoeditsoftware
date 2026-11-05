/*
 * Render worker process. Run it on a machine (or container) separate from the
 * web app, with FFmpeg and Chrome installed:
 *
 *   npm start -w @lvs/render-worker
 *
 * It renders one job at a time (FableCut renders one export per sandbox) and
 * returns stuck jobs to the queue, and reports a heartbeat for the System health
 * page. Run more copies for more throughput.
 *
 * On-demand mode (GitHub Actions, see .github/workflows/render-videos.yml): with
 * RENDER_DRAIN_IDLE_SECONDS=90 it renders everything waiting and exits once the
 * queue has been empty that long.
 */
import { hostname } from "node:os";
import { processJob } from "./process-job.ts";
import { claimJob, heartbeat, supabaseDeps, supabaseFromEnv } from "./supabase-deps.ts";

const POLL_MS = Number(process.env.RENDER_POLL_MS ?? 3000);
const workerId = `${hostname()}:${process.pid}`;
let stopping = false;
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });

async function main() {
  const db = supabaseFromEnv();
  const deps = supabaseDeps(db, { chrome: process.env.FABLECUT_CHROME, timeoutMs: Number(process.env.RENDER_TIMEOUT_MS ?? 20 * 60_000) });
  console.log(`[render-worker] ${workerId} started`);
  let lastSweep = 0, lastBeat = 0, done = 0;
  const drainIdleMs = Number(process.env.RENDER_DRAIN_IDLE_SECONDS ?? 0) * 1000;
  let idleSince = Date.now();
  const beat = (job: string | null, error?: string | null) => { lastBeat = Date.now(); return heartbeat(db, { id: workerId, host: hostname(), job, done, error }); };
  await beat(null);
  while (!stopping) {
    if (Date.now() - lastBeat > 30_000) await beat(null);
    if (Date.now() - lastSweep > 60_000) {
      lastSweep = Date.now();
      await db.rpc("requeue_stale_render_jobs", { p_older_than_minutes: 25 });
    }
    const job = await claimJob(db, workerId).catch((e) => { console.error(e); return null; });
    if (!job) {
      if (drainIdleMs > 0 && Date.now() - idleSince > drainIdleMs) { console.log(`[render-worker] queue empty — ${done} video(s) made, exiting`); break; }
      await new Promise((r) => setTimeout(r, POLL_MS));
      continue;
    }
    const started = Date.now();
    console.log(`[render-worker] job ${job.id} (${job.aspect}) started`);
    await beat(job.id);
    const r = await processJob(job, deps);
    done++;
    await beat(null, r.ok ? null : (r.error ?? "Render failed").slice(0, 500));
    console.log(`[render-worker] job ${job.id} ${r.ok ? "done" : `failed: ${r.error}`} in ${Math.round((Date.now() - started) / 1000)} s`);
    idleSince = Date.now();
  }
  console.log("[render-worker] stopped");
}

main().catch((e) => { console.error(e); process.exit(1); });
