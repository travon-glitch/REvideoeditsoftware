import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { BUCKETS } from "@/lib/storage";
import { formatPrice } from "@/lib/utils";
import { formatOpenHouse } from "@/lib/listings";
import { specsLine } from "@/lib/video/starter-document";
import { ASPECTS, initialPlan, planSchema, type Aspect, type EditPlan, type PlanMusic, type PlanPhoto } from "@/lib/video/plan";
import type { BrandKitRow, ListingRow, VideoProjectRow } from "@/lib/database.types";

type Db = Awaited<ReturnType<typeof createClient>>;

export interface EditorAssets {
  photos: PlanPhoto[];
  music: PlanMusic[];
}

/** Photos of the project's listing and music uploaded to the project — the only files it may use. RLS applies. */
export async function loadProjectAssets(db: Db, project: Pick<VideoProjectRow, "id" | "listing_id">): Promise<EditorAssets> {
  const [photos, music] = await Promise.all([
    project.listing_id
      ? db.from("media_assets").select("id,storage_path,file_name,width,height").eq("listing_id", project.listing_id).eq("kind", "photo").order("sort_order")
      : Promise.resolve({ data: [] as PlanPhoto[] }),
    db.from("media_assets").select("id,storage_path,file_name,duration_seconds").eq("project_id", project.id).eq("kind", "audio").eq("bucket", BUCKETS.projectMedia).order("created_at"),
  ]);
  return {
    photos: (photos.data ?? []) as PlanPhoto[],
    music: ((music.data ?? []) as PlanMusic[]).map((m) => ({ ...m, duration_seconds: m.duration_seconds == null ? null : Number(m.duration_seconds) })),
  };
}

export function asAspect(value: string | undefined): Aspect {
  return (ASPECTS as readonly string[]).includes(value ?? "") ? (value as Aspect) : "16:9";
}

/** The automatic first timeline for a listing (used for new videos and older projects without a plan). */
export function planForListing(listing: ListingRow | null, photos: PlanPhoto[], aspect: Aspect): EditPlan {
  return initialPlan({
    photos,
    coverId: listing?.cover_asset_id ?? null,
    aspect,
    address: listing?.address_line ?? "",
    cityState: [listing?.city, listing?.state].filter(Boolean).join(", "),
    priceLine: listing?.price != null ? formatPrice(listing.price) : "",
    specsLine: listing ? specsLine(listing) : "",
    openHouse: listing ? formatOpenHouse(listing.open_house_date, listing.open_house_start, listing.open_house_end) : null,
    agentLine: [listing?.agent_name, listing?.brokerage].filter(Boolean).join(" · "),
    contactLine: [listing?.contact_phone, listing?.contact_email].filter(Boolean).join("  ·  "),
  });
}

/** The saved plan if it is still valid, otherwise a fresh automatic one. */
export function currentPlan(project: VideoProjectRow, listing: ListingRow | null, assets: EditorAssets): EditPlan {
  const parsed = planSchema.safeParse(project.edit_plan);
  if (parsed.success) {
    const photoIds = new Set(assets.photos.map((p) => p.id));
    const musicIds = new Set(assets.music.map((m) => m.id));
    const scenes = parsed.data.scenes.filter((s) => photoIds.has(s.assetId)); // photos removed from the listing drop out
    if (scenes.length > 0) {
      const sceneIds = new Set(scenes.map((s) => s.id));
      return {
        ...parsed.data,
        scenes,
        texts: parsed.data.texts.filter((t) => t.sceneId.startsWith("@") || sceneIds.has(t.sceneId)),
        music: parsed.data.music.assetId && !musicIds.has(parsed.data.music.assetId)
          ? { ...parsed.data.music, assetId: null } : parsed.data.music,
      };
    }
  }
  return planForListing(listing, assets.photos, asAspect(project.aspect_ratios[0]));
}

/** Every file a plan references must be one of the project's own files. */
export function planUsesOnly(plan: EditPlan, assets: EditorAssets): string | null {
  const photoIds = new Set(assets.photos.map((p) => p.id));
  const bad = plan.scenes.find((s) => !photoIds.has(s.assetId));
  if (bad) return "A scene uses a photo that isn't part of this listing.";
  if (plan.music.assetId && !assets.music.some((m) => m.id === plan.music.assetId)) return "The chosen music isn't part of this project.";
  return null;
}

export type { BrandKitRow };
