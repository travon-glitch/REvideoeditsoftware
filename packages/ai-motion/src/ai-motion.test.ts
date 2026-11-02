import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultSpec } from "@lvs/camera-presets";
import { MuapiProvider } from "./providers/muapi.ts";
import { LOCAL_DEPTH_PROVIDER, generativePrompt, parseJobInput, processGenerationJob, type GenerationDeps, type GenerationJob, type SourceAsset } from "./process-job.ts";
import { depthModelAvailable } from "./depth.ts";
import { probeVideo } from "./media.ts";
import type { AccuracyReview } from "./accuracy.ts";

const PHOTO = join(import.meta.dirname, "..", "..", "..", "apps", "web", "tests", "fixtures", "opencv-building.jpg");
const ORG = "11111111-1111-4111-8111-111111111111", LISTING = "22222222-2222-4222-8222-222222222222", ASSET = "33333333-3333-4333-8333-333333333333";
const asset: SourceAsset = { id: ASSET, organization_id: ORG, listing_id: LISTING, kind: "photo", bucket: "listing-media", storage_path: `${ORG}/listings/${LISTING}/a.jpg`, mime_type: "image/jpeg", file_name: "front.jpg" };

function fakeDeps(over: Partial<GenerationDeps> = {}) {
  const stored = new Map<string, Uint8Array>();
  const result: { finish?: Parameters<GenerationDeps["finish"]>[1]; label?: string; review?: AccuracyReview } = {};
  const deps: GenerationDeps = {
    providers: {},
    async loadAsset(id) { return id === ASSET ? asset : null; },
    async download() { return new Uint8Array(readFileSync(PHOTO)); },
    async upload(bucket, path, bytes) { stored.set(`${bucket}/${path}`, bytes); },
    async recordClip(_job, _out, review, label) { result.label = label; result.review = review; return "44444444-4444-4444-8444-444444444444"; },
    async finish(_id, o) { result.finish = o; },
    ...over,
  };
  return { deps, stored, result };
}
const job = (over: Partial<GenerationJob> = {}): GenerationJob => ({
  id: "55555555-5555-4555-8555-555555555555", organization_id: ORG, listing_id: LISTING, source_asset_id: ASSET,
  provider: LOCAL_DEPTH_PROVIDER, model: "midas", input: { spec: defaultSpec("orbit_right"), duration: 2, aspect: "16:9" }, ...over,
});

describe("job input and security", () => {
  it("rejects bad input", () => {
    expect(() => parseJobInput({ spec: { move: "barrel_roll" }, duration: 3, aspect: "16:9" })).toThrow();
    expect(() => parseJobInput({ spec: defaultSpec("zoom"), duration: 30, aspect: "16:9" })).toThrow(/2 to 10/);
    expect(() => parseJobInput({ spec: defaultSpec("zoom"), duration: 3, aspect: "4:3" })).toThrow(/shape/);
  });

  it("refuses a photo from another listing or company", async () => {
    for (const bad of [{ ...asset, listing_id: "66666666-6666-4666-8666-666666666666" }, { ...asset, organization_id: "77777777-7777-4777-8777-777777777777" }, { ...asset, kind: "ai_clip" }]) {
      const { deps, stored, result } = fakeDeps({ loadAsset: async () => bad });
      const r = await processGenerationJob(job(), deps);
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/isn't part of this listing/);
      expect(result.finish).toEqual({ ok: false, error: expect.stringMatching(/isn't part/) });
      expect(stored.size).toBe(0);
    }
  });

  it("explains when a generative provider isn't configured", async () => {
    const { deps } = fakeDeps();
    const r = await processGenerationJob(job({ provider: "muapi" }), deps);
    expect(r.error).toMatch(/isn't set up/);
  });

  it("always asks generative models to keep the property unchanged", () => {
    for (const m of ["orbit_left", "drone_reveal", "parallax", "zoom"] as const) expect(generativePrompt(m)).toMatch(/do not add, remove or change/);
  });
});

describe("MuAPI provider (image-to-video, adapted from Open Generative AI)", () => {
  it("uploads, submits, polls and downloads", async () => {
    const calls: string[] = [];
    const fake = (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.endsWith("/upload_file")) return Response.json({ url: "https://files.example/p.jpg" });
      if (url.endsWith("/kling-v2.1-standard-i2v")) {
        const body = JSON.parse(String(init!.body));
        expect(body).toMatchObject({ image_url: "https://files.example/p.jpg", aspect_ratio: "16:9", duration: 5 });
        expect(body.prompt).toMatch(/do not add/);
        expect((init!.headers as Record<string, string>)["x-api-key"]).toBe("k");
        return Response.json({ request_id: "r1" });
      }
      if (url.includes("/predictions/r1/result")) return calls.filter((c) => c.includes("predictions")).length < 2
        ? Response.json({ status: "processing" }) : Response.json({ status: "completed", outputs: ["https://files.example/v.mp4"] });
      if (url === "https://files.example/v.mp4") return new Response(new Uint8Array([1, 2, 3]));
      return new Response("nope", { status: 404 });
    }) as typeof fetch;
    const p = new MuapiProvider({ apiKey: "k", fetch: fake, pollMs: 1 });
    const ids: string[] = [];
    const r = await p.imageToVideo({ photo: new Uint8Array([9]), mimeType: "image/jpeg", fileName: "a.jpg", prompt: generativePrompt("orbit_left"), durationSeconds: 5, aspect: "16:9", onProviderJob: (id) => { ids.push(id); } });
    expect([...r.video]).toEqual([1, 2, 3]);
    expect(r.providerJobId).toBe("r1");
    expect(ids).toEqual(["r1"]);
  });

  it("reports provider failures in plain words", async () => {
    const fake = (async (url: string) => url.endsWith("/upload_file") ? Response.json({ url: "u" })
      : url.includes("predictions") ? Response.json({ status: "failed", error: "nsfw filter" }) : Response.json({ id: "r2" })) as typeof fetch;
    await expect(new MuapiProvider({ apiKey: "k", fetch: fake, pollMs: 1 }).imageToVideo({ photo: new Uint8Array([1]), mimeType: "image/jpeg", fileName: "a", prompt: "p", durationSeconds: 5, aspect: "16:9" }))
      .rejects.toThrow(/couldn't make the video: nsfw filter/);
  });
});

describe("generative clips are reviewed against the original photo", () => {
  it("flags a clip whose picture doesn't match the property", async () => {
    // a "provider" that returns a video of something else entirely
    const dir = mkdtempSync(join(tmpdir(), "lvs-gen-"));
    const fakeVideo = join(dir, "v.mp4");
    spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=s=1280x720:d=5:r=24", "-pix_fmt", "yuv420p", fakeVideo]);
    const provider = { id: "fake", label: "Fake", model: "fake-1", imageToVideo: async () => ({ video: new Uint8Array(readFileSync(fakeVideo)), providerJobId: "x", model: "fake-1" }) };
    const { deps, stored, result } = fakeDeps({ providers: { fake: provider } });
    const r = await processGenerationJob(job({ provider: "fake", input: { spec: defaultSpec("drone_reveal"), duration: 4, aspect: "16:9" } }), deps);
    expect(r).toEqual({ ok: true });
    expect(result.label).toMatch(/Generative AI \(fake-1\)/);
    expect(result.review!.flags.map((f) => f.code)).toContain("first_frame_differs");
    const [key] = [...stored.keys()];
    expect(key).toBe(`ai-clips/${ORG}/listings/${LISTING}/55555555-5555-4555-8555-555555555555.mp4`);
  }, 60_000);
});

describe.skipIf(!depthModelAvailable())("AI depth clip (real MiDaS model)", () => {
  it("makes a real 1080p orbit clip from an exterior photo", async () => {
    const { deps, stored, result } = fakeDeps();
    const r = await processGenerationJob(job(), deps);
    expect(r).toEqual({ ok: true });
    expect(result.label).toBe("Orbit Right · AI depth");
    expect(result.review!.stretchedShare).toBeLessThan(0.05);
    const dir = mkdtempSync(join(tmpdir(), "lvs-depth-"));
    const file = join(dir, "c.mp4");
    writeFileSync(file, [...stored.values()][0]!);
    const info = probeVideo(file);
    expect([info.width, info.height, info.codec]).toEqual([1920, 1080, "h264"]);
    expect(info.durationSeconds).toBeGreaterThan(1.9);
  }, 120_000);
});
