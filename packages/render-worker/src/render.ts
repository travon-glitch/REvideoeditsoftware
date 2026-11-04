/*
 * Renders one FableCut document to MP4 inside a throwaway sandbox:
 *
 *   <tmp>/lvs-render-XXXX/        ← FABLECUT_DATA_DIR (only this job's files)
 *     project.json                ← the checked document
 *     media/<uuid>.<ext>          ← only the files the document is allowed to use
 *     exports/…mp4                ← FableCut's output
 *
 * The vendored FableCut server is started for this job only, on 127.0.0.1 and
 * a random free port, with a minimal environment (no database or storage
 * keys). Its headless export drives FableCut's own compositor in Chrome and
 * encodes with FFmpeg. The server, browser and folder are removed afterwards.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm, stat, copyFile, readdir } from "node:fs/promises";
import { renameSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

export interface RenderInput {
  /** A FableCut project document (already checked with checkRenderDocument). */
  document: Record<string, unknown>;
  /** File name in media/ → bytes (or a local path to copy). */
  files: Map<string, Uint8Array | { path: string }>;
  /** Chrome/Chromium executable FableCut should launch (FABLECUT_CHROME). */
  chrome?: string;
  timeoutMs?: number;
  onProgress?: (progress: number) => void;
  /** Keep the sandbox folder (debugging only). */
  keepWorkDir?: boolean;
}

export interface RenderResult {
  /** Path of the MP4 — inside a folder the caller must remove with cleanup(). */
  mp4Path: string;
  width: number;
  height: number;
  durationSeconds: number;
  sizeBytes: number;
  hasAudio: boolean;
  report: string;
  cleanup: () => Promise<void>;
}

const here = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_CHROME_WRAPPER = resolve(here, "..", "bin", "chrome-no-sandbox.sh");

function fablecutServerPath(): string {
  const core = require("@lvs/fablecut-core") as { UPSTREAM_DIR: string };
  return join(core.UPSTREAM_DIR, "server.js");
}

async function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const s = createServer();
    s.once("error", fail);
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      s.close(() => ok(port));
    });
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Loudness every finished video is brought to: -14 LUFS (what Instagram, TikTok, YouTube and Facebook play at). */
export const TARGET_LUFS = -14;

/**
 * Evens out loudness between videos (one template's music can be far quieter than another's). Two passes:
 * measure, then apply one constant gain (linear mode), so the balance between narration and music,
 * fades and ducking are unchanged. The video stream is copied untouched. If anything fails, the
 * original file is kept — loudness must never cost someone their video.
 */
export function normalizeLoudness(mp4Path: string): boolean {
  const filter = `loudnorm=I=${TARGET_LUFS}:TP=-1.5:LRA=11`;
  const measure = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", mp4Path, "-vn", "-af", `${filter}:print_format=json`, "-f", "null", "-"], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  const json = /\{[^{}]*"input_i"[^{}]*\}/.exec(measure.stderr ?? "")?.[0];
  if (measure.status !== 0 || !json) return false;
  const m = JSON.parse(json) as Record<string, string>;
  const inputI = Number(m.input_i);
  if (!Number.isFinite(inputI) || inputI < -70) return false; // silent: nothing to adjust
  const out = `${mp4Path}.loud.mp4`;
  const r = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-y", "-i", mp4Path, "-map", "0:v:0", "-map", "0:a:0", "-c:v", "copy",
    "-af", `${filter}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`,
    "-ar", "48000", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (r.status !== 0) { rmSync(out, { force: true }); return false; }
  renameSync(out, mp4Path);
  return true;
}

export function probe(file: string): { width: number; height: number; durationSeconds: number; hasAudio: boolean } {
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,width,height:format=duration", "-of", "json", file], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffprobe failed: ${r.stderr}`);
  const j = JSON.parse(r.stdout) as { streams?: { codec_type?: string; width?: number; height?: number }[]; format?: { duration?: string } };
  const v = j.streams?.find((s) => s.codec_type === "video");
  return {
    width: v?.width ?? 0,
    height: v?.height ?? 0,
    durationSeconds: Number(j.format?.duration ?? 0),
    hasAudio: !!j.streams?.some((s) => s.codec_type === "audio"),
  };
}

export async function renderDocument(input: RenderInput): Promise<RenderResult> {
  const work = await mkdtemp(join(tmpdir(), "lvs-render-"));
  let server: ChildProcess | null = null;
  const cleanup = async () => {
    if (server && server.exitCode === null) {
      try { process.kill(-server.pid!, "SIGKILL"); } catch { try { server.kill("SIGKILL"); } catch { /* gone */ } }
    }
    if (!input.keepWorkDir) await rm(work, { recursive: true, force: true });
  };

  try {
    await mkdir(join(work, "media"));
    for (const [name, data] of input.files) {
      if (!/^[0-9a-zA-Z._-]+$/.test(name) || name.includes("..")) throw new Error(`Unsafe file name ${name}`);
      const target = join(work, "media", name);
      if ("path" in data) await copyFile(data.path, target);
      else await writeFile(target, data);
    }
    await writeFile(join(work, "project.json"), JSON.stringify({ ...input.document, revision: 1 }));

    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;
    const chrome = input.chrome ?? process.env.FABLECUT_CHROME ?? DEFAULT_CHROME_WRAPPER;
    // Minimal environment: FableCut and Chrome never see the worker's secrets.
    const env = {
      PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
      HOME: work,
      TMPDIR: work,
      LANG: "C.UTF-8",
      PORT: String(port),
      HOST: "127.0.0.1",
      FABLECUT_DATA_DIR: work,
      FABLECUT_CHROME: chrome,
      FABLECUT_NO_FS_WATCH: "1",
      FABLECUT_AUTO_VERSION_MIN: "0",
      ...(process.env.LVS_CHROME_BIN ? { LVS_CHROME_BIN: process.env.LVS_CHROME_BIN } : {}),
    } as Record<string, string> as unknown as NodeJS.ProcessEnv;
    const log: string[] = [];
    server = spawn(process.execPath, [fablecutServerPath()], { cwd: work, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    server.stdout?.on("data", (b) => { log.push(String(b)); if (log.length > 200) log.shift(); });
    server.stderr?.on("data", (b) => { log.push(String(b)); if (log.length > 200) log.shift(); });

    const deadline = Date.now() + (input.timeoutMs ?? 15 * 60_000);
    for (;;) {
      if (server.exitCode !== null) throw new Error(`FableCut stopped while starting:\n${log.join("").slice(-2000)}`);
      try { if ((await fetch(`${base}/api/project`)).ok) break; } catch { /* not up yet */ }
      if (Date.now() > deadline) throw new Error("FableCut did not start in time");
      await sleep(200);
    }

    const req = await fetch(`${base}/api/export/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: base },
      body: JSON.stringify({ where: "headless", preset: "master", range: "entire" }),
    });
    const job = (await req.json()) as { id?: string; error?: string };
    if (!req.ok || !job.id) throw new Error(`Export was refused: ${job.error ?? req.status}`);

    let last = -1;
    for (;;) {
      if (Date.now() > deadline) {
        await fetch(`${base}/api/export/job/cancel?id=${job.id}`, { method: "POST", headers: { Origin: base } }).catch(() => undefined);
        throw new Error("Rendering took too long");
      }
      await sleep(1000);
      const r = (await (await fetch(`${base}/api/export/job?id=${job.id}`)).json()) as {
        status: string; progress?: number; error?: string | null; src?: string | null;
      };
      const p = Math.max(0, Math.min(1, r.progress ?? 0));
      if (input.onProgress && p - last >= 0.02) { last = p; input.onProgress(p); }
      if (r.status === "done") {
        // Take the single MP4 FableCut wrote into this job's own exports folder.
        const outputs = (await readdir(join(work, "exports"))).filter((f) => f.toLowerCase().endsWith(".mp4"));
        if (outputs.length !== 1) throw new Error(`Expected one MP4, found ${outputs.length}`);
        const mp4Path = join(work, "exports", outputs[0]!);
        if (probe(mp4Path).hasAudio) normalizeLoudness(mp4Path);
        const info = probe(mp4Path);
        const size = (await stat(mp4Path)).size;
        input.onProgress?.(1);
        return { mp4Path, ...info, sizeBytes: size, report: `${info.width}×${info.height} · ${info.durationSeconds.toFixed(2)} s`, cleanup };
      }
      if (r.status === "failed" || r.status === "cancelled") {
        throw new Error(`Rendering failed: ${r.error ?? r.status}`);
      }
    }
  } catch (e) {
    await cleanup();
    throw e;
  } finally {
    // The FableCut server is no longer needed once the MP4 exists (or on failure).
    if (server && server.exitCode === null) {
      try { process.kill(-server.pid!, "SIGKILL"); } catch { /* already gone */ }
    }
  }
}
