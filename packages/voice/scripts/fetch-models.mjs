#!/usr/bin/env node
/*
 * Downloads the voice models (both Apache-2.0) from the sherpa-onnx GitHub releases:
 *   Kokoro-82M v1.0 int8 (text-to-speech) and Zipformer small English (speech recognition).
 * Only the files the app uses are kept.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const dir = process.env.LVS_VOICE_MODELS ?? join(import.meta.dirname, "..", "models");
mkdirSync(dir, { recursive: true });
const base = "https://github.com/k2-fsa/sherpa-onnx/releases/download";
const models = [
  { name: "kokoro-int8-multi-lang-v1_0", url: `${base}/tts-models/kokoro-int8-multi-lang-v1_0.tar.bz2`, check: "model.int8.onnx",
    drop: ["espeak-ng-data", "dict", "date-zh.fst", "number-zh.fst", "phone-zh.fst", "lexicon-zh.txt"] },
  { name: "sherpa-onnx-zipformer-small-en-2023-06-26", url: `${base}/asr-models/sherpa-onnx-zipformer-small-en-2023-06-26.tar.bz2`, check: "encoder-epoch-99-avg-1.int8.onnx",
    drop: ["test_wavs", "encoder-epoch-99-avg-1.onnx", "decoder-epoch-99-avg-1.onnx", "joiner-epoch-99-avg-1.onnx"] },
];
for (const m of models) {
  if (existsSync(join(dir, m.name, m.check))) { console.log(`${m.name}: already installed`); continue; }
  const tar = join(dir, `${m.name}.tar.bz2`);
  console.log(`Downloading ${m.name}…`);
  execFileSync("curl", ["-sSfL", "-o", tar, m.url], { stdio: "inherit" });
  execFileSync("tar", ["xjf", tar, "-C", dir], { stdio: "inherit" });
  rmSync(tar);
  for (const d of m.drop) rmSync(join(dir, m.name, d), { recursive: true, force: true });
  console.log(`${m.name}: installed`);
}
