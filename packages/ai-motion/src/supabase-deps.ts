/* Production dependencies for the AI worker: Supabase (service role, server-side only). */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { GenerationDeps, GenerationJob } from "./process-job.ts";
import type { GenerativeProvider } from "./providers/types.ts";
import { MuapiProvider } from "./providers/muapi.ts";
import { canReadSavedKeys, decryptSecret } from "./secrets.ts";

export function supabaseFromEnv(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for the AI worker.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Generative providers enabled by environment variables on this worker. */
export function providersFromEnv(env = process.env): Record<string, GenerativeProvider> {
  const out: Record<string, GenerativeProvider> = {};
  if (env.MUAPI_API_KEY) out.muapi = new MuapiProvider({ apiKey: env.MUAPI_API_KEY, model: env.MUAPI_I2V_MODEL, baseUrl: env.MUAPI_BASE_URL });
  return out;
}

/** Providers this worker can serve: keys set here, plus company keys saved in the admin panel (when it can decrypt them). */
export function servableProviders(env = process.env): string[] {
  return [...new Set([...Object.keys(providersFromEnv(env)), ...(canReadSavedKeys(env) ? ["muapi"] : [])])];
}

/**
 * The provider for one job: the company's own saved key comes first (so each company
 * pays for its own AI), then a key set on this worker. The job's model is the
 * company's chosen model at the time it was requested.
 */
export async function providersForJob(db: SupabaseClient, job: GenerationJob, envProviders: Record<string, GenerativeProvider>, env = process.env): Promise<Record<string, GenerativeProvider>> {
  if (job.provider !== "muapi") return envProviders;
  if (canReadSavedKeys(env)) {
    const { data } = await db.from("organization_secrets").select("ciphertext").eq("organization_id", job.organization_id).eq("name", "muapi_api_key").maybeSingle();
    if (data?.ciphertext) {
      return { ...envProviders, muapi: new MuapiProvider({ apiKey: decryptSecret(data.ciphertext as string, null, env), model: job.model || undefined, baseUrl: env.MUAPI_BASE_URL }) };
    }
  }
  if (env.MUAPI_API_KEY) return { ...envProviders, muapi: new MuapiProvider({ apiKey: env.MUAPI_API_KEY, model: job.model || env.MUAPI_I2V_MODEL, baseUrl: env.MUAPI_BASE_URL }) };
  return envProviders;
}

/** Tells the admin panel this worker is alive (never stops the worker if it fails). */
export async function heartbeat(db: SupabaseClient, w: { id: string; host: string; providers: string[]; job: string | null; done: number; error?: string | null }): Promise<void> {
  try {
    await db.rpc("worker_heartbeat", { p_worker: w.id, p_kind: "ai", p_host: w.host, p_providers: w.providers, p_job: w.job, p_done: w.done, p_error: w.error ?? null });
  } catch { /* the health page will show the worker as quiet */ }
}

export function supabaseDeps(db: SupabaseClient, providers: Record<string, GenerativeProvider>): GenerationDeps {
  return {
    providers,
    async loadAsset(id) {
      const { data } = await db.from("media_assets").select("id,organization_id,listing_id,kind,bucket,storage_path,mime_type,file_name").eq("id", id).maybeSingle();
      return data;
    },
    async download(bucket, path) {
      const { data, error } = await db.storage.from(bucket).download(path);
      if (error || !data) throw new Error("Could not read the photo");
      return new Uint8Array(await data.arrayBuffer());
    },
    async upload(bucket, path, bytes, contentType) {
      const { error } = await db.storage.from(bucket).upload(path, bytes, { contentType, upsert: true });
      if (error) throw new Error(`Could not store the clip: ${error.message}`);
    },
    async recordClip(job: GenerationJob, out, review, label) {
      const { data, error } = await db.from("media_assets").insert({
        organization_id: job.organization_id, listing_id: job.listing_id, kind: "ai_clip", bucket: "ai-clips",
        storage_path: out.path, file_name: `${label}.mp4`.slice(0, 200), mime_type: "video/mp4", size_bytes: out.sizeBytes,
        width: out.width, height: out.height, duration_seconds: out.durationSeconds,
        source_asset_id: job.source_asset_id, generation_job_id: job.id, ai_review: review,
      }).select("id").single();
      if (error || !data) throw new Error(`Could not record the clip: ${error?.message}`);
      return data.id as string;
    },
    async providerJob(jobId, providerJobId) {
      await db.from("generation_jobs").update({ provider_job_id: providerJobId }).eq("id", jobId);
    },
    async progress(jobId, p) {
      await db.from("generation_jobs").update({ progress: Math.round(p * 1000) / 1000 }).eq("id", jobId).eq("status", "running");
    },
    async finish(jobId, outcome) {
      const now = new Date().toISOString();
      if (outcome.ok) {
        await db.from("generation_jobs").update({ status: "succeeded", progress: 1, finished_at: now, output_asset_id: outcome.assetId, review: outcome.review, error_message: null }).eq("id", jobId);
      } else {
        await db.from("generation_jobs").update({ status: "failed", finished_at: now, error_message: outcome.error }).eq("id", jobId);
      }
    },
  };
}

export async function claimGenerationJob(db: SupabaseClient, workerId: string, providers: string[]): Promise<GenerationJob | null> {
  const { data, error } = await db.rpc("claim_generation_job", { p_worker: workerId, p_providers: providers });
  if (error) throw new Error(`Could not claim a job: ${error.message}`);
  const job = data as GenerationJob | null;
  return job && job.id ? job : null;
}
