import "server-only";
/*
 * The company's brand kit, branding rules and agent profiles, as the video code needs them
 * (Stage 11). Everything is read as the signed-in person (RLS applies); brand images are
 * registered as media assets so the render worker can verify them by id.
 */
import type { createClient } from "@/lib/supabase/server";
import type { SessionContext } from "@/lib/auth/session";
import type { AgentProfileRow, BrandKitRow, ListingRow } from "@/lib/database.types";
import { ensureBrandImage } from "@/lib/music";
import type { PlanLogo } from "@/lib/video/plan";
import { NO_RULES, agentFrom, factsFrom, rulesFrom, templateBrandFrom, type BrandFacts, type BrandRules, type TemplateAgent, type TemplateBrand } from "@/lib/video/templates";

type Db = Awaited<ReturnType<typeof createClient>>;

export interface BrandContext {
  kit: BrandKitRow | null;
  logo: PlanLogo | null;
  brokerageLogo: PlanLogo | null;
  rules: BrandRules;
  template: TemplateBrand;
}

export async function brandRules(db: Db): Promise<BrandRules> {
  const { data } = await db.rpc("my_brand_rules");
  return rulesFrom(data);
}

export async function loadBrandContext(db: Db, ctx: SessionContext): Promise<BrandContext> {
  const kit = ctx.brandKit;
  const [logo, brokerageLogo, rules] = await Promise.all([
    ensureBrandImage(ctx.organization.id, kit?.logo_path, "logo"),
    ensureBrandImage(ctx.organization.id, kit?.brokerage_logo_path, "logo"),
    brandRules(db).catch(() => NO_RULES),
  ]);
  return {
    kit, logo, brokerageLogo, rules,
    template: templateBrandFrom(kit, ctx.organization.name ?? null, logo?.id ?? null, brokerageLogo?.id ?? null),
  };
}

/**
 * Who appears on a listing's videos: the assigned agent profile, otherwise the agent details
 * typed on the listing. Brokerage falls back to the brand kit's brokerage name.
 */
export async function agentForListing(db: Db, listing: Pick<ListingRow, "agent_profile_id" | "agent_name" | "brokerage" | "contact_phone" | "contact_email">, kit: BrandKitRow | null): Promise<{ agent: TemplateAgent | null; profile: AgentProfileRow | null; headshot: PlanLogo | null }> {
  let profile: AgentProfileRow | null = null;
  if (listing.agent_profile_id) {
    const { data } = await db.from("agent_profiles").select("*").eq("id", listing.agent_profile_id).maybeSingle();
    profile = data && data.is_active ? data : null;
  }
  let headshot: PlanLogo | null = null;
  if (profile?.headshot_asset_id) {
    const { data } = await db.from("media_assets").select("id,storage_path,width,height").eq("id", profile.headshot_asset_id).maybeSingle();
    headshot = data ?? null;
  }
  return { profile, headshot, agent: agentFrom(profile, listing, kit, headshot?.id ?? null) };
}

/** The facts applyBrandRules() needs. */
export function brandFacts(bc: BrandContext, agent: TemplateAgent | null): BrandFacts {
  return factsFrom(bc.template, agent);
}
