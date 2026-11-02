"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { authorizeAction, type ActionResult } from "@/lib/auth/session";
import {
  assignListingSchema, fieldErrors, formDataToObject, listingDraftSchema, registerPhotosSchema, reorderSchema, replacePhotoSchema,
} from "@/lib/validation";
import { BUCKETS, MAX_PHOTO_BYTES, PHOTO_MIME_TYPES, cleanFileName, isListingPhotoPathFor, isUuid } from "@/lib/storage";
import { MAX_PHOTOS } from "@/lib/listings";

/*
 * Every action runs as the signed-in person (RLS applies) after an app-level
 * permission check. The database decides who may edit which listing.
 */

function friendly(message: string | undefined, fallback: string): string {
  if (!message) return fallback;
  if (/at most \d+ photos/.test(message)) return `A listing can have up to ${MAX_PHOTOS} photos.`;
  if (/needs \d+ to \d+ photos/.test(message)) return message.replace(/^A listing/, "This listing");
  if (/address_line_check/.test(message)) return "Add the property address first.";
  if (/main photo/.test(message)) return "That photo can't be the main photo.";
  if (/cannot change|row-level security/.test(message)) return "You don't have permission to change this listing.";
  return fallback;
}

/** "Create listing": makes an empty draft immediately, so photos can be added right away. */
export async function createDraftListing(): Promise<void> {
  const auth = await authorizeAction("listings.create");
  if (!auth.ok) redirect("/forbidden");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("listings")
    .insert({ organization_id: auth.ctx.organization.id, created_by: auth.ctx.userId })
    .select("id")
    .single();
  if (error || !data) redirect("/listings?error=create");
  revalidatePath("/listings");
  redirect(`/listings/${data.id}?step=1`);
}

/** Saves whatever has been typed (used by autosave and the "Save draft" button). */
export async function saveListingDraft(listingId: string, formData: FormData): Promise<ActionResult<{ savedAt: string }>> {
  const auth = await authorizeAction("listings.create");
  if (!auth.ok) return auth.result;
  if (!isUuid(listingId)) return { ok: false, message: "Listing not found." };
  const parsed = listingDraftSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) {
    return { ok: false, message: "Some details need fixing before they can be saved.", fieldErrors: fieldErrors(parsed.error) };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.from("listings").update(parsed.data).eq("id", listingId).select("updated_at");
  if (error) return { ok: false, message: friendly(error.message, "We couldn't save. Please try again.") };
  if (!data || data.length === 0) return { ok: false, message: "You don't have permission to change this listing." };
  revalidatePath("/listings");
  return { ok: true, data: { savedAt: data[0]!.updated_at } };
}

/** "Save and Continue": checks the listing is complete and opens Create Video. */
export async function finishListing(listingId: string): Promise<ActionResult> {
  const auth = await authorizeAction("listings.create");
  if (!auth.ok) return auth.result;
  if (!isUuid(listingId)) return { ok: false, message: "Listing not found." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("listings").update({ workflow_state: "ready" }).eq("id", listingId).select("id");
  if (error) return { ok: false, message: friendly(error.message, "We couldn't finish this listing.") };
  if (!data || data.length === 0) return { ok: false, message: "You don't have permission to change this listing." };
  revalidatePath(`/listings/${listingId}`);
  revalidatePath("/listings");
  redirect(`/create?listing=${listingId}`);
}

export async function deleteListing(listingId: string): Promise<ActionResult> {
  const auth = await authorizeAction("listings.create");
  if (!auth.ok) return auth.result;
  if (!isUuid(listingId)) return { ok: false, message: "Listing not found." };
  const supabase = await createClient();
  const { data: assets } = await supabase.from("media_assets").select("storage_path").eq("listing_id", listingId).eq("bucket", BUCKETS.listingMedia);
  const { data, error } = await supabase.from("listings").delete().eq("id", listingId).select("id");
  if (error || !data || data.length === 0) return { ok: false, message: "Only the person who added this listing can delete it." };
  if (assets && assets.length > 0) {
    await supabase.storage.from(BUCKETS.listingMedia).remove(assets.map((a) => a.storage_path));
  }
  revalidatePath("/listings");
  redirect("/listings?deleted=1");
}

async function objectsInListingFolder(supabase: Awaited<ReturnType<typeof createClient>>, orgId: string, listingId: string) {
  const folder = `${orgId}/listings/${listingId}`;
  const { data } = await supabase.storage.from(BUCKETS.listingMedia).list(folder, { limit: 1000 });
  return new Set((data ?? []).map((o) => `${folder}/${o.name}`));
}

function validPhotoFile(f: { path: string; mime_type: string; size_bytes: number }, orgId: string, listingId: string) {
  return isListingPhotoPathFor(f.path, orgId, listingId)
    && (PHOTO_MIME_TYPES as readonly string[]).includes(f.mime_type)
    && f.size_bytes > 0 && f.size_bytes <= MAX_PHOTO_BYTES;
}

/** Called by the browser after it uploaded photos straight to private storage. */
export async function registerPhotos(input: unknown): Promise<ActionResult<{ count: number }>> {
  const auth = await authorizeAction("listings.create");
  if (!auth.ok) return auth.result;
  const parsed = registerPhotosSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Upload details were not valid." };
  const { listing_id, files } = parsed.data;
  const orgId = auth.ctx.organization.id;
  if (files.some((f) => !validPhotoFile(f, orgId, listing_id))) return { ok: false, message: "One of the files is not a supported photo." };

  const supabase = await createClient();
  const present = await objectsInListingFolder(supabase, orgId, listing_id);
  if (files.some((f) => !present.has(f.path))) return { ok: false, message: "Some photos didn't finish uploading. Please try again." };

  const { data: last } = await supabase.from("media_assets").select("sort_order").eq("listing_id", listing_id)
    .order("sort_order", { ascending: false }).limit(1);
  const start = (last?.[0]?.sort_order ?? -1) + 1;
  const { error } = await supabase.from("media_assets").insert(
    files.map((f, i) => ({
      organization_id: orgId,
      listing_id,
      uploaded_by: auth.ctx.userId,
      kind: "photo" as const,
      bucket: BUCKETS.listingMedia,
      storage_path: f.path,
      file_name: cleanFileName(f.file_name),
      mime_type: f.mime_type,
      size_bytes: f.size_bytes,
      width: f.width ?? null,
      height: f.height ?? null,
      sort_order: start + i,
    })),
  );
  if (error) {
    await supabase.storage.from(BUCKETS.listingMedia).remove(files.map((f) => f.path));
    return { ok: false, message: friendly(error.message, "We couldn't save the photos. Please try again.") };
  }

  // First photos in: make the first one the main photo automatically.
  const { data: firstPhoto } = await supabase.from("media_assets").select("id").eq("listing_id", listing_id).eq("kind", "photo")
    .order("sort_order").limit(1);
  if (firstPhoto?.[0]) {
    await supabase.from("listings").update({ cover_asset_id: firstPhoto[0].id }).eq("id", listing_id).is("cover_asset_id", null);
  }

  revalidatePath(`/listings/${listing_id}`);
  return { ok: true, message: `${files.length} photo${files.length === 1 ? "" : "s"} added.`, data: { count: files.length } };
}

/** Replace: same place in the order, new file; the old file is deleted. */
export async function replacePhoto(input: unknown): Promise<ActionResult> {
  const auth = await authorizeAction("listings.create");
  if (!auth.ok) return auth.result;
  const parsed = replacePhotoSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Upload details were not valid." };
  const f = parsed.data;
  const supabase = await createClient();
  const { data: asset } = await supabase.from("media_assets").select("id,listing_id,storage_path").eq("id", f.asset_id).maybeSingle();
  if (!asset?.listing_id) return { ok: false, message: "Photo not found." };
  if (!validPhotoFile(f, auth.ctx.organization.id, asset.listing_id)) return { ok: false, message: "That file is not a supported photo." };
  const present = await objectsInListingFolder(supabase, auth.ctx.organization.id, asset.listing_id);
  if (!present.has(f.path)) return { ok: false, message: "The new photo didn't finish uploading." };

  const { data, error } = await supabase.from("media_assets").update({
    storage_path: f.path, file_name: cleanFileName(f.file_name), mime_type: f.mime_type, size_bytes: f.size_bytes,
    width: f.width ?? null, height: f.height ?? null,
  }).eq("id", f.asset_id).select("id");
  if (error || !data || data.length === 0) {
    await supabase.storage.from(BUCKETS.listingMedia).remove([f.path]);
    return { ok: false, message: "You don't have permission to change this photo." };
  }
  await supabase.storage.from(BUCKETS.listingMedia).remove([asset.storage_path]);
  revalidatePath(`/listings/${asset.listing_id}`);
  return { ok: true, message: "Photo replaced." };
}

export async function reorderPhotos(input: unknown): Promise<ActionResult> {
  const auth = await authorizeAction("listings.create");
  if (!auth.ok) return auth.result;
  const parsed = reorderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "That order wasn't valid." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("reorder_listing_photos", { p_listing_id: parsed.data.listing_id, p_asset_ids: parsed.data.asset_ids });
  if (error) return { ok: false, message: /every photo/.test(error.message) ? "The photos changed meanwhile. Reload and try again." : friendly(error.message, "We couldn't save the new order.") };
  revalidatePath(`/listings/${parsed.data.listing_id}`);
  return { ok: true };
}

export async function setMainPhoto(listingId: string, assetId: string): Promise<ActionResult> {
  const auth = await authorizeAction("listings.create");
  if (!auth.ok) return auth.result;
  if (!isUuid(listingId) || !isUuid(assetId)) return { ok: false, message: "Photo not found." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("listings").update({ cover_asset_id: assetId }).eq("id", listingId).select("id");
  if (error) return { ok: false, message: friendly(error.message, "We couldn't set the main photo.") };
  if (!data || data.length === 0) return { ok: false, message: "You don't have permission to change this listing." };
  revalidatePath(`/listings/${listingId}`);
  return { ok: true, message: "Main photo set." };
}

export async function deletePhoto(assetId: string): Promise<ActionResult> {
  const auth = await authorizeAction("listings.create");
  if (!auth.ok) return auth.result;
  if (!isUuid(assetId)) return { ok: false, message: "Photo not found." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("media_assets").delete().eq("id", assetId).select("storage_path,listing_id,bucket");
  const row = data?.[0];
  if (error || !row) return { ok: false, message: "You don't have permission to remove this photo." };
  await supabase.storage.from(row.bucket).remove([row.storage_path]);
  if (row.listing_id) revalidatePath(`/listings/${row.listing_id}`);
  return { ok: true, message: "Photo removed." };
}

/* ── Admin: assign a listing to an employee ─────────────────────────────── */

export async function assignListing(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("projects.assign");
  if (!auth.ok) return auth.result;
  const parsed = assignListingSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return { ok: false, message: "Please choose a listing.", fieldErrors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_assign_listing", {
    p_listing_id: parsed.data.listing_id, p_user_id: parsed.data.user_id, p_access: parsed.data.access,
  });
  if (error) return { ok: false, message: /^(Only|User or|This account)/.test(error.message) ? error.message : "That listing couldn't be assigned." };
  revalidatePath(`/admin/users/${parsed.data.user_id}`);
  return { ok: true, message: "Listing assigned." };
}

export async function unassignListing(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("projects.assign");
  if (!auth.ok) return auth.result;
  const userId = String(formData.get("user_id") ?? "");
  const listingId = String(formData.get("listing_id") ?? "");
  if (!isUuid(userId) || !isUuid(listingId)) return { ok: false, message: "That change wasn't valid." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_unassign_listing", { p_listing_id: listingId, p_user_id: userId });
  if (error) return { ok: false, message: "That listing couldn't be removed." };
  revalidatePath(`/admin/users/${userId}`);
  return { ok: true, message: "Listing removed from this person." };
}
