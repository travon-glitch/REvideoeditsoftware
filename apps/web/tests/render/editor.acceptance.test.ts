/*
 * STAGE 12 ACCEPTANCE — Advanced editor and AI voiceovers.
 *
 *  "Create a video containing multiple photographs, camera movements, text, music, AI narration
 *   and captions. Render and check that the audio and visuals are synchronized."
 *
 *  1. Narration script drafted from the listing's verified details (draftNarration), spoken by the
 *     on-server voice (Kokoro-82M, Apache-2.0) and timed word by word by speech recognition
 *     (Zipformer, Apache-2.0) — the same code the editor's "Create narration" runs.
 *  2. A plan built like the Advanced editor builds it: 6 photo scenes with Camera Studio moves, one
 *     scene split on the timeline, per-scene transitions, a title with keyframes, an animated
 *     lower-third overlay, licensed music (trimmed, fade in / out, ducked under the voice), the
 *     narration on its own track and "highlight" captions.
 *  3. Rendered by the real render worker as vertical 9:16 and portrait 4:5 MP4s.
 *  4. Sync checks on the MP4 itself:
 *     - AUDIO: speech recognition on the rendered soundtrack finds every narrated word within
 *       0.15 s (average) of where the plan put it;
 *     - VISUALS: the middle of every scene shows that scene's photo (matched against all photos);
 *     - CAPTIONS: the highlighted (spoken) word's colour is on screen while words are spoken and
 *       gone between lines and before the narration starts;
 *     - music is heard before the narration starts, and the file decodes cleanly and plays in Chrome.
 *
 * Run with: LVS_RENDER_TESTS=1 npx vitest run tests/render/editor.acceptance.test.ts
 */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultSpec } from "@lvs/camera-presets";
import { processJob, probe, type AssetRow } from "@lvs/render-worker";
import { decodeCover, frameAt, smallGray, ssim } from "@lvs/ai-motion";
import { alignWords, readWav, synthesize, transcribe, voiceModelsAvailable, wavBytes } from "@lvs/voice";
import { makeFixtures, workerDeps, type Asset } from "./template-fixtures";
import { draftNarration, checkNarration } from "@/lib/video/narration";
import { cuesFrom } from "@/lib/video/voice-store";
import { CANVAS_1080, composeDocument, planSchema, sceneStarts, totalDuration, type EditPlan } from "@/lib/video/plan";
import { splitScene } from "@/lib/video/timeline";
import { narrationStart } from "@/lib/video/editor-layers";
import { validateFableCutDocument } from "@/lib/video/validate-document";
import type { ListingRow } from "@/lib/database.types";

const hasTools = spawnSync("ffmpeg", ["-version"]).status === 0 && existsSync("/usr/bin/google-chrome");
const models = voiceModelsAvailable();
process.env.LVS_CHROME_BIN ??= process.env.LVS_TEST_CHROME ?? "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome";
const OUT = join(__dirname, "..", "..", "test-output", "stage12");
const MUSIC = join(__dirname, "..", "..", "assets", "music", "warm-welcome.m4a");
const ACCENT = "#FF00FF"; // the spoken word's highlight colour (easy to find in frames)

const ff = (args: string[]) => { const r = spawnSync("ffmpeg", ["-v", "error", "-y", ...args], { maxBuffer: 1 << 28 }); if (r.status !== 0) throw new Error(String(r.stderr)); return r.stdout as Buffer; };

const listing = {
  address_line: "742 Evergreen Terrace", city: "Springfield", state: "OR", price: 525000, bedrooms: 4, bathrooms: 2.5, square_feet: 2150,
  property_type: "single_family", status: "for_sale", agent_name: "Alice Agent", brokerage: "Acme Realty", contact_phone: "555-0100", contact_email: "alice@acme.test",
  description: "Bright home with a big kitchen.", open_house_date: null, open_house_start: null, open_house_end: null,
} as unknown as ListingRow;

describe.skipIf(!hasTools || !models.tts || !models.asr)("Stage 12 acceptance: photos + camera + text + music + AI narration + captions, in sync", () => {
  const org = randomUUID(), listingId = randomUUID();
  const ctx = {} as { fx: ReturnType<typeof makeFixtures>; music: Asset; voice: Asset; plan: EditPlan; files: Record<string, string>; script: string };

  it("drafts the narration from verified facts, speaks it and times every word", () => {
    mkdirSync(OUT, { recursive: true });
    ctx.fx = makeFixtures(org, listingId, OUT);
    ctx.script = draftNarration(listing, { tone: "warm" });
    expect(ctx.script).toBe("Welcome to 742 Evergreen Terrace, Springfield, OR. This single-family home offers 4 bedrooms and 2.5 bathrooms across 2,150 square feet. It's offered at $525,000. To arrange a private showing, contact Alice Agent of Acme Realty.");
    expect(checkNarration(ctx.script, listing)).toEqual([]);
    expect(checkNarration("It has a pool and a 3 car garage.", listing).length).toBeGreaterThan(0); // invented claims are flagged
    const n = synthesize(ctx.script, "am_michael", 1.0);
    expect(n.sentences).toHaveLength(4);
    const voiceId = randomUUID();
    const voiceFile = join(OUT, `${voiceId}.m4a`);
    writeFileSync(join(OUT, "narration.wav"), wavBytes(n.samples, n.sampleRate));
    ff(["-i", join(OUT, "narration.wav"), "-c:a", "aac", "-b:a", "128k", "-ac", "1", "-ar", "48000", voiceFile]);
    ctx.voice = { file: voiceFile, width: 0, height: 0, row: { id: voiceId, organization_id: org, listing_id: null, project_id: "p", kind: "audio", bucket: "project-media", storage_path: `${org}/projects/p/${voiceId}.m4a` } };
    const heard = transcribe(n.samples, n.sampleRate);
    const cues = cuesFrom(alignWords(ctx.script, heard));
    expect(cues.length).toBeGreaterThanOrEqual(5);
    expect(cues.map((c) => c.text).join(" ")).toBe(ctx.script);
    const musicId = randomUUID();
    ctx.music = { file: MUSIC, width: 0, height: 0, row: { id: musicId, organization_id: org, listing_id: null, project_id: null, kind: "audio", bucket: "music-library", storage_path: `${org}/music/${musicId}.m4a` } };

    // the plan, as the Advanced editor builds it
    const photos = ctx.fx.photos.slice(0, 6);
    const moves = ["push_in", "pan_right", "pull_out", "pan_left", "push_in", "pull_out"] as const;
    let plan: EditPlan = planSchema.parse({
      version: 1, aspect: "9:16", transition: "fade",
      scenes: photos.map((p, i) => ({ id: `s${i + 1}`, assetId: p.row.id, move: "still", duration: i === 0 ? 5 : 3.6, camera: defaultSpec(moves[i]!, { strength: 0.7 }),
        ...(i === 2 ? { transition: "wipe", transitionSeconds: 0.6 } : {}), ...(i === 4 ? { transition: "zoom" } : {}) })),
      texts: [{ id: "t1", text: "742 Evergreen Terrace", sceneId: "@first", style: "title", position: "top", duration: 3.5, x: 0, y: -0.3,
        keys: [{ t: 0, y: -0.36, opacity: 0 }, { t: 0.8, y: -0.3, opacity: 1, ease: "ease-out" }] }],
      overlays: [{ id: "o1", preset: "lower-third", start: 6, duration: 3.5, x: 0, y: 0.05, scale: 1, rotation: 0, color: "#1D4ED8", text: "4 beds · 2.5 baths", animIn: "slide-up", animOut: "fade" }],
      music: { assetId: musicId, volume: 0.5, fadeOut: true, fadeIn: 1, fadeOutSeconds: 2.5, in: 3, duck: 0.25 },
      voiceover: { assetId: voiceId, script: ctx.script, voice: "am_michael", speed: 1, start: 1.5, volume: 1, duration: n.seconds, sentences: n.sentences.map((s) => ({ start: s.start, end: s.end })) },
      captions: { enabled: true, style: "highlight", position: "bottom", offset: 0, size: 1, cues, source: "narration" },
    });
    plan = splitScene(plan, "s1", 2.5); // a scene split on the timeline
    const need = 1.5 + n.seconds + 1.5;
    if (totalDuration(plan) < need) plan.scenes.at(-1)!.duration = Math.min(10, Math.round((plan.scenes.at(-1)!.duration + need - totalDuration(plan)) * 100) / 100);
    ctx.plan = planSchema.parse(plan);
    expect(totalDuration(ctx.plan)).toBeGreaterThanOrEqual(need - 0.01);
  }, 300_000);

  for (const aspect of ["9:16", "4:5"] as const) {
    it(`renders a real ${aspect} MP4`, async () => {
      const plan = { ...ctx.plan, aspect };
      const info = ctx.fx.photos.map((p) => ({ id: p.row.id, storage_path: p.row.storage_path, file_name: "p.jpg", width: p.width, height: p.height }));
      const music = [
        { id: ctx.music.row.id, storage_path: ctx.music.row.storage_path, file_name: "warm-welcome.m4a", duration_seconds: 75 },
        { id: ctx.voice.row.id, storage_path: ctx.voice.row.storage_path, file_name: "Narration.m4a", duration_seconds: plan.voiceover!.duration },
      ];
      const doc = composeDocument({ plan, title: "Narrated tour", photos: info, music, brand: { primary_color: ACCENT, heading_font: "Montserrat", body_font: "Inter" } });
      expect(validateFableCutDocument(doc)).toEqual({ ok: true });
      const projectId = "p";
      const stored = new Map<string, Uint8Array>();
      const deps = workerDeps(org, listingId, projectId, [...ctx.fx.photos, ctx.music, ctx.voice], stored);
      const rows: AssetRow[] = [...ctx.fx.photos, ctx.music, ctx.voice].map((a) => a.row);
      deps.loadAssets = async (ids) => rows.filter((r) => ids.includes(r.id));
      const r = await processJob({ id: randomUUID(), organization_id: org, project_id: projectId, aspect, document: doc }, deps);
      expect(r.error ?? "").toBe("");
      const file = join(OUT, `narrated-${aspect.replace(":", "x")}.mp4`);
      writeFileSync(file, [...stored.values()][0]!);
      (ctx.files ??= {})[aspect] = file;
      const p = probe(file);
      expect([p.width, p.height]).toEqual([CANVAS_1080[aspect].width, CANVAS_1080[aspect].height]);
      expect(Math.abs(p.durationSeconds - totalDuration(plan))).toBeLessThan(0.6);
      const codec = (s: string) => spawnSync("ffprobe", ["-v", "error", "-select_streams", s, "-show_entries", "stream=codec_name", "-of", "csv=p=0", file], { encoding: "utf8" }).stdout.trim();
      expect([codec("v:0"), codec("a:0")]).toEqual(["h264", "aac"]);
      expect(spawnSync("ffmpeg", ["-v", "error", "-i", file, "-f", "null", "-"], { encoding: "utf8" }).stderr.trim()).toBe("");
    }, 1_200_000);
  }

  it("AUDIO: the narration in the rendered file is where the plan put it, word by word", () => {
    const file = ctx.files["9:16"]!;
    const wav = ff(["-i", file, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-f", "wav", "pipe:1"]);
    const { samples, sampleRate } = readWav(new Uint8Array(wav));
    const heard = transcribe(samples, sampleRate);
    const got = alignWords(ctx.script, heard);
    const base = narrationStart(ctx.plan);
    const want = ctx.plan.captions!.cues.flatMap((c) => c.words!.map(([a]) => base + a));
    expect(got).toHaveLength(want.length);
    const diffs = got.map((w, i) => Math.abs(w.start - want[i]!));
    const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    const sorted = [...diffs].sort((a, b) => a - b);
    writeFileSync(join(OUT, "sync-report.json"), JSON.stringify({ words: got.length, meanOffset: mean, median: sorted[Math.floor(sorted.length / 2)], p90: sorted[Math.floor(sorted.length * 0.9)], heard: heard.map((h) => h.word).join(" ") }, null, 2));
    expect(mean, `mean offset ${mean.toFixed(3)} s`).toBeLessThan(0.15);
    expect(sorted[Math.floor(sorted.length * 0.9)]!, "90th percentile").toBeLessThan(0.3);
    // the words themselves came through
    expect(heard.map((h) => h.word).join(" ")).toMatch(/evergreen terrace/);
    // music is heard before the narration starts (after its 1 s fade in)
    const pre = samples.subarray(Math.round(1.05 * sampleRate), Math.round(1.45 * sampleRate));
    const rms = Math.sqrt(pre.reduce((a, v) => a + v * v, 0) / pre.length);
    expect(20 * Math.log10(rms), "music before narration (dBFS)").toBeGreaterThan(-40);
  }, 300_000);

  it("VISUALS: the middle of every scene shows its own photo", () => {
    const file = ctx.files["9:16"]!;
    const { width, height } = CANVAS_1080["9:16"];
    const W = 108, H = 192;
    const sources = ctx.fx.photos.slice(0, 6).map((p) => ({ id: p.row.id, gray: smallGray(decodeCover(p.file, width, height)) }));
    const starts = sceneStarts(ctx.plan);
    for (const s of ctx.plan.scenes) {
      const mid = starts.get(s.id)! + s.duration / 2;
      const frame = smallGray({ width: W, height: H, data: frameAt(file, mid, W, H) });
      const scores = sources.map((src) => ({ id: src.id, v: ssim(frame, src.gray) }));
      const best = scores.sort((a, b) => b.v - a.v)[0]!;
      expect(best.id, `scene ${s.id} at ${mid.toFixed(1)} s`).toBe(s.assetId);
    }
  });

  it("CAPTIONS: the spoken word is highlighted while it is spoken, and nothing shows between lines", () => {
    const file = ctx.files["9:16"]!;
    const base = narrationStart(ctx.plan);
    // count highlight-coloured pixels in the caption band at time t
    const magenta = (t: number) => {
      const buf = ff(["-ss", t.toFixed(3), "-i", file, "-frames:v", "1", "-vf", "crop=1080:420:0:1380,scale=270:105", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"]);
      let n = 0;
      for (let i = 0; i < buf.length; i += 3) if (buf[i]! > 190 && buf[i + 1]! < 90 && buf[i + 2]! > 190) n++;
      return n;
    };
    let shown = 0, checked = 0;
    for (const cue of ctx.plan.captions!.cues) {
      for (const [a, b] of cue.words!.filter((_, i) => i % 2 === 0)) {
        if (b - a < 0.18) continue;
        checked++;
        if (magenta(base + (a + b) / 2) > 15) shown++;
      }
    }
    expect(checked).toBeGreaterThan(8);
    expect(shown / checked, `${shown}/${checked} spoken words highlighted`).toBeGreaterThan(0.9);
    expect(magenta(Math.max(0.2, base - 0.6)), "before the narration").toBeLessThan(5);
    const cues = ctx.plan.captions!.cues;
    const gaps = cues.slice(1).map((c, i) => [cues[i]!.end, c.start] as const).filter(([e, s]) => s - e > 0.25);
    for (const [e, s] of gaps) expect(magenta(base + (e + s) / 2), `between lines at ${(base + (e + s) / 2).toFixed(2)} s`).toBeLessThan(5);
    for (const [name, t] of [["title", 1.2], ["overlay", 7.5], ["caption", base + cues[1]!.start + 0.4]] as const) ff(["-ss", String(t), "-i", file, "-frames:v", "1", "-vf", "scale=540:-2", join(OUT, `frame-${name}.jpg`)]);
  }, 300_000);

  it("plays in Chrome (both shapes)", async () => {
    type Page = { goto(u: string): Promise<unknown>; evaluate<T>(fn: () => Promise<T>): Promise<T> };
    const { chromium } = createRequire(import.meta.url)("playwright") as { chromium: { launch(o: object): Promise<{ newPage(): Promise<Page>; close(): Promise<void> }> } };
    const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"] });
    try {
      const page = await browser.newPage();
      const html = join(OUT, "player.html");
      writeFileSync(html, `<!doctype html>${Object.values(ctx.files).map((f) => `<video src="${f.split("/").pop()}" muted playsinline></video>`).join("")}`);
      await page.goto(`file://${html}`);
      const res = await page.evaluate(async () => Promise.all([...document.querySelectorAll("video")].map(async (v) => { await v.play(); await new Promise((r) => setTimeout(r, 1500)); return { w: v.videoWidth, h: v.videoHeight, t: v.currentTime, err: v.error?.message ?? null }; })));
      expect(res.map((r) => [r.w, r.h])).toEqual([[1080, 1920], [1080, 1350]]);
      for (const r of res) { expect(r.err).toBeNull(); expect(r.t).toBeGreaterThan(0.8); }
    } finally { await browser.close(); }
  }, 120_000);
});
