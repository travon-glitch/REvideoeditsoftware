#!/usr/bin/env node
/*
 * Gallery images for the template picker, cut from REAL renders of each template
 * (apps/web/test-output/templates/<key>.mp4, made by tests/render/templates.render.test.ts):
 *   apps/web/public/templates/<key>.jpg  — a still once the intro has played (large thumbnail)
 *   apps/web/public/templates/<key>.mp4  — the first seconds, small and silent (preview)
 * Usage: node tools/templates/make-gallery.mjs
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..", "..", "apps", "web");
const src = join(root, "test-output", "templates");
const out = join(root, "public", "templates");
mkdirSync(out, { recursive: true });
// seconds into each render where the title card / banner is on screen
const STILL = {
  "just-listed": 3.0, "luxury-listing": 3.8, "modern-home": 3.0, "open-house": 1.4, "price-reduced": 1.6, "coming-soon": 1.2, "just-sold": 1.3,
  "property-highlights": 3.0, "investment-property": 3.0, "rental-property": 3.0, "waterfront-home": 3.6, "new-construction": 3.0,
  "twilight-tour": 3.6, "agent-introduction": 1.3, "cinematic-reveal": 4.0,
};
const run = (args) => { const r = spawnSync("ffmpeg", ["-v", "error", "-y", ...args], { encoding: "utf8" }); if (r.status !== 0) throw new Error(r.stderr); };
for (const [key, t] of Object.entries(STILL)) {
  const file = join(src, `${key}.mp4`);
  if (!existsSync(file)) { console.warn(`missing ${file}`); continue; }
  // 16:9 cards: wide renders fill the card; vertical and square ones are shown whole over a blurred fill
  run(["-ss", String(t), "-i", file, "-frames:v", "1", "-filter_complex",
    "[0]split[a][b];[a]scale=960:540:force_original_aspect_ratio=increase,crop=960:540,boxblur=20:2,eq=brightness=-0.15[bg];[b]scale=960:540:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2",
    "-q:v", "4", join(out, `${key}.jpg`)]);
  run(["-i", file, "-t", "10", "-an", "-vf", "scale='if(gt(iw,ih),640,-2)':'if(gt(iw,ih),-2,480)',fps=24", "-c:v", "libx264", "-preset", "slow", "-crf", "33", "-pix_fmt", "yuv420p", "-movflags", "+faststart", join(out, `${key}.mp4`)]);
  console.log(key, Math.round(statSync(join(out, `${key}.jpg`)).size / 1024), "KB jpg,", Math.round(statSync(join(out, `${key}.mp4`)).size / 1024), "KB mp4");
}
