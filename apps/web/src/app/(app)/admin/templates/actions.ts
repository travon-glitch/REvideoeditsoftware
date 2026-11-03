"use server";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { authorizeAction, type ActionResult } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/storage";
import type { Json, ListingStatus } from "@/lib/database.types";
import { LISTING_STATUSES } from "@/lib/validation";
import { templateSpecSchema, type TemplateSpec } from "@/lib/video/templates";

function done(message: string): ActionResult {
  revalidatePath("/admin/templates");
  revalidatePath("/templates");
  return { ok: true, message };
}
const friendly = (m: string | undefined, fallback: string) =>
  /Approve the template|already the default|Only administrators|can't be moved/.test(m ?? "") ? m! : fallback;

/** "Create template": a draft copy of an existing template, ready to edit and approve. */
export async function duplicateTemplate(fromId: string): Promise<ActionResult<{ id: string }>> {
  const auth = await authorizeAction("templates.manage");
  if (!auth.ok) return auth.result;
  if (!isUuid(fromId)) return { ok: false, message: "Template not found." };
  const db = await createClient();
  const { data: src } = await db.from("video_templates").select("*").eq("id", fromId).maybeSingle();
  const spec = src ? templateSpecSchema.safeParse(src.style) : null;
  if (!src || !spec?.success) return { ok: false, message: "Template not found." };
  const name = `${src.name} (copy)`.slice(0, 60);
  const { data, error } = await db.from("video_templates").insert({
    organization_id: auth.ctx.organization.id, slug: `custom-${randomUUID().slice(0, 8)}`, name, description: src.description, usage: src.usage,
    aspect_ratios: src.aspect_ratios, style: { ...spec.data, name } as unknown as Json, status: "draft", created_by: auth.ctx.userId, sort_order: 100,
  }).select("id").single();
  if (error || !data) return { ok: false, message: "The template couldn't be created." };
  revalidatePath("/admin/templates");
  return { ok: true, message: `Created "${name}" as a draft. Edit it, then approve it.`, data: { id: data.id } };
}

export type TemplateEdit = Partial<Pick<TemplateSpec,
  "name" | "usage" | "description" | "aspect" | "duration" | "transition" | "badge" | "headline" | "callToAction" | "intro" | "outro" | "agentCard" | "showLogo" | "music" | "intensity">>
  & { look?: Partial<TemplateSpec["look"]> };

/** Edit a template. An approved template goes back to draft until it is approved again (the database does this). */
export async function updateTemplate(id: string, edit: TemplateEdit): Promise<ActionResult> {
  const auth = await authorizeAction("templates.manage");
  if (!auth.ok) return auth.result;
  if (!isUuid(id)) return { ok: false, message: "Template not found." };
  const db = await createClient();
  const { data: row } = await db.from("video_templates").select("*").eq("id", id).maybeSingle();
  const current = row ? templateSpecSchema.safeParse(row.style) : null;
  if (!row || !current?.success) return { ok: false, message: "Template not found." };
  const next = templateSpecSchema.safeParse({ ...current.data, ...edit, look: { ...current.data.look, ...(edit.look ?? {}) } });
  if (!next.success) {
    const i = next.error.issues[0];
    return { ok: false, message: `Please check "${i?.path.join(".") ?? "the form"}": ${i?.message ?? "not valid"}.` };
  }
  const s = next.data;
  const { error } = await db.from("video_templates").update({
    name: s.name, usage: s.usage, description: s.description, aspect_ratios: [s.aspect], style: s as unknown as Json,
  }).eq("id", id);
  if (error) return { ok: false, message: friendly(error.message, "The template couldn't be saved.") };
  return done(row.status === "approved" ? "Saved. The template needs approving again before people can use it." : "Saved.");
}

export async function setTemplateStatus(id: string, status: "approved" | "disabled" | "draft"): Promise<ActionResult> {
  const auth = await authorizeAction("templates.manage");
  if (!auth.ok) return auth.result;
  if (!isUuid(id)) return { ok: false, message: "Template not found." };
  const db = await createClient();
  const { data, error } = await db.from("video_templates").update({ status }).eq("id", id).select("id");
  if (error || !data?.length) return { ok: false, message: friendly(error?.message, "The template couldn't be changed.") };
  return done(status === "approved" ? "Approved — people can use it now." : status === "disabled" ? "Disabled — it's hidden from people who make videos." : "Moved back to draft.");
}

export async function setTemplateDefaults(id: string, statuses: string[]): Promise<ActionResult> {
  const auth = await authorizeAction("templates.manage");
  if (!auth.ok) return auth.result;
  if (!isUuid(id)) return { ok: false, message: "Template not found." };
  const list = statuses.filter((s): s is ListingStatus => (LISTING_STATUSES as readonly string[]).includes(s));
  const db = await createClient();
  const { error } = await db.rpc("admin_set_template_default", { p_template: id, p_statuses: list });
  if (error) return { ok: false, message: friendly(error.message, "The defaults couldn't be saved.") };
  return done(list.length ? "Default saved." : "No longer a default.");
}

export async function deleteTemplate(id: string): Promise<ActionResult> {
  const auth = await authorizeAction("templates.manage");
  if (!auth.ok) return auth.result;
  if (!isUuid(id)) return { ok: false, message: "Template not found." };
  const db = await createClient();
  const { data, error } = await db.from("video_templates").delete().eq("id", id).select("id");
  if (error || !data?.length) return { ok: false, message: "Built-in templates can be disabled but not deleted." };
  return done("Template deleted.");
}
