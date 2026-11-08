import "server-only";
/*
 * AI Camera Control on the server: "describe your camera movement" → camera settings.
 * The photo is read with the person's own database access (row-level security), so a photo
 * they can't see can't be used. Claude runs only after start_camera_prompt has checked their AI
 * access, the company's Claude switch, edit access to the photo's listing and the spending
 * ceilings; the cost is then written by the server. Without Claude (switched off, no key, or a
 * failed call) a free keyword reader answers instead, and the app says so.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SessionContext } from "@/lib/auth/session";
import type { Json } from "@/lib/database.types";
import { BUCKETS } from "@/lib/storage";
import type { StoreResult } from "@/lib/video/project-store";
import type { Aspect } from "@/lib/video/plan";
import type { CameraSpec } from "@lvs/camera-presets";
import { costCents, isDirectorModel, DEFAULT_DIRECTOR_MODEL, type CallClaude } from "@/lib/director/claude";
import { claudeForOrg } from "@/lib/director/run";
import { basicInstructions, instructionsToSpec, type InterpretContext, type InterpretedMove } from "./ai-camera";
import { CameraPromptError, cameraPromptRequest, readInstructions, type ClaudeImage } from "./ai-camera-claude";

type Db = Awaited<ReturnType<typeof createClient>>;

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
const MAX_IMAGE_BYTES = 4_500_000;

export interface InterpretInput {
  assetId: string;
  prompt: string;
  aspect: Aspect;
  duration: number;
  preserveEntireImage: boolean;
  current: CameraSpec | null;
}

function friendly(message: string): string {
  if (/AI isn't switched on for your account/.test(message)) return "AI isn't switched on for your account, so basic understanding was used.";
  if (/Claude isn't switched on/.test(message)) return "Claude isn't switched on for your company, so basic understanding was used.";
  if (/spending limit|limit of AI camera requests/.test(message)) return `${message.replace(/^.*?(Monthly|Daily|Your daily)/, "$1")}. Basic understanding was used instead.`;
  return "Claude couldn't be used just now, so basic understanding was used.";
}

export async function interpretCameraPrompt(db: Db, ctx: SessionContext, input: InterpretInput, opts: { call?: CallClaude | null } = {}): Promise<StoreResult<InterpretedMove>> {
  const prompt = input.prompt.trim();
  if (!prompt) return { ok: false, status: 400, message: "Describe the camera movement first." };
  const { data: photo } = await db.from("media_assets").select("id,listing_id,kind,storage_path,thumbnail_path,mime_type,size_bytes,width,height")
    .eq("id", input.assetId).eq("kind", "photo").maybeSingle();
  if (!photo || !photo.listing_id) return { ok: false, status: 404, message: "We couldn't find that photo." };
  const context: InterpretContext = { aspect: input.aspect, duration: input.duration, preserveEntireImage: input.preserveEntireImage, photo };
  const basic = (note?: string): StoreResult<InterpretedMove> => {
    const r = instructionsToSpec(basicInstructions(prompt, context), context, input.current, "basic");
    if (note) r.notes.unshift(note);
    return { ok: true, value: r };
  };

  const call = opts.call === undefined ? await claudeForOrg(ctx.organization.id) : opts.call;
  if (!call) return basic("Claude isn't connected yet, so basic understanding was used. Your Super Admin can add the Claude key in the AI control panel.");

  const { data: started, error } = await db.rpc("start_camera_prompt", { p_listing: photo.listing_id });
  if (error || !started) return basic(friendly(error?.message ?? ""));
  const { id: eventId, model: rawModel } = started as { id: string; model: string };
  const model = isDirectorModel(rawModel) ? rawModel : DEFAULT_DIRECTOR_MODEL;
  const admin = createAdminClient();

  try {
    // the photo goes along (its preview image), so "toward the front door" can be found in it
    let image: ClaudeImage | null = null;
    const path = photo.thumbnail_path ?? ((IMAGE_TYPES as readonly string[]).includes(photo.mime_type) && photo.size_bytes <= MAX_IMAGE_BYTES ? photo.storage_path : null);
    if (path) {
      const { data } = await db.storage.from(BUCKETS.listingMedia).download(path);
      if (data) image = { mediaType: photo.thumbnail_path ? "image/jpeg" : photo.mime_type as ClaudeImage["mediaType"], base64: Buffer.from(await data.arrayBuffer()).toString("base64") };
    }
    const msg = await call(cameraPromptRequest(model, prompt, context, image));
    const usage = { input_tokens: msg.usage.input_tokens ?? 0, output_tokens: msg.usage.output_tokens ?? 0,
      cache_creation_input_tokens: msg.usage.cache_creation_input_tokens ?? 0, cache_read_input_tokens: msg.usage.cache_read_input_tokens ?? 0 };
    const cost = costCents(model, usage);
    let result: InterpretedMove | null = null, failure: string | null = null;
    try { result = instructionsToSpec(readInstructions(msg), context, input.current, "claude"); }
    catch (e) { failure = e instanceof CameraPromptError ? e.message : "Claude's answer couldn't be used."; }
    await admin.from("ai_usage_events").update({
      status: result ? "succeeded" : "failed", cost_cents: cost, finished_at: new Date().toISOString(), error_message: failure,
      details: { usage, served_by: msg.model, prompt_chars: prompt.length, image: !!image, ...(result ? { movement: result.instructions.movement } : {}) } as unknown as Json,
    }).eq("id", eventId);
    if (!result) return basic(`${failure} Basic understanding was used instead.`);
    if (result.aspect !== input.aspect) result.notes.push(`The video shape was changed to ${result.aspect}, as your request asked.`);
    return { ok: true, value: result };
  } catch (e) {
    const message = e instanceof Anthropic.AuthenticationError ? "Claude rejected the API key"
      : e instanceof Anthropic.RateLimitError ? "Claude is busy right now"
      : e instanceof Anthropic.APIError ? `Claude couldn't be reached (${e.status ?? "network"})` : "Claude couldn't be used";
    await admin.from("ai_usage_events").update({ status: "failed", finished_at: new Date().toISOString(), error_message: message }).eq("id", eventId);
    return basic(`${message}, so basic understanding was used.`);
  }
}
