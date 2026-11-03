/*
 * STAGE 9 ACCEPTANCE — Automatic AI Video Director.
 *
 *  "Upload 20 photographs with verified listing details. Generate a storyboard.
 *   Confirm it contains valid image references and video instructions.
 *   Render the actual video using the storyboard."
 *
 *  Photos: the two real building exteriors (OpenCV samples, Apache-2.0) + 18 distinct
 *  room images, each sent as the app sends them (480-px JPEG previews, labelled P01…P20).
 *
 *  Claude: with ANTHROPIC_API_KEY set, the REAL Claude API is called (model from
 *  LVS_DIRECTOR_MODEL, default claude-opus-5-5) through the same request builders the
 *  app uses. Without a key, a SIMULATED Claude response is used (clearly labelled) that
 *  also contains invented claims, to prove the fact checker removes them.
 *
 *  Then: the storyboard is compiled with the app's compiler, every image reference and
 *  instruction is checked, the FableCut document is validated, and the real render
 *  worker renders the video. The MP4 is checked and its scenes are matched back to the
 *  photos the storyboard chose, in order.
 *
 * Run with: npm run test:render -w @lvs/web
 */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { getStudioMove } from "@lvs/camera-presets";
import { DEFAULT_CHROME_WRAPPER, allowedAssetsFor, checkRenderDocument, processJob, probe, type AssetRow, type JobDeps } from "@lvs/render-worker";
import { frameAt, smallGray, ssim, decodeCover } from "@lvs/ai-motion";
import { claudeCaller, costCents, isDirectorModel, runDirector, type CallClaude, type DirectorImage } from "@/lib/director/claude";
import { compileStoryboard, photoRefs } from "@/lib/director/compile";
import { checkClaim, verifiedFacts } from "@/lib/director/facts";
import { ROOM_TYPES, type PhotoAnalysis, type RoomType, type Storyboard } from "@/lib/director/schema";
import { CANVAS_1080, MAX_SCENE_SECONDS, MIN_SCENE_SECONDS, composeDocument, planSchema, sceneStarts, totalDuration } from "@/lib/video/plan";
import { validateFableCutDocument } from "@/lib/video/validate-document";
import type { ListingRow } from "@/lib/database.types";

const hasTools = spawnSync("ffmpeg", ["-version"]).status === 0 && existsSync("/usr/bin/google-chrome");
process.env.LVS_CHROME_BIN ??= process.env.LVS_TEST_CHROME ?? "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome";
const OUT = join(__dirname, "..", "..", "test-output", "director");
const FIX = join(__dirname, "..", "fixtures");
const LIVE = !!process.env.ANTHROPIC_API_KEY;
const MODEL = isDirectorModel(process.env.LVS_DIRECTOR_MODEL) ? process.env.LVS_DIRECTOR_MODEL : "claude-opus-5-5";
const org = randomUUID(), listingId = randomUUID();

/** Verified listing details, as an agent enters them. */
const listing = {
  address_line: "742 Evergreen Terrace", city: "Springfield", state: "OR", price: 525000, bedrooms: 4, bathrooms: 2.5, square_feet: 2150,
  property_type: "single_family", status: "for_sale", agent_name: "Alice Agent", brokerage: "Acme Realty", contact_phone: "555-0100",
  contact_email: "alice@acme.test", description: "Updated kitchen with quartz counters. Wood-burning fireplace in the living room. Fenced backyard.",
  open_house_date: "2026-11-15", open_house_start: "13:00", open_house_end: "15:00",
} as unknown as ListingRow;
const ROOMS: RoomType[] = ["exterior", "exterior", "living_room", "kitchen", "dining_area", "bedroom", "bedroom", "bedroom", "bathroom", "bathroom",
  "living_room", "kitchen", "basement", "garage", "backyard", "patio", "pool", "bedroom", "other", "exterior"];

interface Photo { row: AssetRow; file: string; thumb: string; width: number; height: number; room: RoomType }
const photos: Photo[] = [];

function makePhotos() {
  mkdirSync(join(OUT, "photos"), { recursive: true });
  for (let i = 0; i < 20; i++) {
    const id = randomUUID();
    let file: string, width: number, height: number;
    if (i < 2) {
      file = join(FIX, i === 0 ? "opencv-building.jpg" : "opencv-home.jpg"); [width, height] = i === 0 ? [512, 384] : [868, 600];
    } else {
      [width, height] = [1600, 1200];
      file = join(OUT, "photos", `${id}.jpg`);
      const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `color=c=0x445566:s=${width}x${height}`, "-frames:v", "1",
        "-vf", `hue=h=${(i * 41) % 360}:s=2.4,drawgrid=w=200:h=200:t=5:c=white@0.4,drawbox=x=${(i * 97) % 1200}:y=${(i * 61) % 800}:w=360:h=360:c=0x${((i * 2654435761) >>> 8 & 0xffffff).toString(16).padStart(6, "0")}:t=fill,drawtext=text='${ROOMS[i]!.replace("_", " ")} ${i + 1}':fontsize=110:fontcolor=white:x=60:y=60`,
        "-q:v", "3", file]);
      if (r.status !== 0) throw new Error(String(r.stderr));
    }
    // the app's 480-px preview (what is sent to Claude)
    const thumb = join(OUT, "photos", `${id}.thumb.jpg`);
    spawnSync("ffmpeg", ["-v", "error", "-y", "-i", file, "-vf", "scale='min(480,iw)':-2", "-q:v", "4", thumb]);
    photos.push({ file, thumb, width, height, room: ROOMS[i]!, row: { id, organization_id: org, listing_id: listingId, project_id: null, kind: "photo", bucket: "listing-media", storage_path: `${org}/listings/${listingId}/${id}.jpg` } });
  }
}

/** A simulated Claude (used only when no API key is set). Includes invented claims on purpose. */
function simulatedClaude(): CallClaude {
  let n = 0;
  return async (params) => {
    n++;
    const refs = photoRefs(photos.map((p) => p.row.id)).map((r) => r.ref);
    const body: PhotoAnalysis | Storyboard = n === 1 ? {
      photos: refs.map((ref, i) => ({ ref, room_type: photos[i]!.room, description: `A ${photos[i]!.room.replace("_", " ")}.`, visible_features: [], quality: i === 0 ? 9 : 7, opener_score: i === 0 ? 10 : 3, suggested_move: "push_in" as const })),
      property_summary: "A two-storey home with outdoor spaces.",
    } : {
      title: "742 Evergreen Terrace — a guided tour", opening_photo: "P01",
      scenes: ["P01", "P03", "P04", "P05", "P06", "P09", "P11", "P15", "P16", "P17", "P20"].map((photo, i) => ({
        photo, seconds: [4, 3.5, 3.5, 3, 3, 3, 3, 3.5, 3, 3.5, 4.5][i]!, camera_move: (["push_in", "truck_right", "pan_left", "orbit_left", "tilt_up", "push_in", "truck_left", "pull_out", "pan_right", "drone_reveal", "pull_out"] as const)[i]!,
        intensity: "gentle" as const, transition: (i % 3 === 2 ? "wipe" : "fade") as "fade" | "wipe", reason: `Shows the ${photos[Number(photo.slice(1)) - 1]!.room.replace("_", " ")}.`,
      })),
      text_overlays: [
        { scene: 0, text: "742 Evergreen Terrace\nSpringfield, OR", style: "title", position: "bottom", kind: "hook", fact_keys: ["address", "city"] },
        { scene: 1, text: "Living room with a wood-burning fireplace", style: "caption", position: "bottom", kind: "room_label", fact_keys: ["description"] },
        { scene: 2, text: "Updated kitchen · quartz counters", style: "caption", position: "bottom", kind: "highlight", fact_keys: ["description"] },
        { scene: 4, text: "4 bedrooms · 2.5 baths", style: "banner", position: "bottom", kind: "fact", fact_keys: ["bedrooms", "bathrooms"] },
        { scene: 6, text: "2,150 sq ft · $525,000", style: "caption", position: "bottom", kind: "fact", fact_keys: ["square_feet", "price"] },
        { scene: 7, text: "Brand-new roof in 2024", style: "caption", position: "bottom", kind: "highlight", fact_keys: [] },
        { scene: 9, text: "Sparkling pool", style: "caption", position: "bottom", kind: "room_label", fact_keys: [] },
        { scene: 9, text: "Ocean views from the deck", style: "caption", position: "top", kind: "highlight", fact_keys: [] },
      ],
      music_mood: "warm", call_to_action: "Open house Sun, Nov 15 · Call Alice Agent 555-0100",
      highlights: ["4 bedrooms, 2.5 baths", "Wood-burning fireplace", "Ocean views"],
      captions: { instagram: "Just listed: 742 Evergreen Terrace, Springfield, OR — $525,000.", facebook: "Open house Sun, Nov 15, 1:00 PM – 3:00 PM.", short: "4 bd · 2.5 ba · $525,000" },
    };
    return { id: `sim_${n}`, type: "message", role: "assistant", model: params.model, stop_reason: "end_turn", stop_sequence: null, stop_details: null,
      content: [{ type: "text", text: JSON.stringify(body), citations: null }],
      usage: { input_tokens: n === 1 ? 9800 : 6200, output_tokens: n === 1 ? 2400 : 1900, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } as never;
  };
}

describe.skipIf(!hasTools)(`Stage 9 acceptance (${LIVE ? `LIVE Claude, ${MODEL}` : "SIMULATED Claude response — set ANTHROPIC_API_KEY for a live run"})`, () => {
  const state: { plan?: ReturnType<typeof compileStoryboard>["plan"]; refs?: ReturnType<typeof photoRefs>; file?: string } = {};

  it("20 photos + verified listing details → Claude storyboard → valid image references and video instructions", async () => {
    makePhotos();
    const facts = verifiedFacts(listing);
    const refs = photoRefs(photos.map((p) => p.row.id));
    const images: DirectorImage[] = photos.map((p, i) => ({ ref: refs[i]!.ref, mediaType: "image/jpeg", base64: readFileSync(p.thumb).toString("base64") }));
    expect(images).toHaveLength(20);
    const call = LIVE
      ? claudeCaller(new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, baseURL: process.env.LVS_ANTHROPIC_BASE_URL ?? "https://api.anthropic.com", timeout: 10 * 60_000 }))
      : simulatedClaude();
    const result = await runDirector(call, { model: MODEL, style: "listing_tour", facts, images });
    writeFileSync(join(OUT, `director-output-${LIVE ? "live" : "simulated"}.json`), JSON.stringify(result, null, 2));

    // photo interpretation
    expect(result.analysis.photos.length).toBeGreaterThanOrEqual(18);
    for (const p of result.analysis.photos) {
      expect(refs.some((r) => r.ref === p.ref), p.ref).toBe(true);
      expect(ROOM_TYPES).toContain(p.room_type);
    }

    // compile + every reference / instruction checked
    const compiled = compileStoryboard({ storyboard: result.storyboard, analysis: result.analysis, photos: refs, facts, style: "listing_tour" });
    const { plan } = compiled;
    expect(planSchema.safeParse(plan).success).toBe(true);
    const uploaded = new Set(photos.map((p) => p.row.id));
    expect(plan.scenes.length).toBeGreaterThanOrEqual(5);
    for (const s of plan.scenes) {
      expect(uploaded.has(s.assetId), "scene uses an uploaded photo").toBe(true);
      expect(s.duration).toBeGreaterThanOrEqual(MIN_SCENE_SECONDS);
      expect(s.duration).toBeLessThanOrEqual(MAX_SCENE_SECONDS);
      expect(getStudioMove(s.camera!.move)?.requiresAI, "Standard camera move").toBe(false);
    }
    expect(new Set(plan.scenes.map((s) => s.assetId)).size).toBe(plan.scenes.length);
    const opener = refs.find((r) => r.ref === result.storyboard.opening_photo.toUpperCase());
    if (opener) expect(plan.scenes[0]!.assetId).toBe(opener.assetId);
    const rooms = new Set(result.analysis.photos.map((p) => p.room_type));
    for (const t of plan.texts) expect(checkClaim(t.text, facts, rooms).ok, t.text).toBe(true);
    expect(compiled.director.callToAction ?? "").not.toBe("");
    if (!LIVE) {
      // the simulated response invented a roof, ocean views and orbit/drone moves: all handled
      const all = plan.texts.map((t) => t.text).join("\n");
      expect(all).not.toMatch(/roof|Ocean/);
      expect(all).toMatch(/Sparkling pool/);   // grounded: a pool photo exists
      expect(compiled.director.highlights).not.toContain("Ocean views");
      expect(compiled.warnings.filter((w) => w.kind === "camera_changed")).toHaveLength(2);
    }
    expect(costCents(MODEL, result.usage)).toBeGreaterThan(0);
    state.plan = plan; state.refs = refs;
  }, 600_000);

  it("renders the actual video from the storyboard (real FableCut worker), and it matches the plan", async () => {
    const plan = state.plan!;
    const info = photos.map((p) => ({ id: p.row.id, storage_path: p.row.storage_path, file_name: "p.jpg", width: p.width, height: p.height }));
    const doc = composeDocument({ plan, title: "AI Director video", photos: info, music: [], brand: { primary_color: "#1D4ED8", heading_font: "Montserrat", body_font: "Inter" } });
    expect(validateFableCutDocument(doc)).toEqual({ ok: true });
    expect(checkRenderDocument(doc, allowedAssetsFor({ id: "p", organization_id: org, listing_id: listingId, title: "t" }, photos.map((p) => p.row))).length).toBe(plan.scenes.length);
    const projectId = randomUUID();
    const stored = new Map<string, Uint8Array>();
    const byPath = new Map(photos.map((p) => [p.row.storage_path, p.file]));
    const deps: JobDeps = {
      chrome: DEFAULT_CHROME_WRAPPER, timeoutMs: 15 * 60_000,
      async loadProject(id) { return id === projectId ? { id, organization_id: org, listing_id: listingId, title: "t" } : null; },
      async loadAssets(ids) { return photos.map((p) => p.row).filter((r) => ids.includes(r.id)); },
      async download(_b, path) { return new Uint8Array(readFileSync(byPath.get(path)!)); },
      async upload(b, path, bytes) { stored.set(`${b}/${path}`, bytes); },
      async recordOutput() { return randomUUID(); }, async progress() {}, async finish() {},
    };
    const r = await processJob({ id: randomUUID(), organization_id: org, project_id: projectId, aspect: plan.aspect, document: doc }, deps);
    expect(r.error ?? "").toBe("");
    const file = join(OUT, `ai-director-${LIVE ? "live" : "simulated"}.mp4`);
    writeFileSync(file, [...stored.values()][0]!);
    state.file = file;

    const p = probe(file);
    const c = CANVAS_1080[plan.aspect];
    expect([p.width, p.height]).toEqual([c.width, c.height]);
    expect(Math.abs(p.durationSeconds - totalDuration(plan))).toBeLessThan(0.6);
    expect(spawnSync("ffmpeg", ["-v", "error", "-i", file, "-f", "null", "-"], { encoding: "utf8" }).stderr.trim()).toBe("");

    // each scene shows the photo the storyboard chose (best match among all 20 photos)
    const refImg = new Map(photos.map((ph) => [ph.row.id, smallGray(decodeCover(ph.file, c.width / 4, c.height / 4))]));
    const starts = sceneStarts(plan);
    let matched = 0;
    for (const s of plan.scenes) {
      const t = starts.get(s.id)! + s.duration * 0.45;
      const frame = smallGray({ width: 480, height: Math.round((480 * c.height) / c.width), data: frameAt(file, t, 480, Math.round((480 * c.height) / c.width)) });
      let best = "", bestScore = -1;
      for (const [id, img] of refImg) { const sc = ssim(img, frame); if (sc > bestScore) { bestScore = sc; best = id; } }
      if (best === s.assetId) matched++;
    }
    expect(matched / plan.scenes.length).toBeGreaterThanOrEqual(0.75);
  }, 1_200_000);

  it("the video plays in Chrome", async () => {
    type Page = { goto(u: string): Promise<unknown>; evaluate<T>(fn: () => Promise<T>): Promise<T> };
    const { chromium } = createRequire(import.meta.url)("playwright") as { chromium: { launch(o: object): Promise<{ newPage(): Promise<Page>; close(): Promise<void> }> } };
    const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"] });
    try {
      const page = await browser.newPage();
      const name = state.file!.split("/").pop()!;
      writeFileSync(join(OUT, "player.html"), `<!doctype html><video id="v" src="${name}" muted playsinline></video>`);
      await page.goto(`file://${join(OUT, "player.html")}`);
      const res = await page.evaluate(async () => {
        const v = document.getElementById("v") as HTMLVideoElement;
        await v.play(); await new Promise((r) => setTimeout(r, 1500));
        return { w: v.videoWidth, t: v.currentTime, err: v.error?.message ?? null };
      });
      expect(res.err).toBeNull();
      expect(res.w).toBeGreaterThan(0);
      expect(res.t).toBeGreaterThan(0.8);
    } finally { await browser.close(); }
  }, 60_000);
});
