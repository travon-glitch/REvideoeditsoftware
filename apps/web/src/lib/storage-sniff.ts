import "server-only";
/*
 * Upload check: reads the first bytes of a file the browser just uploaded and says what it really is.
 * The browser's declared type and the file name can't be trusted — FFmpeg and Chrome decide by content.
 */
import { sniffMedia, type MediaKind } from "@lvs/render-worker/sniff";
import type { createClient } from "@/lib/supabase/server";

type Db = Awaited<ReturnType<typeof createClient>>;

export async function sniffStoredFile(db: Db, bucket: string, path: string): Promise<MediaKind | null> {
  try {
    const { data } = await db.storage.from(bucket).createSignedUrl(path, 60);
    if (!data?.signedUrl) return null;
    const res = await fetch(data.signedUrl, { headers: { Range: "bytes=0-63" }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    return sniffMedia(new Uint8Array(await res.arrayBuffer()).slice(0, 64));
  } catch {
    return null;
  }
}

export const PHOTO_KINDS: readonly MediaKind[] = ["jpeg", "png", "webp"];
export const AUDIO_KINDS: readonly MediaKind[] = ["mp3", "mp4", "wav", "aac"];
