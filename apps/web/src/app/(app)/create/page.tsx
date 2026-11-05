import { videoMakerStatus } from "@/lib/video-maker";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { BUCKETS, isUuid } from "@/lib/storage";
import { signListingPhotos, signMusicUrls, signedUrlMap } from "@/lib/storage-server";
import { orderForVideo } from "@/lib/listings";
import { currentPlan, loadProjectAssets } from "@/lib/video/editor-data";
import { RENDER_FIELDS, toEasyListing } from "@/lib/video/project-store";
import { STYLE_IDS, autoDirector, easySettingsSchema, type EasySettings, type StyleId } from "@/lib/video/easy";
import type { EditPlan } from "@/lib/video/plan";
import type { ListingRow } from "@/lib/database.types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EasyWizard, type WizardDetails, type WizardProps, type WizardRender } from "./easy-wizard";

export const metadata = { title: "Create Video" };

const EMPTY_LISTING = toEasyListing({
  address_line: "", city: null, state: null, price: null, bedrooms: null, bathrooms: null, square_feet: null, property_type: null,
  status: "for_sale", agent_name: null, brokerage: null, contact_phone: null, contact_email: null, cover_asset_id: null,
  open_house_date: null, open_house_start: null, open_house_end: null,
} as unknown as ListingRow);

function Problem({ text }: { text: string }) {
  return (
    <div className="flex flex-col gap-4">
      <Alert variant="destructive"><AlertDescription className="text-base">{text}</AlertDescription></Alert>
      <Button asChild size="lg" className="self-start"><Link href="/create">Start a new video</Link></Button>
    </div>
  );
}

export default async function CreatePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePermission("videos.create");
  const { listing: listingParam, project: projectParam, step, style } = await searchParams;
  const db = await createClient();

  let listing: ListingRow | null = null;
  let projectId: string | null = null;
  let revision = 0;
  let savedPlan: EditPlan | null = null;
  let music: WizardProps["music"] = [];
  let renders: WizardRender[] = [];

  if (projectParam) {
    if (!isUuid(projectParam)) notFound();
    const { data: project } = await db.from("video_projects").select("*").eq("id", projectParam).maybeSingle();
    if (!project) notFound();
    const { data: access } = await db.rpc("project_access", { p_project: project.id });
    if (access !== "edit") redirect(`/videos/${project.id}`);
    if (!project.listing_id) return <Problem text="This video isn't linked to a listing, so it can only be changed in the Advanced editor." />;
    const { data: l } = await db.from("listings").select("*").eq("id", project.listing_id).maybeSingle();
    if (!l) return <Problem text="We couldn't open this video's listing." />;
    listing = l;
    projectId = project.id;
    revision = project.revision;
    const assets = await loadProjectAssets(db, project);
    savedPlan = assets.photos.length ? currentPlan(project, listing, assets) : null;
    const musicUrls = await signMusicUrls(assets.music.map((m) => m.storage_path), 4 * 3600);
    music = assets.music.map((m) => ({ id: m.id, file_name: m.file_name, duration_seconds: m.duration_seconds, url: musicUrls[m.storage_path] ?? null }));
    const { data: r } = await db.from("render_jobs").select(RENDER_FIELDS).eq("project_id", project.id).order("created_at", { ascending: false }).limit(10);
    renders = (r ?? []) as unknown as WizardRender[];
  } else if (listingParam) {
    if (!isUuid(listingParam)) notFound();
    const { data: l } = await db.from("listings").select("*").eq("id", listingParam).maybeSingle();
    if (!l) notFound();
    const { data: access } = await db.rpc("listing_access", { p_listing: l.id });
    if (access !== "edit") return <Problem text="You can view this listing but not make videos from it. Ask an administrator for edit access." />;
    listing = l;
  }

  const { data: rows } = listing
    ? await db.from("media_assets").select("id,storage_path,thumbnail_path,file_name,camera_spec").eq("listing_id", listing.id).eq("kind", "photo").order("sort_order")
    : { data: [] };
  const photos = orderForVideo(await signListingPhotos(rows ?? []), listing?.cover_asset_id ?? null);
  const base = listing ? toEasyListing(listing) : EMPTY_LISTING;

  // Prefill the agent branding from the person and the company when the listing has none.
  const details: WizardDetails = {
    address_line: listing?.address_line ?? "",
    city: listing?.city ?? "",
    state: listing?.state ?? "",
    price: listing?.price != null ? String(listing.price) : "",
    agent_name: listing?.agent_name ?? ctx.profile.full_name ?? "",
    brokerage: listing?.brokerage ?? ctx.brandKit?.company_name ?? "",
    contact_phone: listing?.contact_phone ?? "",
    contact_email: listing?.contact_email ?? ctx.email ?? "",
  };

  // Settings: what was chosen before, otherwise the smart suggestion.
  const suggestion = autoDirector({ listing: base, photoCount: Math.max(photos.length, 5), musicAssetIds: music.map((m) => m.id) });
  const saved = savedPlan?.easy ? easySettingsSchema.safeParse(savedPlan.easy) : null;
  let settings: EasySettings = saved?.success ? saved.data : { ...suggestion.settings, ...(savedPlan ? { aspect: savedPlan.aspect } : {}) };
  if (!saved?.success && (STYLE_IDS as readonly string[]).includes(style ?? "")) settings = { ...settings, style: style as StyleId };
  if (savedPlan && !saved?.success) settings = { ...settings, musicAssetId: savedPlan.music.assetId };
  const custom = savedPlan && (!savedPlan.easy || savedPlan.easy.customized) ? savedPlan : null;

  const initialStep = projectId ? Math.min(4, Math.max(1, Number(step) || 2)) : 1;

  return (
    <EasyWizard
      orgId={ctx.organization.id}
      listingId={listing?.id ?? null}
      projectId={projectId}
      revision={revision}
      initialStep={initialStep}
      listing={base}
      details={details}
      photos={photos}
      music={music}
      renders={renders}
      settings={settings}
      recommended={suggestion.settings.style}
      order={savedPlan?.easy?.order ?? photos.map((p) => p.id)}
      custom={custom}
      savedPlan={savedPlan}
      brand={ctx.brandKit ? { company_name: ctx.brandKit.company_name, outro_text: ctx.brandKit.outro_text } : null}
      brandColor={ctx.brandKit?.primary_color ?? "#1D4ED8"}
      canDownload={ctx.profile.can_download}
      maker={await videoMakerStatus()}
      directorAvailable={ctx.profile.can_use_ai && !!(await db.rpc("director_available")).data}
    />
  );
}
