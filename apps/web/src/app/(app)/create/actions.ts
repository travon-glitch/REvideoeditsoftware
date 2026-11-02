"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { authorizeAction, type ActionResult } from "@/lib/auth/session";
import { easyDetailsSchema, fieldErrors } from "@/lib/validation";
import { isUuid } from "@/lib/storage";
import { parseCamera, signListingPhotos, type SignedPhoto } from "@/lib/storage-server";
import { MAX_PHOTOS, MIN_PHOTOS } from "@/lib/listings";
import { composeDocument } from "@/lib/video/plan";
import { STYLES, buildEasyPlan, easySettingsSchema } from "@/lib/video/easy";
import { toEasyListing } from "@/lib/video/project-store";
import { validateFableCutDocument } from "@/lib/video/validate-document";
import type { Json, ListingRow } from "@/lib/database.types";

/*
 * Easy Mode wizard actions. All run as the signed-in person (RLS applies)
 * after an app-level permission check.
 */

/** Step 1, first photo dropped: an empty draft listing to upload into. */
export async function startEasyListing(): Promise<ActionResult<{ listingId: string }>> {
  const auth = await authorizeAction("videos.create");
  if (!auth.ok) return auth.result;
  const db = await createClient();
  const { data, error } = await db.from("listings")
    .insert({ organization_id: auth.ctx.organization.id, created_by: auth.ctx.userId })
    .select("id").single();
  if (error || !data) return { ok: false, message: "We couldn't start a new listing. Please try again." };
  revalidatePath("/listings");
  return { ok: true, data: { listingId: data.id } };
}

/** Step 3 (and step 1's address box): saves the listing details shown in the video. */
export async function saveEasyDetails(listingId: string, input: unknown): Promise<ActionResult> {
  const auth = await authorizeAction("videos.create");
  if (!auth.ok) return auth.result;
  if (!isUuid(listingId)) return { ok: false, message: "Listing not found." };
  const parsed = easyDetailsSchema.partial().safeParse(input);
  if (!parsed.success) return { ok: false, message: "Please check the highlighted details.", fieldErrors: fieldErrors(parsed.error) };
  const patch = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined)) as Partial<ListingRow>;
  if (Object.keys(patch).length === 0) return { ok: true };
  const db = await createClient();
  const { data, error } = await db.from("listings").update(patch).eq("id", listingId).select("id");
  if (error || !data || data.length === 0) return { ok: false, message: "You don't have permission to change this listing." };
  revalidatePath(`/listings/${listingId}`);
  return { ok: true };
}

const projectInput = z.object({
  listingId: z.string().uuid(),
  settings: easySettingsSchema,
  order: z.array(z.string().uuid()).max(MAX_PHOTOS).optional(),
  skipped: z.array(z.string().uuid()).max(MAX_PHOTOS).optional(),
});

/** Leaving step 1: creates the video project for this listing with an Easy Mode storyboard. */
export async function createEasyProject(input: unknown): Promise<ActionResult<{ projectId: string; revision: number }>> {
  const auth = await authorizeAction("videos.create");
  if (!auth.ok) return auth.result;
  const parsed = projectInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Something went wrong. Please try again." };
  const { listingId, settings, order, skipped } = parsed.data;
  const { ctx } = auth;
  const db = await createClient();

  const [{ data: listing }, { data: template }, { data: photos }] = await Promise.all([
    db.from("listings").select("*").eq("id", listingId).maybeSingle(),
    db.from("video_templates").select("id,name").is("organization_id", null).eq("slug", settings.style).maybeSingle(),
    db.from("media_assets").select("id,storage_path,file_name,width,height,camera_spec").eq("listing_id", listingId).eq("kind", "photo")
      .order("sort_order").limit(MAX_PHOTOS),
  ]);
  if (!listing) return { ok: false, message: "That listing wasn't found." };
  if (!photos || photos.length < MIN_PHOTOS) {
    return { ok: false, message: `Add at least ${MIN_PHOTOS} photos first — you have ${photos?.length ?? 0}.` };
  }

  const plan = buildEasyPlan({
    listing: toEasyListing(listing), photos: photos.map((p) => ({ ...p, camera: parseCamera(p.camera_spec) })), settings, order, skipped,
    brand: ctx.brandKit ? { company_name: ctx.brandKit.company_name, outro_text: ctx.brandKit.outro_text } : null,
  });
  const title = `${listing.address_line.trim() || "New listing"} — ${STYLES[settings.style].name}`;
  const doc = composeDocument({ plan, title, photos, music: [], brand: ctx.brandKit });
  if (!validateFableCutDocument(doc).ok) return { ok: false, message: "We couldn't prepare this video. Please try again." };

  const { data: project, error } = await db.from("video_projects").insert({
    organization_id: ctx.organization.id,
    listing_id: listing.id,
    template_id: template?.id ?? null,
    brand_kit_id: ctx.brandKit?.id ?? null,
    created_by: ctx.userId,
    title,
    status: "draft",
    aspect_ratios: [plan.aspect],
    settings: { photoCount: photos.length, template: settings.style, mode: "easy" } as Json,
    edit_plan: plan as unknown as Json,
    document: doc as Json,
    revision: 1,
  }).select("id").single();
  if (error && /Monthly video limit/.test(error.message)) {
    return { ok: false, message: "You've reached your monthly video limit. Ask an administrator if you need more." };
  }
  if (error || !project) return { ok: false, message: "We couldn't save the video. Please try again." };

  await db.from("project_revisions").insert({
    project_id: project.id, revision: 1, organization_id: ctx.organization.id, document: doc as Json, author_id: ctx.userId,
    note: "Created in Easy Mode",
  });
  revalidatePath("/videos");
  return { ok: true, data: { projectId: project.id, revision: 1 } };
}

/** The listing's photos (in order) with short-lived links — used after uploads. RLS decides what's visible. */
export async function listEasyPhotos(listingId: string): Promise<ActionResult<{ photos: SignedPhoto[]; coverId: string | null }>> {
  const auth = await authorizeAction("videos.create");
  if (!auth.ok) return auth.result;
  if (!isUuid(listingId)) return { ok: false, message: "Listing not found." };
  const db = await createClient();
  const [{ data: listing }, { data: rows }] = await Promise.all([
    db.from("listings").select("cover_asset_id").eq("id", listingId).maybeSingle(),
    db.from("media_assets").select("id,storage_path,thumbnail_path,file_name,camera_spec").eq("listing_id", listingId).eq("kind", "photo").order("sort_order"),
  ]);
  if (!listing) return { ok: false, message: "Listing not found." };
  return { ok: true, data: { photos: await signListingPhotos(rows ?? []), coverId: listing.cover_asset_id } };
}
