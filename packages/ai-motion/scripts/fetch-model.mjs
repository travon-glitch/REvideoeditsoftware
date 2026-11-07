/*
 * Downloads the depth models used by the AI depth camera method. Each file is checked
 * against a fixed SHA-256 before it is used.
 *  - Depth Anything V2 Small (Apache-2.0) — https://github.com/DepthAnything/Depth-Anything-V2
 *    ONNX export: https://github.com/fabio-sim/Depth-Anything-ONNX (Apache-2.0). Preferred.
 *    (Only the Small model is Apache-2.0; the larger V2 models are non-commercial — don't swap them in.)
 *  - MiDaS v2.1 small (Intel ISL, MIT licence) — https://github.com/isl-org/MiDaS. Fallback.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const MODELS = [
  {
    url: "https://github.com/fabio-sim/Depth-Anything-ONNX/releases/download/v2.0.0/depth_anything_v2_vits.onnx",
    sha256: "d2b11a11c1d4a12b47608fa65a17ee9a4c605b55ee1730c8e3b526304f2562be",
    file: "depth-anything-v2-small-518.onnx",
  },
  {
    url: "https://github.com/isl-org/MiDaS/releases/download/v2_1/model-small.onnx",
    sha256: "2d8c6cb8f415229daf1eb041024208e2608c9f98e17c81cc7c6ecb449c56fd58",
    file: "midas-v21-small-256.onnx",
  },
];

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "models");
const sha = (b) => createHash("sha256").update(b).digest("hex");
mkdirSync(dir, { recursive: true });

for (const m of MODELS) {
  const target = join(dir, m.file);
  if (existsSync(target) && sha(readFileSync(target)) === m.sha256) {
    console.log(`Depth model already present: ${target}`);
    continue;
  }
  console.log(`Downloading ${m.url} …`);
  const res = await fetch(m.url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (sha(bytes) !== m.sha256) throw new Error(`Checksum mismatch for ${m.file} — refusing to use this file.`);
  writeFileSync(target, bytes);
  console.log(`Saved ${target} (${bytes.length} bytes)`);
}
