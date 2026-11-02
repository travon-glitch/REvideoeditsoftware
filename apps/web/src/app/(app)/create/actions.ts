"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { authorizeAction, type ActionResult } from "@/lib/auth/session";
import { createVideoSchema, fieldErrors, formDataToObject } from "@/lib/validation";
import { composeDocument, type Aspect } from "@/lib/video/plan";
import { planForListing } from "@/lib/video/editor-data";
import { validateFableCutDocument } from "@/lib/video/validate-document";
import type { Json } from "@/lib/database.types";
import { MAX_PHOTOS, MIN_PHOTOS } from "@/lib/listings";

export async function createVideo(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("videos.create");
  if (!auth.ok) return auth.result;
  const parsed = createVideoSchema.safeParse(formDataToObject(formData, ["aspect_ratios"]));
  if (!parsed.success) return { ok: false, message: "Please finish the highlighted steps.", fieldErrors: fieldErrors(parsed.error) };
  const input = parsed.data;
  const { ctx } = auth;
  const supabase = await createClient();

  const [{ data: listing }, { data: template }, { data: photos }] = await Promise.all([
    supabase.from("listings").select("*").eq("id", input.listing_id).maybeSingle(),
    supabase.from("video_templates").select("*").eq("id", input.template_id).eq("is_active", true).maybeSingle(),
    supabase.from("media_assets").select("id,storage_path,file_name,width,height")
      .eq("listing_id", input.listing_id).eq("kind", "photo").order("sort_order").limit(MAX_PHOTOS),
  ]);
  if (!listing) return { ok: false, message: "That listing wasn't found.", fieldErrors: { listing_id: "Choose a listing." } };
  if (!template) return { ok: false, message: "That style wasn't found.", fieldErrors: { template_id: "Choose a style." } };
  if (!photos || photos.length < MIN_PHOTOS) {
    return {
      ok: false,
      message: `A video needs at least ${MIN_PHOTOS} photos. This listing has ${photos?.length ?? 0}.`,
      fieldErrors: { listing_id: `Add at least ${MIN_PHOTOS} photos to this listing first.` },
    };
  }
  if (!listing.address_line.trim()) {
    return { ok: false, message: "Add the property address to this listing first.", fieldErrors: { listing_id: "This listing has no address yet." } };
  }

  const title = input.title ?? `${listing.address_line} — ${template.name}`;
  const aspect = input.aspect_ratios[0] as Aspect;
  const assets = { photos, music: [] };
  const plan = planForListing(listing, photos, aspect);
  const doc = composeDocument({ plan, title, photos: assets.photos, music: [], brand: ctx.brandKit });
  const check = validateFableCutDocument(doc);
  if (!check.ok) return { ok: false, message: "We couldn't prepare this video. Please try again or contact your administrator." };

  const { data: project, error } = await supabase.from("video_projects").insert({
    organization_id: ctx.organization.id,
    listing_id: listing.id,
    template_id: template.id,
    brand_kit_id: ctx.brandKit?.id ?? null,
    created_by: ctx.userId,
    title,
    status: "draft",
    aspect_ratios: input.aspect_ratios,
    settings: { photoCount: photos.length, coverAssetId: listing.cover_asset_id, template: template.slug } as Json,
    edit_plan: plan as unknown as Json,
    document: doc as Json,
    revision: 1,
  }).select("id").single();
  if (error && /Monthly video limit/.test(error.message)) {
    return { ok: false, message: "You've reached your monthly video limit. Ask an administrator if you need more." };
  }
  if (error || !project) return { ok: false, message: "We couldn't save the video. Please try again." };

  await supabase.from("project_revisions").insert({
    project_id: project.id,
    revision: 1,
    organization_id: ctx.organization.id,
    document: doc as Json,
    author_id: ctx.userId,
    note: "Starter edit created",
  });

  revalidatePath("/videos");
  redirect(`/videos/${project.id}/edit`);
}
