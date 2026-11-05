import "server-only";
/*
 * AI voiceovers and transcription (Stage 12), made by the voice engine (lib/video/voice-engine.ts):
 * on this server, or on the voice service when the web app runs on Vercel.
 * Voice: Kokoro-82M (Apache-2.0) — speech recognition: Zipformer (Apache-2.0), both via sherpa-onnx.
 * The narration is stored as an ordinary project audio file (project-media, the project's folder),
 * so the editor, the render worker and storage rules treat it like uploaded music.
 */
import { randomUUID } from "node:crypto";
import { ASR_MODEL, TTS_MODEL, VOICES, alignWords, buildCues, type TimedWord, type VoiceId } from "@lvs/voice";
import type { createClient } from "@/lib/supabase/server";
import type { SessionContext } from "@/lib/auth/session";
import { BUCKETS } from "@/lib/storage";
import type { Cue, Voiceover } from "@/lib/video/plan";
import type { StoreResult } from "@/lib/video/project-store";
import type { Json } from "@/lib/database.types";
import { isAudioKind, sniffMedia, type MediaKind } from "@lvs/render-worker/sniff";
import { VoiceServiceError, voiceEngine, voiceSetupHint } from "@/lib/video/voice-engine";

import { checkNarration } from "@/lib/video/narration";

type Db = Awaited<ReturnType<typeof createClient>>;

export const VOICE_LIST = VOICES.map((v) => ({ id: v.id, name: v.name, accent: v.accent, gender: v.gender }));
export const isVoice = (v: string): v is VoiceId => VOICES.some((x) => x.id === v);

/** FFmpeg demuxer for each kind of audio the app accepts (from the file's content, never its name). */
const LISTEN_FORMAT: Partial<Record<MediaKind, "mp3" | "mov" | "wav" | "aac">> = { mp3: "mp3", mp4: "mov", wav: "wav", aac: "aac" };

export function cuesFrom(words: { text: string; start: number; end: number }[]): Cue[] {
  return buildCues(words).map((c, i) => ({
    id: `cue${i + 1}`, start: c.start, end: c.end, text: c.words.map((w) => w.text).join(" "),
    words: c.words.map((w) => [w.start, w.end] as [number, number]),
  }));
}

async function editableProject(db: Db, projectId: string) {
  const { data: access } = await db.rpc("project_access", { p_project: projectId });
  if (access !== "edit") return null;
  const { data: project } = await db.from("video_projects").select("id,listing_id,organization_id").eq("id", projectId).maybeSingle();
  return project;
}

/** A short spoken sample of the script (nothing stored). */
export async function previewVoice(input: { script: string; voice: VoiceId; speed: number }): Promise<{ wav: Uint8Array; seconds: number }> {
  return voiceEngine().preview(input.script, input.voice, input.speed);
}

export interface VoiceoverResult {
  voiceover: Voiceover;
  /** A playable link for the editor's preview. */
  url: string | null;
  cues: Cue[];
  /** Words the voice can't pronounce (skipped) and claims the listing doesn't back up. */
  unknownWords: string[];
  factWarnings: { sentence: string; reason: string }[];
}

/**
 * Speaks the script, stores the narration in the project's folder, and times every written word by
 * listening to the result (speech recognition), so captions follow the voice exactly.
 */
export async function generateVoiceover(db: Db, ctx: SessionContext, projectId: string, input: { script: string; voice: VoiceId; speed: number; start: number; volume: number }): Promise<StoreResult<VoiceoverResult>> {
  const models = await voiceEngine().status();
  if (!models.tts) return { ok: false, status: 503, message: voiceSetupHint() };
  const project = await editableProject(db, projectId);
  if (!project) return { ok: false, status: 403, message: "You can't change this video." };
  const script = input.script.trim();
  if (!script) return { ok: false, status: 400, message: "Write the narration first." };
  const features = await aiFeatures(db);
  return withLocalAi(db, "voiceover", projectId, TTS_MODEL.name, () => speakAndStore(db, ctx, project, projectId, script, input, models.asr && features.captions),
    (v) => ({ voice: input.voice, seconds: v.voiceover.duration, words: script.split(/\s+/).length }));
}

async function speakAndStore(db: Db, ctx: SessionContext, project: { organization_id: string; listing_id: string | null }, projectId: string, script: string,
  input: { voice: VoiceId; speed: number; start: number; volume: number }, withCaptions: boolean): Promise<StoreResult<VoiceoverResult>> {

  let factWarnings: VoiceoverResult["factWarnings"] = [];
  if (project.listing_id) {
    const { data: listing } = await db.from("listings").select("*").eq("id", project.listing_id).maybeSingle();
    if (listing) factWarnings = checkNarration(script, listing);
  }
  let n;
  try { n = await voiceEngine().speak(script, input.voice, input.speed, withCaptions); } catch (e) {
    if (e instanceof VoiceServiceError) return { ok: false, status: 503, message: voiceSetupHint() };
    throw e;
  }
  if (n.audio.length === 0) return { ok: false, status: 400, message: "Nothing in the script could be spoken." };
  const audio = n.audio;

  const path = `${project.organization_id}/projects/${projectId}/${randomUUID()}.m4a`;
  const { error: up } = await db.storage.from(BUCKETS.projectMedia).upload(path, audio, { contentType: "audio/mp4", upsert: false });
  if (up) return { ok: false, status: 403, message: "The narration couldn't be saved." };
  const { data: asset, error } = await db.from("media_assets").insert({
    organization_id: project.organization_id, project_id: projectId, uploaded_by: ctx.userId, kind: "audio", bucket: BUCKETS.projectMedia,
    storage_path: path, file_name: `Narration (${VOICES.find((v) => v.id === input.voice)?.name ?? "voice"}).m4a`, mime_type: "audio/mp4",
    size_bytes: audio.length, duration_seconds: n.seconds,
  }).select("id").single();
  if (error || !asset) {
    await db.storage.from(BUCKETS.projectMedia).remove([path]);
    return { ok: false, status: 403, message: "The narration couldn't be saved." };
  }
  // word times: listen to what was spoken, then put the written words on those times
  let cues: Cue[];
  if (!withCaptions) {
    cues = []; // automatic captions are switched off for the company, or speech recognition isn't installed
  } else if (n.heard) {
    cues = cuesFrom(alignWords(script, n.heard));
  } else {
    // without speech recognition: spread each sentence's words over its known time
    cues = cuesFrom(n.sentences.flatMap((s) => {
      const words = s.text.split(/\s+/);
      const step = (s.end - s.start) / Math.max(1, words.length);
      return words.map((w, i) => ({ text: w, start: s.start + i * step, end: s.start + (i + 1) * step }));
    }));
  }
  const { data: link } = await db.storage.from(BUCKETS.projectMedia).createSignedUrl(path, 4 * 3600);
  return {
    ok: true,
    value: {
      url: link?.signedUrl ?? null,
      voiceover: {
        assetId: asset.id, script, voice: input.voice, speed: input.speed, start: input.start, volume: input.volume, duration: n.seconds,
        sentences: n.sentences.map((s) => ({ start: s.start, end: s.end })),
      },
      cues, unknownWords: n.unknownWords, factWarnings,
    },
  };
}

/** Automatic transcription of one of the project's audio files (narration you recorded, or ours). */
export async function transcribeProjectAudio(db: Db, projectId: string, assetId: string, script?: string): Promise<StoreResult<{ cues: Cue[]; text: string }>> {
  if (!(await voiceEngine().status()).asr) return { ok: false, status: 503, message: voiceSetupHint() };
  const project = await editableProject(db, projectId);
  if (!project) return { ok: false, status: 403, message: "You can't change this video." };
  const { data: asset } = await db.from("media_assets").select("id,bucket,storage_path,project_id").eq("id", assetId).eq("project_id", projectId).eq("kind", "audio").maybeSingle();
  if (!asset) return { ok: false, status: 404, message: "That audio isn't part of this video." };
  return withLocalAi(db, "transcription", projectId, ASR_MODEL.name, () => listen(db, asset, script), (v) => ({ cues: v.cues.length }));
}

async function listen(db: Db, asset: { bucket: string; storage_path: string }, script?: string): Promise<StoreResult<{ cues: Cue[]; text: string }>> {
  const { data: file } = await db.storage.from(asset.bucket).download(asset.storage_path);
  if (!file) return { ok: false, status: 404, message: "The audio file couldn't be read." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  // the format comes from the file's content; FFmpeg is never left to guess
  const kind = sniffMedia(bytes);
  const format = isAudioKind(kind) ? LISTEN_FORMAT[kind!] : undefined;
  if (!format) return { ok: false, status: 400, message: "That file isn't a real MP3, M4A, AAC or WAV recording." };
  let heard: TimedWord[];
  try { heard = await voiceEngine().listen(bytes, format); } catch (e) {
    if (e instanceof VoiceServiceError) return { ok: false, status: 503, message: voiceSetupHint() };
    throw e;
  }
  if (!heard.length) return { ok: false, status: 400, message: "No speech was found in that audio." };
  // with a script: written words at the heard times; without: what was heard, as sentences
  const words = script?.trim()
    ? alignWords(script, heard)
    : heard.map((w, i) => {
      const prev = heard[i - 1];
      const capital = !prev || w.start - prev.end > 0.7;
      const next = heard[i + 1];
      const stop = !next || next.start - w.end > 0.7;
      const text = (capital ? w.word.charAt(0).toUpperCase() + w.word.slice(1) : w.word) + (stop ? "." : "");
      return { text: text.replace(/^i$/, "I"), start: w.start, end: w.end };
    });
  const cues = cuesFrom(words);
  return { ok: true, value: { cues, text: words.map((w) => w.text).join(" ") } };
}

interface AiFeatures { can_use_ai: boolean; voiceover: boolean; captions: boolean }
async function aiFeatures(db: Db): Promise<AiFeatures> {
  const { data } = await db.rpc("my_ai_features");
  const f = (data ?? {}) as Partial<AiFeatures>;
  return { can_use_ai: !!f.can_use_ai, voiceover: !!f.voiceover, captions: !!f.captions };
}

/**
 * Narration and captions run on this server, but they are still AI: the database checks that
 * the company has the feature switched on and that the person may use AI and edit the video,
 * and logs each use for the AI usage log.
 */
async function withLocalAi<T>(db: Db, kind: "voiceover" | "transcription", projectId: string, model: string,
  run: () => Promise<StoreResult<T>>, details: (v: T) => Record<string, unknown>): Promise<StoreResult<T>> {
  const { data: id, error } = await db.rpc("start_local_ai", { p_kind: kind, p_project: projectId, p_model: model });
  if (error || !id) {
    const msg = error?.message ?? "";
    const message = /switched off/.test(msg) ? `${kind === "voiceover" ? "AI narration" : "Automatic captions"} ${kind === "voiceover" ? "is" : "are"} switched off for your company. An administrator can turn ${kind === "voiceover" ? "it" : "them"} on.`
      : /account/.test(msg) ? "AI isn't switched on for your account. Ask an administrator." : "You can't change this video.";
    return { ok: false, status: 403, message };
  }
  try {
    const r = await run();
    await db.rpc("finish_local_ai", { p_id: id, p_ok: r.ok, p_error: r.ok ? null : r.message, p_details: (r.ok ? details(r.value) : {}) as Json });
    return r;
  } catch (e) {
    await db.rpc("finish_local_ai", { p_id: id, p_ok: false, p_error: e instanceof Error ? e.message : "failed", p_details: {} });
    throw e;
  }
}
