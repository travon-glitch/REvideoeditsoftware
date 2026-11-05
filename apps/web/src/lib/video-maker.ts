import "server-only";
/*
 * The "video maker" is the render worker (and AI worker) that turns queued exports into MP4s.
 * It runs either on an always-on server (deploy/worker.Dockerfile) or on demand on GitHub Actions
 * (.github/workflows/render-videos.yml), which the app starts when someone presses Export:
 *
 *   GITHUB_RENDER_TOKEN  fine-grained GitHub token for this repository with "Actions: Read and write"
 *   GITHUB_RENDER_REPO   owner/repo, e.g. travon-glitch/REvideoeditsoftware
 *   GITHUB_RENDER_REF    branch with the workflow (default main)
 *
 * The token is server-only and is never sent to the browser.
 */
import { createAdminClient } from "@/lib/supabase/admin";

export interface VideoMakerStatus {
  /** A worker reported in the last 2 minutes. */
  online: boolean;
  /** Exports start the GitHub Actions video maker automatically. */
  onDemand: boolean;
}

function githubSettings() {
  const token = process.env.GITHUB_RENDER_TOKEN?.trim();
  const repo = process.env.GITHUB_RENDER_REPO?.trim();
  if (!token || !repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) return null;
  return { token, repo, ref: process.env.GITHUB_RENDER_REF?.trim() || "main" };
}

async function workersSeen(kind: "render" | "ai", withinSeconds: number): Promise<number> {
  try {
    const since = new Date(Date.now() - withinSeconds * 1000).toISOString();
    const { count } = await createAdminClient().from("worker_heartbeats").select("worker_id", { count: "exact", head: true })
      .eq("kind", kind).gte("last_seen_at", since);
    return count ?? 0;
  } catch { return 0; }
}

export async function videoMakerStatus(): Promise<VideoMakerStatus> {
  return { online: (await workersSeen("render", 120)) > 0, onDemand: !!githubSettings() };
}

let lastStart = 0;

/**
 * Starts the GitHub Actions video maker, unless one is already running (it picks up new jobs itself).
 * Never throws: a failed start only means the job waits for the next start or the safety-net schedule.
 */
export async function startVideoMaker(kind: "render" | "ai" = "render"): Promise<"started" | "running" | "not-configured" | "failed"> {
  const gh = githubSettings();
  if (!gh) return "not-configured";
  if ((await workersSeen(kind, 45)) > 0) return "running";
  if (Date.now() - lastStart < 30_000) return "running"; // just asked a moment ago
  try {
    const res = await fetch(`https://api.github.com/repos/${gh.repo}/actions/workflows/render-videos.yml/dispatches`, {
      method: "POST", signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${gh.token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" },
      body: JSON.stringify({ ref: gh.ref }),
    });
    if (res.status === 204) { lastStart = Date.now(); return "started"; }
    console.error(JSON.stringify({ event: "lvs.video_maker_start_failed", status: res.status, body: (await res.text()).slice(0, 200) }));
    return "failed";
  } catch (e) {
    console.error(JSON.stringify({ event: "lvs.video_maker_start_failed", error: e instanceof Error ? e.message : "unknown" }));
    return "failed";
  }
}
