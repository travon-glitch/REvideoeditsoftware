import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Images, Plus, Layers, Sparkles } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/roles";
import { BUCKETS, isUuid } from "@/lib/storage";
import { signedUrlMap } from "@/lib/storage-server";
import { LISTING_STATUS_LABELS } from "@/lib/validation";
import { PROPERTY_TYPE_LABELS, formatOpenHouse, type PropertyType } from "@/lib/listings";
import { formatPrice } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { ListingWorkspace } from "./workspace";

export const metadata = { title: "Listing" };

export default async function ListingPage({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePermission("listings.view");
  const { id } = await params;
  const { step } = await searchParams;
  if (!isUuid(id)) notFound();

  const supabase = await createClient();
  // RLS returns the listing only to its owner, people it's assigned to (directly or via a project), and admins.
  const { data: listing } = await supabase.from("listings").select("*").eq("id", id).maybeSingle();
  if (!listing) notFound();
  const [{ data: photos }, { data: access }] = await Promise.all([
    supabase.from("media_assets").select("id,storage_path,thumbnail_path,file_name").eq("listing_id", id).eq("kind", "photo").order("sort_order"),
    supabase.rpc("listing_access", { p_listing: id }),
  ]);
  // Short-lived signed links, created as this person (storage RLS applies).
  const urls = await signedUrlMap(BUCKETS.listingMedia, (photos ?? []).flatMap((p) => [p.storage_path, p.thumbnail_path ?? ""]), 3600);
  const managed = (photos ?? []).map((p) => ({
    id: p.id, url: urls[p.storage_path] ?? null, thumb: (p.thumbnail_path && urls[p.thumbnail_path]) || null, file_name: p.file_name,
  }));
  const title = listing.address_line || "Untitled listing";

  if (access === "edit") {
    const directorOn = ctx.profile.can_use_ai && !!(await supabase.rpc("director_available")).data;
    const initialStep = Math.min(2, Math.max(0, Number(step ?? 1) - 1)) || 0;
    return (
      <div className="flex flex-col gap-6">
        <Button variant="ghost" asChild className="self-start"><Link href="/listings"><ArrowLeft aria-hidden="true" />My Listings</Link></Button>
        <PageHeader title={title} description="Fill in what you know — everything is saved as you go."
          actions={can(ctx.profile.role, "videos.create") && managed.length >= 5
            ? (
              <div className="flex flex-wrap gap-2">
                {directorOn ? <Button asChild size="lg" className="bg-brand text-white hover:bg-brand/90"><Link href={`/create?listing=${listing.id}`}><Sparkles aria-hidden="true" />Create My Video Automatically</Link></Button> : null}
                <Button asChild size="lg" variant="outline"><Link href={`/generate?listing=${listing.id}`}><Layers aria-hidden="true" />Generate 6 Videos</Link></Button>
              </div>
            )
            : undefined} />
        <ListingWorkspace
          listing={listing}
          photos={managed}
          orgId={ctx.organization.id}
          initialStep={Number.isFinite(initialStep) ? initialStep : 0}
          advanced={ctx.profile.ui_mode === "advanced"}
          canDelete={listing.created_by === ctx.userId || ctx.profile.role === "super_admin"}
          canCreateVideo={can(ctx.profile.role, "videos.create")}
        />
      </div>
    );
  }

  // Read-only view (assigned as viewer, or an admin looking at someone else's listing).
  const openHouse = formatOpenHouse(listing.open_house_date, listing.open_house_start, listing.open_house_end);
  const facts: [string, string | null][] = [
    ["Price", listing.price != null ? formatPrice(listing.price) : null],
    ["Type", listing.property_type ? PROPERTY_TYPE_LABELS[listing.property_type as PropertyType] ?? null : null],
    ["Bedrooms", listing.bedrooms?.toString() ?? null],
    ["Bathrooms", listing.bathrooms?.toString() ?? null],
    ["Square feet", listing.square_feet?.toLocaleString() ?? null],
    ["ZIP", listing.postal_code],
    ["Agent", [listing.agent_name, listing.brokerage].filter(Boolean).join(", ") || null],
    ["Contact", [listing.contact_phone, listing.contact_email].filter(Boolean).join(" · ") || null],
    ["Open house", openHouse],
  ];
  return (
    <div className="flex flex-col gap-6">
      <Button variant="ghost" asChild className="self-start"><Link href="/listings"><ArrowLeft aria-hidden="true" />My Listings</Link></Button>
      <PageHeader
        title={title}
        description={[listing.city, listing.state].filter(Boolean).join(", ") || undefined}
        actions={<div className="flex gap-2"><Badge variant="secondary">{LISTING_STATUS_LABELS[listing.status]}</Badge><Badge variant="outline">View only</Badge></div>}
      />
      <Card>
        <CardHeader><CardTitle>Photos ({managed.length})</CardTitle></CardHeader>
        <CardContent>
          {managed.length > 0 ? (
            <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {managed.map((p, i) => (
                <li key={p.id} className={`relative overflow-hidden rounded-lg border-2 ${p.id === listing.cover_asset_id ? "border-primary" : "border-transparent"}`}>
                  {p.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.url} alt={`Photo ${i + 1}`} className="aspect-[4/3] w-full object-cover" loading="lazy" />
                  ) : <div className="flex aspect-[4/3] items-center justify-center bg-muted"><Images aria-hidden="true" /></div>}
                  <span className="absolute left-2 top-2 rounded-md bg-black/70 px-2 py-0.5 text-sm font-semibold text-white">{i + 1}</span>
                </li>
              ))}
            </ol>
          ) : <p className="text-base text-muted-foreground">No photos yet.</p>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Details</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-4">
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {facts.filter(([, v]) => v).map(([k, v]) => (
              <div key={k}><dt className="text-sm text-muted-foreground">{k}</dt><dd className="text-base font-medium">{v}</dd></div>
            ))}
          </dl>
          {listing.description ? <p className="whitespace-pre-line text-base">{listing.description}</p> : null}
        </CardContent>
      </Card>
      {can(ctx.profile.role, "videos.create") && listing.workflow_state === "ready" ? (
        <Button asChild size="lg" className="self-start"><Link href={`/create?listing=${listing.id}`}><Plus aria-hidden="true" />Create a video from this listing</Link></Button>
      ) : null}
    </div>
  );
}
