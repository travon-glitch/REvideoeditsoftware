/* FFmpeg helpers: decode a photo to raw RGB, encode raw frames to MP4, probe and sample a video. */
import { spawn, spawnSync } from "node:child_process";

const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH ?? "ffprobe";

export interface Rgb { width: number; height: number; data: Uint8Array }

/**
 * Decodes an image (any format FFmpeg reads), "cover"-fitted to exactly width×height
 * (same as FableCut's fit: cover), as packed RGB.
 */
export function decodeCover(file: string, width: number, height: number): Rgb {
  const vf = `scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${width}:${height}`;
  const r = spawnSync(FFMPEG, ["-v", "error", "-i", file, "-frames:v", "1", "-vf", vf, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { maxBuffer: width * height * 3 + 1024 });
  if (r.status !== 0 || r.stdout.length !== width * height * 3) throw new Error(`Could not read the photo: ${String(r.stderr).slice(0, 200)}`);
  return { width, height, data: new Uint8Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.length) };
}

/** Decodes the whole image squashed to an exact size (for the depth network input). */
export function decodeStretch(file: string, width: number, height: number): Rgb {
  const r = spawnSync(FFMPEG, ["-v", "error", "-i", file, "-frames:v", "1", "-vf", `scale=${width}:${height}:flags=bicubic`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { maxBuffer: width * height * 3 + 1024 });
  if (r.status !== 0) throw new Error(`Could not read the photo: ${String(r.stderr).slice(0, 200)}`);
  return { width, height, data: new Uint8Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.length) };
}

export interface ImageSize { width: number; height: number }
export function imageSize(file: string): ImageSize {
  const r = spawnSync(FFPROBE, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", file], { encoding: "utf8" });
  const [w, h] = r.stdout.trim().split(",").map(Number);
  if (!w || !h) throw new Error("Could not read the photo size");
  return { width: w, height: h };
}

/** Streams raw RGB frames into an H.264 MP4 (yuv420p, +faststart — plays everywhere). */
export class Mp4Writer {
  private proc;
  private done: Promise<void>;
  private err = "";
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  constructor(out: string, width: number, height: number, fps = 30) {
    this.width = width; this.height = height; this.fps = fps;
    this.proc = spawn(FFMPEG, [
      "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${width}x${height}`, "-r", String(fps), "-i", "-",
      "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out,
    ], { stdio: ["pipe", "ignore", "pipe"] });
    this.proc.stderr.on("data", (d) => { this.err += String(d); });
    this.done = new Promise((resolve, reject) => {
      this.proc.on("error", reject);
      this.proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`Encoding failed: ${this.err.slice(0, 300)}`))));
    });
  }
  async write(frame: Uint8Array): Promise<void> {
    if (!this.proc.stdin.write(frame)) await new Promise<void>((r) => this.proc.stdin.once("drain", () => r()));
  }
  async close(): Promise<void> { this.proc.stdin.end(); await this.done; }
  kill(): void { this.proc.kill("SIGKILL"); }
}

export interface VideoInfo { width: number; height: number; durationSeconds: number; fps: number; codec: string; sizeBytes?: number }
export function probeVideo(file: string): VideoInfo {
  const r = spawnSync(FFPROBE, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,codec_name,r_frame_rate:format=duration",
    "-of", "json", file], { encoding: "utf8" });
  const j = JSON.parse(r.stdout || "{}") as { streams?: { width: number; height: number; codec_name: string; r_frame_rate: string }[]; format?: { duration: string } };
  const s = j.streams?.[0];
  if (!s) throw new Error("That file isn't a playable video");
  const [n, d] = s.r_frame_rate.split("/").map(Number);
  return { width: s.width, height: s.height, codec: s.codec_name, fps: n && d ? n / d : 0, durationSeconds: Number(j.format?.duration ?? 0) };
}

/** One frame at time t, scaled to w×h, as RGB. */
export function frameAt(file: string, t: number, w: number, h: number): Uint8Array {
  const r = spawnSync(FFMPEG, ["-v", "error", "-ss", String(t), "-i", file, "-frames:v", "1", "-vf", `scale=${w}:${h}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { maxBuffer: w * h * 3 + 1024 });
  if (r.status !== 0) throw new Error(`Could not read a frame: ${String(r.stderr).slice(0, 200)}`);
  return new Uint8Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.length);
}

/** Re-encodes a provider's video to our delivery format: cover-fit to width×height, 30 fps, H.264, no audio. */
export function normalizeVideo(input: string, out: string, width: number, height: number, maxSeconds: number): void {
  const vf = `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},fps=30,format=yuv420p`;
  const r = spawnSync(FFMPEG, ["-v", "error", "-y", "-i", input, "-t", String(maxSeconds), "-vf", vf, "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-movflags", "+faststart", out], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`Could not convert the AI video: ${r.stderr.slice(0, 300)}`);
}
