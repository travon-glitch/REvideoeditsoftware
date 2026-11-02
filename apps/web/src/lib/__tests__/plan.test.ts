import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { checkRenderDocument, allowedAssetsFor } from "@lvs/render-worker";
import {
  CANVAS_1080, FIRST_SCENE, LAST_SCENE, composeDocument, fitToDuration, initialPlan, planSchema, resolveScene, sceneStarts, totalDuration,
  type EditPlan,
} from "@/lib/video/plan";
import { planUsesOnly } from "@/lib/video/editor-data";
import { validateFableCutDocument } from "@/lib/video/validate-document";

const org = randomUUID(), listing = randomUUID(), project = randomUUID();
const photos = Array.from({ length: 15 }, () => {
  const id = randomUUID();
  return { id, storage_path: `${org}/listings/${listing}/${id}.jpg`, file_name: `${id}.jpg`, width: 4000, height: 3000 };
});
const musicId = randomUUID();
const music = [{ id: musicId, storage_path: `${org}/projects/${project}/${musicId}.m4a`, file_name: "song.m4a", duration_seconds: 20 }];
const base = () => initialPlan({
  photos, coverId: photos[4]!.id, aspect: "16:9", address: "742 Evergreen Terrace", cityState: "Springfield, OR",
  priceLine: "$525,000", specsLine: "4 bd", openHouse: "Sun, Nov 15 · 1:00 PM", agentLine: "Alice · Acme", contactLine: "555-0100",
});

describe("automatic first timeline", () => {
  it("uses every photo, main photo first, and lasts 30 seconds", () => {
    const p = base();
    expect(p.scenes).toHaveLength(15);
    expect(p.scenes[0]!.assetId).toBe(photos[4]!.id);
    expect(totalDuration(p)).toBe(30);
    expect(new Set(p.scenes.map((s) => s.move)).size).toBeGreaterThan(1);
    expect(planSchema.safeParse(p).success).toBe(true);
  });

  it("pins the address to the first scene and the agent card to the last scene", () => {
    const p = base();
    expect(p.texts.find((t) => t.id === "t_address")?.sceneId).toBe(FIRST_SCENE);
    expect(p.texts.find((t) => t.id === "t_outro")?.sceneId).toBe(LAST_SCENE);
    const reordered: EditPlan = { ...p, scenes: [...p.scenes].reverse() };
    expect(resolveScene(reordered, LAST_SCENE)!.id).toBe(p.scenes[0]!.id);
  });

  it("fits any number of scenes to 30 seconds within allowed lengths", () => {
    for (const n of [5, 7, 12, 20]) {
      const p = fitToDuration({ scenes: photos.slice(0, Math.min(n, 15)).concat(photos.slice(0, Math.max(0, n - 15))).map((x, i) => ({ id: `s${i}`, assetId: x.id, move: "still", duration: 3 })) });
      expect(Math.abs(totalDuration(p) - 30)).toBeLessThan(0.05);
    }
    // 30 scenes can't go below the 1.5 s minimum, so that video is 45 s
    const many = fitToDuration({ scenes: Array.from({ length: 30 }, (_, i) => ({ id: `s${i}`, assetId: photos[i % 15]!.id, move: "still", duration: 3 })) });
    expect(totalDuration(many)).toBe(45);
  });
});

describe("plan → FableCut document", () => {
  it("is accepted by FableCut's own validator, in all three formats", () => {
    for (const aspect of ["16:9", "9:16", "1:1"] as const) {
      const doc = composeDocument({ plan: { ...base(), music: { assetId: musicId, volume: 0.7, fadeOut: true } }, aspect, title: "t", photos, music, brand: null });
      expect([doc.width, doc.height]).toEqual([CANVAS_1080[aspect].width, CANVAS_1080[aspect].height]);
      expect(validateFableCutDocument(doc)).toEqual({ ok: true });
    }
  });

  it("follows the edits: order, camera move, text and music", () => {
    const p = base();
    p.scenes = [p.scenes[14]!, ...p.scenes.slice(0, 14)];
    p.scenes[1] = { ...p.scenes[1]!, move: "still", duration: 4 };
    p.texts.push({ id: "custom", text: "Hello", sceneId: p.scenes[1]!.id, style: "banner", position: "top", duration: 2 });
    p.music = { assetId: musicId, volume: 0.5, fadeOut: true };
    const doc = composeDocument({ plan: p, title: "t", photos, music, brand: { primary_color: "#FF00FF", heading_font: "Anton", body_font: "Inter" } }) as {
      clips: { id: string; kind: string; start: number; duration: number; mediaId: string | null; keyframes?: unknown; props: Record<string, unknown> }[];
      media: { id: string; assetId: string }[];
    };
    const images = doc.clips.filter((c) => c.kind === "image");
    const assetOf = (c: { mediaId: string | null }) => doc.media.find((m) => m.id === c.mediaId)!.assetId;
    expect(assetOf(images[0]!)).toBe(p.scenes[0]!.assetId);
    expect(images[1]!.keyframes).toBeUndefined();          // still
    expect(images[2]!.keyframes).toBeDefined();
    expect(images[2]!.start).toBe(6);                       // 2 + 4
    const custom = doc.clips.find((c) => c.id === "c_text_custom")!;
    expect(custom).toMatchObject({ start: 2, duration: 2 });
    expect(custom.props).toMatchObject({ text: "Hello", bgColor: "#FF00FF" });
    const audio = doc.clips.find((c) => c.kind === "audio")!;
    expect(audio.duration).toBe(20);                        // music shorter than the video
    expect(sceneStarts(p).get(p.scenes[2]!.id)).toBe(6);
  });

  it("refuses photos and music that aren't the project's own", () => {
    const p = base();
    p.scenes[0] = { ...p.scenes[0]!, assetId: randomUUID() };
    expect(planUsesOnly(p, { photos, music })).toMatch(/isn't part of this listing/);
    expect(() => composeDocument({ plan: p, title: "t", photos, music, brand: null })).toThrow(/not available/);
    const q = base();
    q.music = { assetId: randomUUID(), volume: 1, fadeOut: false };
    expect(planUsesOnly(q, { photos, music })).toMatch(/music/);
  });

  it("rejects invalid plans", () => {
    const p = base();
    expect(planSchema.safeParse({ ...p, scenes: [] }).success).toBe(false);
    expect(planSchema.safeParse({ ...p, scenes: [{ ...p.scenes[0]!, duration: 60 }] }).success).toBe(false);
    expect(planSchema.safeParse({ ...p, scenes: [{ ...p.scenes[0]!, move: "barrel_roll" }] }).success).toBe(false);
    expect(planSchema.safeParse({ ...p, texts: [{ ...p.texts[0]!, sceneId: "nope" }] }).success).toBe(false);
    expect(planSchema.safeParse({ ...p, aspect: "4:5" }).success).toBe(false);
  });
});

describe("render worker file checks", () => {
  const projectInfo = { id: project, organization_id: org, listing_id: listing, title: "t" };
  const rows = [
    ...photos.map((p) => ({ id: p.id, organization_id: org, listing_id: listing, project_id: null, kind: "photo", bucket: "listing-media", storage_path: p.storage_path })),
    { id: musicId, organization_id: org, listing_id: null, project_id: project, kind: "audio", bucket: "project-media", storage_path: music[0]!.storage_path },
  ];

  it("accepts the project's own photos and music", () => {
    const doc = composeDocument({ plan: { ...base(), music: { assetId: musicId, volume: 1, fadeOut: false } }, title: "t", photos, music, brand: null });
    const files = checkRenderDocument(doc, allowedAssetsFor(projectInfo, rows));
    expect(files).toHaveLength(16);
  });

  it("ignores files of other companies, other listings and other projects", () => {
    const foreign = [
      { ...rows[0]!, organization_id: randomUUID() },
      { ...rows[1]!, listing_id: randomUUID() },
      { ...rows[15]!, project_id: randomUUID() },
      { ...rows[2]!, bucket: "video-exports" },
    ];
    expect(allowedAssetsFor(projectInfo, foreign)).toEqual([]);
  });

  it("blocks unsafe paths, unknown clip kinds and oversize documents", () => {
    const allowed = allowedAssetsFor(projectInfo, rows);
    const doc = () => composeDocument({ plan: base(), title: "t", photos, music, brand: null }) as Record<string, unknown> & { media: Record<string, unknown>[]; clips: Record<string, unknown>[] };
    const a = doc(); a.media[0]!.src = "/media/../../../etc/passwd";
    expect(() => checkRenderDocument(a, allowed)).toThrow(/unexpected path/);
    const b = doc(); b.media[0]!.src = "https://evil.example/x.jpg";
    expect(() => checkRenderDocument(b, allowed)).toThrow(/unexpected path/);
    const c = doc(); c.clips.push({ id: "x", kind: "comp", compId: "c", track: "V1", start: 0, duration: 1 });
    expect(() => checkRenderDocument(c, allowed)).toThrow(/not rendered/);
    const d = doc(); d.width = 1921;
    expect(() => checkRenderDocument(d, allowed)).toThrow(/even/);
    const e = doc(); e.sequences = [];
    expect(() => checkRenderDocument(e, allowed)).toThrow(/sequences/);
  });
});
