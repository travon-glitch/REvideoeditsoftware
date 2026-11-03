import "server-only";
/*
 * System health, checked live when the page opens: the database (a real query
 * and its time), the queues and worker heartbeats (from the database), each
 * storage bucket (a real listing of the company's folder), and every AI provider
 * integration. Nothing here changes data.
 */
import { spawnSync } from "node:child_process";
import { voiceModelsAvailable } from "@lvs/voice";
import type { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { secretsConfigured } from "@/lib/secrets";
import { BUCKETS } from "@/lib/storage";
import { queueLevel, workerLevel, type HealthLevel } from "@/lib/admin/control";

type Db = Awaited<ReturnType<typeof createClient>>;

export interface Check { name: string; level: HealthLevel; detail: string }
export interface WorkerInfo { id: string; kind: "render" | "ai"; host: string | null; providers: string[]; seconds_since_seen: number; busy: boolean; jobs_done: number; last_error: string | null; started_at: string; level: HealthLevel }
export interface Queue { queued: number; running: number; failed_24h: number; succeeded_24h: number; stuck: number; oldest_queued_seconds: number }
export interface HealthReport {
  checkedAt: string;
  database: Check;
  render: Queue & { level: HealthLevel; workersOnline: number };
  ai: Queue & { level: HealthLevel; workersOnline: number };
  workers: WorkerInfo[];
  storage: Check[];
  providers: Check[];
  failures: { kind: string; id: string; at: string | null; error: string | null; provider?: string; project_id?: string }[];
}

let ffmpegCache: boolean | null = null;
function ffmpegAvailable(): boolean {
  if (ffmpegCache === null) {
    try { ffmpegCache = spawnSync(process.env.FFMPEG_PATH ?? "ffmpeg", ["-version"], { timeout: 5000 }).status === 0; } catch { ffmpegCache = false; }
  }
  return ffmpegCache;
}

const emptyQueue: Queue = { queued: 0, running: 0, failed_24h: 0, succeeded_24h: 0, stuck: 0, oldest_queued_seconds: 0 };

export async function systemHealth(db: Db, org: string, isSuperAdmin: boolean): Promise<HealthReport> {
  const t0 = performance.now();
  const { data, error } = await db.rpc("admin_system_health");
  const ms = Math.round(performance.now() - t0);
  const h = (data ?? {}) as { render?: Queue; ai?: Queue; workers?: Omit<WorkerInfo, "level">[]; recent_failures?: HealthReport["failures"] };
  const database: Check = error
    ? { name: "Database", level: "down", detail: "The database didn't answer." }
    : { name: "Database", level: ms > 1500 ? "warn" : "ok", detail: `Connected · answered in ${ms} ms` };

  const workers: WorkerInfo[] = (h.workers ?? []).map((w) => ({ ...w, level: workerLevel(w.seconds_since_seen) }));
  const online = (kind: "render" | "ai") => workers.filter((w) => w.kind === kind && w.level === "ok").length;
  const render = { ...emptyQueue, ...h.render };
  const ai = { ...emptyQueue, ...h.ai };

  // storage: list one file in the company's folder of every bucket
  const storage: Check[] = [];
  let admin: ReturnType<typeof createAdminClient> | null = null;
  try { admin = createAdminClient(); } catch { /* reported below */ }
  for (const bucket of Object.values(BUCKETS)) {
    if (!admin) { storage.push({ name: bucket, level: "down", detail: "The server's storage key isn't set." }); continue; }
    const s0 = performance.now();
    const { error: e } = await admin.storage.from(bucket).list(org, { limit: 1 });
    const sms = Math.round(performance.now() - s0);
    storage.push(e ? { name: bucket, level: "down", detail: `Not reachable: ${e.message.slice(0, 120)}` } : { name: bucket, level: sms > 3000 ? "warn" : "ok", detail: `Reachable · ${sms} ms` });
  }

  // provider integrations
  const [{ data: claudeKey }, { data: features }, keys] = await Promise.all([
    db.rpc("claude_key_status"),
    db.rpc("my_ai_features"),
    isSuperAdmin ? db.rpc("provider_key_status") : Promise.resolve({ data: null }),
  ]);
  const f = (features ?? {}) as { generative?: boolean; depth?: boolean; voiceover?: boolean; captions?: boolean; director?: boolean; video_key_saved?: boolean; video_model?: string };
  const ck = (claudeKey ?? {}) as { configured?: boolean; last4?: string };
  const served = new Set(workers.filter((w) => w.kind === "ai" && w.level !== "down").flatMap((w) => w.providers));
  const failed = (p: string) => (h.recent_failures ?? []).filter((x) => x.provider === p && x.at && Date.now() - Date.parse(x.at) < 24 * 3600_000).length;
  const voice = voiceModelsAvailable();
  const providers: Check[] = [
    {
      name: "Claude (AI Director)",
      level: !f.director ? "off" : ck.configured || process.env.ANTHROPIC_API_KEY ? "ok" : "down",
      detail: !f.director ? "Switched off" : ck.configured ? `Key saved (ends in ${ck.last4})` : process.env.ANTHROPIC_API_KEY ? "Key set on the server" : "Switched on, but no key is saved",
    },
    {
      name: "MuAPI (generative AI video)",
      level: !f.generative ? "off" : !(f.video_key_saved || process.env.LVS_GENERATIVE_PROVIDER) ? "down" : !served.has("muapi") ? "warn" : failed("muapi") ? "warn" : "ok",
      detail: !f.generative ? "Switched off"
        : !(f.video_key_saved || process.env.LVS_GENERATIVE_PROVIDER) ? "Switched on, but no key is saved"
        : !served.has("muapi") ? "Key saved, but no AI worker is serving it (the worker needs LVS_SECRETS_KEY)"
        : `Connected · model ${f.video_model}${failed("muapi") ? ` · ${failed("muapi")} failed in 24 h` : ""}`,
    },
    {
      name: "AI depth camera moves (this server)",
      level: !f.depth ? "off" : served.has("local-depth") ? (failed("local-depth") ? "warn" : "ok") : "down",
      detail: !f.depth ? "Switched off" : served.has("local-depth") ? `An AI worker serves it${failed("local-depth") ? ` · ${failed("local-depth")} failed in 24 h` : ""}` : "No AI worker with the depth model is running",
    },
    {
      name: "AI narration (this server)",
      level: !f.voiceover ? "off" : voice.tts && ffmpegAvailable() ? "ok" : "down",
      detail: !f.voiceover ? "Switched off" : !voice.tts ? "Voice model not installed (npm run fetch-models -w @lvs/voice)" : !ffmpegAvailable() ? "FFmpeg is missing on the web server" : "Voice model installed",
    },
    {
      name: "Automatic captions (this server)",
      level: !f.captions ? "off" : voice.asr ? "ok" : "down",
      detail: !f.captions ? "Switched off" : voice.asr ? "Speech recognition model installed" : "Speech recognition model not installed",
    },
    {
      name: "Secret storage",
      level: secretsConfigured() ? "ok" : (keys as { data: unknown }).data && Object.keys((keys as { data: Record<string, unknown> }).data).length ? "down" : "warn",
      detail: secretsConfigured() ? "Provider keys can be saved and read (AES-256-GCM)" : "LVS_SECRETS_KEY isn't set — keys can't be saved or used",
    },
  ];

  return {
    checkedAt: new Date().toISOString(),
    database,
    render: { ...render, level: queueLevel(render, online("render")), workersOnline: online("render") },
    ai: { ...ai, level: queueLevel(ai, online("ai")), workersOnline: online("ai") },
    workers, storage, providers,
    failures: h.recent_failures ?? [],
  };
}
