import "server-only";
/*
 * Licensed music library.
 *  - Built-in tracks: original music composed by this app's own code
 *    (tools/music/generate.mjs → assets/music/*.m4a). The company owns it, so it
 *    is cleared for commercial use. Added to each company's library on first use.
 *  - Uploaded tracks: added by admins with licence details; offered only after an
 *    admin verifies commercial-use rights.
 */
import { randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { BUCKETS } from "@/lib/storage";

type Db = Awaited<ReturnType<typeof createClient>>;

export const MUSIC_MOODS = ["elegant", "calm", "upbeat", "warm", "inspiring"] as const;
export type MusicMood = (typeof MUSIC_MOODS)[number];
export const MOOD_LABELS: Record<MusicMood, string> = { elegant: "Elegant", calm: "Calm", upbeat: "Upbeat", warm: "Warm", inspiring: "Inspiring" };

export const BUILTIN_TRACKS = [
  { key: "elegant-evening", title: "Elegant Evening", mood: "elegant", bpm: 72 },
  { key: "bright-open-house", title: "Bright Open House", mood: "upbeat", bpm: 116 },
  { key: "calm-morning", title: "Calm Morning", mood: "calm", bpm: 80 },
  { key: "warm-welcome", title: "Warm Welcome", mood: "warm", bpm: 96 },
  { key: "inspiring-skyline", title: "Inspiring Skyline", mood: "inspiring", bpm: 104 },
] as const satisfies readonly { key: string; title: string; mood: MusicMood; bpm: number }[];
export const BUILTIN_LICENSE = "Original music composed by this app's own code (tools/music/generate.mjs). Owned by the company; cleared for commercial use.";

export function builtinMusicDir(): string {
  return process.env.LVS_MUSIC_DIR ?? join(process.cwd(), "assets", "music");
}

/** Adds any missing built-in tracks to the company's library (idempotent, service role). */
export async function ensureBuiltinMusic(orgId: string): Promise<void> {
  const admin = createAdminClient();
  const { data: have } = await admin.from("music_tracks").select("builtin_key").eq("organization_id", orgId).not("builtin_key", "is", null);
  const existing = new Set((have ?? []).map((h) => h.builtin_key));
  for (const t of BUILTIN_TRACKS) {
    if (existing.has(t.key)) continue;
    const file = join(builtinMusicDir(), `${t.key}.m4a`);
    if (!existsSync(file)) continue;
    const bytes = readFileSync(file);
    const path = `${orgId}/music/${randomUUID()}.m4a`;
    const { error: ue } = await admin.storage.from(BUCKETS.musicLibrary).upload(path, bytes, { contentType: "audio/mp4", upsert: false });
    if (ue) continue;
    const { data: asset } = await admin.from("media_assets").insert({
      organization_id: orgId, kind: "audio", bucket: BUCKETS.musicLibrary, storage_path: path, file_name: `${t.title}.m4a`,
      mime_type: "audio/mp4", size_bytes: bytes.length, duration_seconds: 75,
    }).select("id").single();
    if (!asset) continue;
    await admin.from("music_tracks").insert({
      organization_id: orgId, asset_id: asset.id, title: t.title, artist: "Built-in", mood: t.mood, bpm: t.bpm,
      license_type: "original_builtin", license_details: BUILTIN_LICENSE, commercial_use_verified: true, verified_at: new Date().toISOString(), builtin_key: t.key,
    });
  }
}

export interface LibraryTrack { assetId: string; title: string; mood: MusicMood; storage_path: string; file_name: string; duration_seconds: number | null; builtin: boolean }

/** Tracks cleared for commercial use (the only ones offered or picked automatically). RLS applies. */
export async function verifiedTracks(db: Db): Promise<LibraryTrack[]> {
  const { data: tracks } = await db.from("music_tracks").select("asset_id,title,mood,license_type").eq("commercial_use_verified", true).order("created_at");
  if (!tracks?.length) return [];
  const { data: assets } = await db.from("media_assets").select("id,storage_path,file_name,duration_seconds").in("id", tracks.map((t) => t.asset_id));
  const byId = new Map((assets ?? []).map((a) => [a.id, a]));
  return tracks.flatMap((t) => {
    const a = byId.get(t.asset_id);
    return a ? [{ assetId: a.id, title: t.title, mood: t.mood as MusicMood, storage_path: a.storage_path, file_name: a.file_name,
      duration_seconds: a.duration_seconds == null ? null : Number(a.duration_seconds), builtin: t.license_type === "original_builtin" }] : [];
  });
}

/** A verified track for the mood (falls back to any verified track, or none). */
export function pickTrack(tracks: LibraryTrack[], mood: MusicMood, avoid: Set<string> = new Set()): LibraryTrack | null {
  return tracks.find((t) => t.mood === mood && !avoid.has(t.assetId)) ?? tracks.find((t) => t.mood === mood)
    ?? tracks.find((t) => !avoid.has(t.assetId)) ?? tracks[0] ?? null;
}

/** The brand kit logo as a media asset the render worker can verify (registered once, service role). */
export async function ensureLogoAsset(orgId: string, logoPath: string | null | undefined): Promise<{ id: string; storage_path: string; width: number | null; height: number | null } | null> {
  if (!logoPath || !logoPath.startsWith(`${orgId}/`)) return null;
  const admin = createAdminClient();
  const { data: found } = await admin.from("media_assets").select("id,storage_path,width,height").eq("organization_id", orgId).eq("bucket", BUCKETS.brandAssets).eq("storage_path", logoPath).maybeSingle();
  if (found) return found;
  const ext = logoPath.split(".").pop()?.toLowerCase();
  const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  const { data } = await admin.from("media_assets").insert({
    organization_id: orgId, kind: "logo", bucket: BUCKETS.brandAssets, storage_path: logoPath, file_name: `logo.${ext}`, mime_type: mime, size_bytes: 1,
  }).select("id,storage_path,width,height").single();
  return data ?? null;
}
