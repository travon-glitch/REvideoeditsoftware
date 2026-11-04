#!/usr/bin/env node
/*
 * Nightly backup of every stored file (Supabase database backups do NOT include Storage).
 * Mirrors the six private buckets into a local folder; files already copied (same size) are skipped,
 * so nightly runs only download what's new. Copy that folder to your backup storage afterwards
 * (or point BACKUP_DIR at a mounted backup volume).
 *
 *   NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… BACKUP_DIR=/backups/lvs-files node scripts/backup-storage.mjs
 *
 * Run it on a trusted server only (it uses the service-role key). It never deletes anything,
 * in storage or in the backup.
 */
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const out = resolve(process.env.BACKUP_DIR ?? "./storage-backup");
if (!url || !key) { console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const BUCKETS = ["listing-media", "brand-assets", "video-exports", "project-media", "ai-clips", "music-library"];

let copied = 0, skipped = 0, failed = 0, bytes = 0;

async function walk(bucket, prefix) {
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.storage.from(bucket).list(prefix, { limit: 1000, offset, sortBy: { column: "name", order: "asc" } });
    if (error) { console.error(`${bucket}/${prefix}: ${error.message}`); failed++; return; }
    for (const item of data ?? []) {
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      if (!item.id) { await walk(bucket, path); continue; } // a folder
      const target = resolve(out, bucket, path);
      if (!target.startsWith(out + sep)) { failed++; continue; } // never write outside the backup folder
      const size = Number(item.metadata?.size ?? -1);
      try { if (statSync(target).size === size) { skipped++; continue; } } catch { /* not copied yet */ }
      const { data: blob, error: e } = await db.storage.from(bucket).download(path);
      if (e || !blob) { console.error(`${bucket}/${path}: ${e?.message ?? "download failed"}`); failed++; continue; }
      mkdirSync(dirname(target), { recursive: true });
      const buf = Buffer.from(await blob.arrayBuffer());
      writeFileSync(target, buf);
      copied++; bytes += buf.length;
    }
    if (!data || data.length < 1000) return;
  }
}

const started = Date.now();
for (const b of BUCKETS) await walk(b, "");
console.log(JSON.stringify({ event: "lvs.storage_backup", folder: join(out), copied, skipped, failed, megabytes: Math.round(bytes / 1e6), seconds: Math.round((Date.now() - started) / 1000) }));
process.exit(failed ? 2 : 0);
