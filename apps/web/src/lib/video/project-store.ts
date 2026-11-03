import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { SessionContext } from "@/lib/auth/session";
import type { Json, ListingRow } from "@/lib/database.types";
import { formatOpenHouse } from "@/lib/listings";
import { composeDocument, totalDuration, type Aspect, type EditPlan } from "@/lib/video/plan";
import { loadProjectAssets, planUsesOnly } from "@/lib/video/editor-data";
import { validateFableCutDocument } from "@/lib/video/validate-document";
import type { EasyListing } from "@/lib/video/easy";
import { agentForListing, brandFacts, brandRules, loadBrandContext } from "@/lib/brand";
import { applyBrandRules } from "@/lib/video/templates";

type Db = Awaited<ReturnType<typeof createClient>>;

export type StoreResult<T> = { ok: true; value: T } | { ok: false; status: number; message: string; revision?: number | null };

export const RENDER_FIELDS = "id,aspect,status,progress,error_message,created_at,started_at,finished_at,duration_seconds,width,height,size_bytes,output_asset_id,label";

export function toEasyListing(l: ListingRow): EasyListing {
  return {
    address_line: l.address_line, city: l.city, state: l.state, price: l.price, bedrooms: l.bedrooms, bathrooms: l.bathrooms,
    square_feet: l.square_feet, property_type: l.property_type, status: l.status, agent_name: l.agent_name, brokerage: l.brokerage,
    contact_phone: l.contact_phone, contact_email: l.contact_email, cover_asset_id: l.cover_asset_id,
    open_house_text: formatOpenHouse(l.open_house_date, l.open_house_start, l.open_house_end),
  };
}

/** The administrator's branding requirements, applied to any plan before it is saved or rendered. */
export async function enforceBranding(db: Db, ctx: SessionContext, listingId: string | null, plan: EditPlan): Promise<{ plan: EditPlan; changes: string[] }> {
  const rules = await brandRules(db).catch(() => null);
  if (!rules || !(rules.requireLogo || rules.requireDisclosure || rules.requireAgentCard || rules.lockFonts || rules.lockColors)) return { plan, changes: [] };
  const bc = await loadBrandContext(db, ctx);
  const { data: listing } = listingId ? await db.from("listings").select("agent_profile_id,agent_name,brokerage,contact_phone,contact_email").eq("id", listingId).maybeSingle() : { data: null };
  const { agent } = listing ? await agentForListing(db, listing, bc.kit) : { agent: null };
  return applyBrandRules(plan, rules, brandFacts(bc, agent));
}

/**
 * Saves a plan for both modes: checks edit access (RLS), that every file is the
 * project's own, builds the FableCut document, validates it with FableCut, and
 * saves only if nobody saved in between (optimistic revision check).
 */
export async function savePlan(db: Db, ctx: SessionContext, projectId: string, plan: EditPlan, baseRevision: number): Promise<StoreResult<{ revision: number; duration: number }>> {
  const { data: access } = await db.rpc("project_access", { p_project: projectId });
  if (access !== "edit") {
    return access === "read"
      ? { ok: false, status: 403, message: "You can view this video but not change it." }
      : { ok: false, status: 404, message: "We couldn't find this video." };
  }
  const { data: project } = await db.from("video_projects").select("id,title,listing_id,revision,organization_id").eq("id", projectId).maybeSingle();
  if (!project) return { ok: false, status: 404, message: "We couldn't find this video." };
  if (project.revision !== baseRevision) {
    return { ok: false, status: 409, message: "This video was changed in another window. Reload to see the latest version.", revision: project.revision };
  }
  const assets = await loadProjectAssets(db, project);
  plan = (await enforceBranding(db, ctx, project.listing_id, plan)).plan;
  const misuse = planUsesOnly(plan, assets);
  if (misuse) return { ok: false, status: 400, message: misuse };
  const document = composeDocument({ plan, title: project.title, photos: assets.photos, music: assets.music, clips: assets.clips, logo: (assets.logos ?? []).find((l) => l.id === plan.logoAssetId) ?? null, brandImages: assets.logos ?? [], brand: ctx.brandKit });
  const check = validateFableCutDocument(document);
  if (!check.ok) return { ok: false, status: 400, message: "This change can't be saved. Please undo it and try again." };

  const next = baseRevision + 1;
  document.revision = next;
  // An Easy Mode style change also changes the project's template.
  const { data: template } = plan.easy
    ? await db.from("video_templates").select("id").is("organization_id", null).eq("slug", plan.easy.style).maybeSingle()
    : { data: null };
  const { data: saved, error } = await db.from("video_projects")
    .update({
      edit_plan: plan as unknown as Json, document: document as Json, revision: next, aspect_ratios: [plan.aspect],
      ...(template ? { template_id: template.id } : {}),
    })
    .eq("id", projectId).eq("revision", baseRevision).select("revision");
  if (error) return { ok: false, status: 500, message: "Your changes couldn't be saved. Please try again." };
  if (!saved || saved.length === 0) {
    const { data: now } = await db.from("video_projects").select("revision").eq("id", projectId).maybeSingle();
    return { ok: false, status: 409, message: "This video was changed in another window. Reload to see the latest version.", revision: now?.revision ?? null };
  }
  await db.from("project_revisions").insert({
    project_id: projectId, revision: next, organization_id: project.organization_id, document: document as Json, author_id: ctx.userId,
  });
  return { ok: true, value: { revision: next, duration: totalDuration(plan) } };
}

/** Queues one render per shape from the saved plan, for the background worker. */
export async function queueRenders(db: Db, ctx: SessionContext, projectId: string, plan: EditPlan, aspects: Aspect[], label?: string): Promise<StoreResult<unknown[]>> {
  const { data: access } = await db.rpc("project_access", { p_project: projectId });
  if (access !== "edit") return { ok: false, status: access === "read" ? 403 : 404, message: "Only people who can edit this video can make it." };
  const { data: project } = await db.from("video_projects").select("*").eq("id", projectId).maybeSingle();
  if (!project) return { ok: false, status: 404, message: "We couldn't find this video." };
  const { data: busy } = await db.from("render_jobs").select("id").eq("project_id", projectId).in("status", ["queued", "running"]).limit(1);
  if (busy && busy.length > 0) return { ok: false, status: 409, message: "This video is already being made. It will be ready in a few minutes." };

  const assets = await loadProjectAssets(db, project);
  plan = (await enforceBranding(db, ctx, project.listing_id, plan)).plan;
  const rows = [];
  for (const aspect of [...new Set(aspects)]) {
    const document = composeDocument({ plan, aspect, title: project.title, photos: assets.photos, music: assets.music, clips: assets.clips, logo: (assets.logos ?? []).find((l) => l.id === plan.logoAssetId) ?? null, brandImages: assets.logos ?? [], brand: ctx.brandKit });
    if (!validateFableCutDocument(document).ok) return { ok: false, status: 400, message: "This video can't be made yet. Please check your photos." };
    rows.push({
      organization_id: project.organization_id, project_id: projectId, revision: project.revision, preset: "master-1080p",
      aspect, document: document as Json, requested_by: ctx.userId, ...(label ? { label: label.slice(0, 120) } : {}),
    });
  }
  const { data, error } = await db.from("render_jobs").insert(rows).select(RENDER_FIELDS);
  if (error) return { ok: false, status: 403, message: "You can't make this video." };
  await db.from("video_projects").update({ status: "rendering" }).eq("id", projectId);
  return { ok: true, value: data ?? [] };
}
