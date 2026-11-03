/* Fixtures shared by the Stage 11 template tests: listing photos, brand images, an agent headshot, worker deps. */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_CHROME_WRAPPER, type AssetRow, type JobDeps } from "@lvs/render-worker";

const FIX = join(__dirname, "..", "fixtures");
export interface Asset { row: AssetRow; file: string; width: number; height: number }

const ff = (args: string[]) => { const r = spawnSync("ffmpeg", ["-v", "error", "-y", ...args]); if (r.status !== 0) throw new Error(String(r.stderr)); };

/** A listing's photos, the brand images and an agent headshot, as files + asset rows. */
export function makeFixtures(org: string, listingId: string, dir: string) {
  mkdirSync(join(dir, "files"), { recursive: true });
  const photos: Asset[] = [];
  const real = ["opencv-building.jpg", "opencv-home.jpg"];
  for (let i = 0; i < 20; i++) {
    const id = randomUUID();
    let file: string, width: number, height: number;
    if (i < 2) { file = join(FIX, real[i]!); [width, height] = i === 0 ? [512, 384] : [868, 600]; }
    else {
      [width, height] = i % 5 === 0 ? [1200, 1600] : [1600, 1200];
      file = join(dir, "files", `${id}.jpg`);
      const hue = (i * 37) % 360;
      ff(["-f", "lavfi", "-i", `gradients=s=${width}x${height}:c0=0x8a6f4f:c1=0xd9c7a8:x0=0:y0=0:x1=${width}:y1=${height}`, "-frames:v", "1",
        "-vf", `hue=h=${hue},drawbox=x=${width * 0.1}:y=${height * 0.55}:w=${width * 0.8}:h=${height * 0.35}:c=0x3b2f2a@0.7:t=fill,drawbox=x=${width * 0.6}:y=${height * 0.15}:w=${width * 0.25}:h=${height * 0.3}:c=0xf3f0e8@0.9:t=fill,drawtext=text='Room ${i + 1}':fontsize=${Math.round(height / 12)}:fontcolor=white:x=40:y=40`,
        "-q:v", "3", file]);
    }
    photos.push({ file, width, height, row: { id, organization_id: org, listing_id: listingId, project_id: null, kind: "photo", bucket: "listing-media", storage_path: `${org}/listings/${listingId}/${id}.jpg` } });
  }
  const brandAsset = (kind: string, name: string, w: number, h: number, vf: string): Asset => {
    const id = randomUUID();
    const file = join(dir, "files", `${name}-${id}.png`);
    ff(["-f", "lavfi", "-i", `color=c=0xFFFFFF:s=${w}x${h}`, "-frames:v", "1", "-vf", vf, file]);
    return { file, width: w, height: h, row: { id, organization_id: org, listing_id: null, project_id: null, kind, bucket: "brand-assets", storage_path: `${org}/brand/${id}.png` } };
  };
  const logo = brandAsset("logo", "logo", 600, 240, "drawbox=x=0:y=0:w=600:h=240:c=0xF59E0B@1:t=fill,drawtext=text='ACME':fontsize=150:fontcolor=0x0F172A:x=(w-text_w)/2:y=(h-text_h)/2");
  const brokerage = brandAsset("logo", "brokerage", 500, 200, "drawbox=x=0:y=0:w=500:h=200:c=0xFFFFFF@1:t=fill,drawtext=text='ACME BROKERS':fontsize=56:fontcolor=0x1D4ED8:x=(w-text_w)/2:y=(h-text_h)/2");
  const headshotId = randomUUID();
  const headshotFile = join(dir, "files", `headshot-${headshotId}.jpg`);
  ff(["-f", "lavfi", "-i", "gradients=s=600x800:c0=0x4b6b8a:c1=0x9fb7c9", "-frames:v", "1",
    "-vf", "drawbox=x=150:y=500:w=300:h=300:c=0x1f2937@1:t=fill,drawbox=x=200:y=170:w=200:h=260:c=0xe0b48c@1:t=fill", "-q:v", "3", headshotFile]);
  const headshot: Asset = { file: headshotFile, width: 600, height: 800, row: { id: headshotId, organization_id: org, listing_id: null, project_id: null, kind: "headshot", bucket: "brand-assets", storage_path: `${org}/agents/${headshotId}.jpg` } };
  return { photos, logo, brokerage, headshot };
}

export function workerDeps(org: string, listingId: string, projectId: string, assets: Asset[], stored: Map<string, Uint8Array>): JobDeps {
  const byPath = new Map(assets.map((a) => [a.row.storage_path, a.file]));
  return {
    chrome: DEFAULT_CHROME_WRAPPER,
    timeoutMs: 15 * 60_000,
    async loadProject(id) { return id === projectId ? { id, organization_id: org, listing_id: listingId, title: "Template video" } : null; },
    async loadAssets(ids) { return assets.map((a) => a.row).filter((r) => ids.includes(r.id)); },
    async download(_b, path) { return new Uint8Array(readFileSync(byPath.get(path)!)); },
    async upload(bucket, path, bytes) { stored.set(`${bucket}/${path}`, bytes); },
    async recordOutput() { return randomUUID(); },
    async progress() {},
    async finish() {},
  };
}

/** A strip of frames (one every `every` seconds) for review. */
export function contactStrip(file: string, out: string, seconds: number, cols = 6) {
  const every = Math.max(0.5, seconds / cols);
  ff(["-i", file, "-vf", `fps=1/${every},scale=-2:320,tile=${cols}x1`, "-frames:v", "1", out]);
}

