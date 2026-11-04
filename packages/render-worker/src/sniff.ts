/*
 * What a media file really is, from its first bytes — never from its name or the type the browser
 * declared. FFmpeg and Chrome pick a decoder by looking at the content, so a file uploaded as
 * "audio/mpeg" that is really a playlist or a script must be refused before they ever see it.
 */
export type MediaKind = "jpeg" | "png" | "webp" | "mp3" | "mp4" | "wav" | "aac";

const IMAGE: readonly MediaKind[] = ["jpeg", "png", "webp"];
const AUDIO: readonly MediaKind[] = ["mp3", "mp4", "wav", "aac"];

export function sniffMedia(b: Uint8Array): MediaKind | null {
  const at = (i: number, ...v: number[]) => v.every((x, k) => b[i + k] === x);
  const str = (i: number, s: string) => at(i, ...[...s].map((c) => c.charCodeAt(0)));
  if (b.length < 12) return null;
  if (at(0, 0xff, 0xd8, 0xff)) return "jpeg";
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "png";
  if (str(0, "RIFF") && str(8, "WEBP")) return "webp";
  if (str(0, "RIFF") && str(8, "WAVE")) return "wav";
  if (str(4, "ftyp")) {
    // MP4 / M4A / MOV family (ISO base media); HEIC and AVIF images share the container: not media we use
    const brand = String.fromCharCode(b[8]!, b[9]!, b[10]!, b[11]!);
    return ["heic", "heix", "hevc", "heim", "heis", "mif1", "msf1", "avif", "avis"].includes(brand) ? null : "mp4";
  }
  if (str(0, "ID3")) return "mp3";
  // MPEG audio frame sync: 11 set bits; layer bits 01/10/11 = MP3/MP2/MP1, 00 = ADTS AAC
  if (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0) return (b[1]! & 0x06) === 0 ? "aac" : "mp3";
  return null;
}

export function isImageKind(k: MediaKind | null): boolean { return !!k && IMAGE.includes(k); }
export function isAudioKind(k: MediaKind | null): boolean { return !!k && AUDIO.includes(k); }

/** FFmpeg demuxer to force for a sniffed kind (so it never guesses from content). */
export const FFMPEG_FORMAT: Record<MediaKind, string> = {
  jpeg: "jpeg_pipe", png: "png_pipe", webp: "webp_pipe", mp3: "mp3", mp4: "mov", wav: "wav", aac: "aac",
};

/** What a stored file must be, from its extension (the names the app gives files). */
export function expectedKinds(fileName: string): readonly MediaKind[] | null {
  const ext = /\.([a-z0-9]+)$/i.exec(fileName)?.[1]?.toLowerCase();
  switch (ext) {
    case "jpg": case "jpeg": case "png": case "webp": return IMAGE;
    case "mp3": case "m4a": case "aac": case "wav": return AUDIO;
    case "mp4": return ["mp4"];
    default: return null;
  }
}
