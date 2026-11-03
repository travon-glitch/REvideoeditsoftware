/* Production dependencies: Supabase (service role, server-side only). */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { JobDeps, RenderJob } from "./process-job.ts";

export function supabaseFromEnv(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for the render worker.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function supabaseDeps(db: SupabaseClient, opts: { chrome?: string; timeoutMs?: number } = {}): JobDeps {
  return {
    chrome: opts.chrome,
    timeoutMs: opts.timeoutMs,
    async loadProject(id) {
      const { data } = await db.from("video_projects").select("id,organization_id,listing_id,title").eq("id", id).maybeSingle();
      return data;
    },
    async loadAssets(ids) {
      if (ids.length === 0) return [];
      const { data, error } = await db.from("media_assets")
        .select("id,organization_id,listing_id,project_id,kind,bucket,storage_path").in("id", ids);
      if (error) throw new Error(`Could not load media: ${error.message}`);
      return data ?? [];
    },
    async download(bucket, path) {
      const { data, error } = await db.storage.from(bucket).download(path);
      if (error || !data) throw new Error(`Could not download ${path}`);
      return new Uint8Array(await data.arrayBuffer());
    },
    async upload(bucket, path, bytes, contentType) {
      const { error } = await db.storage.from(bucket).upload(path, bytes, { contentType, upsert: true });
      if (error) throw new Error(`Could not store the video: ${error.message}`);
    },
    async recordOutput({ job, project, path, fileName, result }) {
      const { data, error } = await db.from("media_assets").insert({
        organization_id: job.organization_id,
        project_id: project.id,
        kind: "render",
        bucket: "video-exports",
        storage_path: path,
        file_name: fileName,
        mime_type: "video/mp4",
        size_bytes: result.sizeBytes,
        width: result.width,
        height: result.height,
        duration_seconds: result.durationSeconds,
      }).select("id").single();
      if (error || !data) throw new Error(`Could not record the video: ${error?.message}`);
      return data.id as string;
    },
    async progress(jobId, progress) {
      await db.from("render_jobs").update({ progress: Math.round(progress * 1000) / 1000 }).eq("id", jobId).eq("status", "running");
    },
    async finish(jobId, outcome) {
      const now = new Date().toISOString();
      if (outcome.ok) {
        await db.from("render_jobs").update({
          status: "succeeded", progress: 1, finished_at: now, output_asset_id: outcome.assetId, output_path: outcome.path,
          duration_seconds: outcome.result.durationSeconds, width: outcome.result.width, height: outcome.result.height,
          size_bytes: outcome.result.sizeBytes, error_message: null,
        }).eq("id", jobId);
      } else {
        await db.from("render_jobs").update({ status: "failed", finished_at: now, error_message: outcome.error }).eq("id", jobId);
      }
    },
  };
}

export async function claimJob(db: SupabaseClient, workerId: string): Promise<RenderJob | null> {
  const { data, error } = await db.rpc("claim_render_job", { p_worker: workerId });
  if (error) throw new Error(`Could not claim a job: ${error.message}`);
  const job = data as RenderJob | null;
  return job && job.id ? job : null;
}

/** Tells the admin panel this worker is alive (never stops the worker if it fails). */
export async function heartbeat(db: SupabaseClient, w: { id: string; host: string; job: string | null; done: number; error?: string | null }): Promise<void> {
  try {
    await db.rpc("worker_heartbeat", { p_worker: w.id, p_kind: "render", p_host: w.host, p_providers: [], p_job: w.job, p_done: w.done, p_error: w.error ?? null });
  } catch { /* the health page will show the worker as quiet */ }
}
