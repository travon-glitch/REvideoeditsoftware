"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorizeAction, type ActionResult } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { BUCKETS, isUuid } from "@/lib/storage";
import { imageSize } from "@/lib/image-size";

const text = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));
const agentSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, "Enter the agent's name.").max(120),
  title: text(80),
  phone: z.string().trim().max(40).optional().transform((v, ctx) => {
    if (!v) return null;
    if (!/^[+()\-.\s\d]{7,40}$/.test(v)) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Use a phone number like 555-123-4567." }); return z.NEVER; }
    return v;
  }),
  email: z.string().trim().max(160).optional().transform((v, ctx) => {
    if (!v) return null;
    if (!z.string().email().safeParse(v).success) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a valid email address." }); return z.NEVER; }
    return v.toLowerCase();
  }),
  brokerage: text(160),
  license: text(60),
  user_id: z.string().optional().transform((v) => (v && isUuid(v) ? v : null)),
  is_active: z.boolean().default(true),
});
export type AgentInput = z.input<typeof agentSchema>;

function friendly(message: string | undefined, fallback: string) {
  return /not in your company|headshot|Only administrators|duplicate key/.test(message ?? "")
    ? (message ?? "").includes("duplicate key") ? "That person already has an agent profile." : message!
    : fallback;
}

/** Create or update an agent profile (administrators). */
export async function saveAgent(input: AgentInput): Promise<ActionResult<{ id: string }>> {
  const auth = await authorizeAction("agents.manage");
  if (!auth.ok) return auth.result;
  const parsed = agentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Please check the details." };
  const { id, ...fields } = parsed.data;
  const db = await createClient();
  const r = id
    ? await db.from("agent_profiles").update(fields).eq("id", id).select("id").single()
    : await db.from("agent_profiles").insert({ ...fields, organization_id: auth.ctx.organization.id, created_by: auth.ctx.userId }).select("id").single();
  if (r.error || !r.data) return { ok: false, message: friendly(r.error?.message, "The agent profile couldn't be saved.") };
  revalidatePath("/admin/agents");
  return { ok: true, message: id ? "Agent profile saved." : "Agent profile created.", data: { id: r.data.id } };
}

export async function deleteAgent(id: string): Promise<ActionResult> {
  const auth = await authorizeAction("agents.manage");
  if (!auth.ok) return auth.result;
  if (!isUuid(id)) return { ok: false, message: "Agent not found." };
  const db = await createClient();
  const { data, error } = await db.from("agent_profiles").delete().eq("id", id).select("id");
  if (error || !data?.length) return { ok: false, message: "The agent profile couldn't be removed." };
  revalidatePath("/admin/agents");
  return { ok: true, message: "Agent profile removed. Listings that used it now use their own agent details." };
}

/** Called after the browser uploaded a headshot to brand-assets/<org>/agents/. */
export async function setAgentHeadshot(agentId: string, path: string): Promise<ActionResult> {
  const auth = await authorizeAction("agents.manage");
  if (!auth.ok) return auth.result;
  const org = auth.ctx.organization.id;
  const m = /^([0-9a-f-]{36})\/agents\/([0-9a-f-]{36})\.(jpg|png|webp)$/i.exec(path);
  if (!isUuid(agentId) || !m || m[1] !== org) return { ok: false, message: "Upload location was not valid." };
  const db = await createClient();
  const { data: file } = await db.storage.from(BUCKETS.brandAssets).download(path);
  if (!file) return { ok: false, message: "The photo didn't finish uploading." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const size = imageSize(bytes);
  if (!size) return { ok: false, message: "Use a JPG, PNG or WebP photo." };
  const ext = m[3]!.toLowerCase();
  const { data: asset, error } = await db.from("media_assets").insert({
    organization_id: org, uploaded_by: auth.ctx.userId, kind: "headshot", bucket: BUCKETS.brandAssets, storage_path: path,
    file_name: `headshot.${ext}`, mime_type: ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg", size_bytes: bytes.length,
    width: size.width, height: size.height,
  }).select("id").single();
  if (error || !asset) return { ok: false, message: "The photo couldn't be saved." };
  const { error: e2 } = await db.from("agent_profiles").update({ headshot_asset_id: asset.id }).eq("id", agentId);
  if (e2) return { ok: false, message: friendly(e2.message, "The photo couldn't be added to the profile.") };
  revalidatePath("/admin/agents");
  return { ok: true, message: "Headshot updated." };
}
