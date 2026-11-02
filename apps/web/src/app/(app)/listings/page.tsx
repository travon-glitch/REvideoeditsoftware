import Link from "next/link";
import { House, Plus } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/roles";
import { LISTING_STATUS_LABELS } from "@/lib/validation";
import { formatPrice } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { SubmitButton } from "@/components/form";
import { BUCKETS } from "@/lib/storage";
import { signedUrlMap } from "@/lib/storage-server";
import { createDraftListing } from "./actions";

export const metadata = { title: "My Listings" };

export default async function ListingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePermission("listings.view");
  const { deleted } = await searchParams;
  const supabase = await createClient();
  // The database returns only listings this person may see (their own, ones shared through
  // an assigned project, or all of them for admins).
  const { data: listings } = await supabase.from("listings").select("*").order("updated_at", { ascending: false }).limit(200);
  const ids = (listings ?? []).map((l) => l.id);
  const { data: photos } = ids.length
    ? await supabase.from("media_assets").select("id,listing_id,storage_path,thumbnail_path").in("listing_id", ids).eq("kind", "photo")
    : { data: [] };
  const photoCount = new Map<string, number>();
  const coverPath = new Map<string, string>();
  for (const p of photos ?? []) if (p.listing_id) photoCount.set(p.listing_id, (photoCount.get(p.listing_id) ?? 0) + 1);
  for (const l of listings ?? []) {
    const cover = (photos ?? []).find((p) => p.id === l.cover_asset_id);
    if (cover) coverPath.set(l.id, cover.thumbnail_path ?? cover.storage_path);
  }
  const thumbs = await signedUrlMap(BUCKETS.listingMedia, [...coverPath.values()], 3600);
  const canCreate = can(ctx.profile.role, "listings.create");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="My Listings"
        description="Homes you're marketing, with their photos."
        actions={canCreate ? <form action={createDraftListing}><SubmitButton size="lg" pendingText="Starting…"><Plus aria-hidden="true" />Create listing</SubmitButton></form> : null}
      />
      {deleted ? <Alert variant="success"><AlertDescription>The listing was deleted.</AlertDescription></Alert> : null}
      {listings && listings.length > 0 ? (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {listings.map((l) => (
            <li key={l.id}>
              <Link href={`/listings/${l.id}`} className="flex h-full flex-col gap-3 rounded-xl border bg-card p-5 transition-colors hover:border-primary/40">
                {coverPath.has(l.id) && thumbs[coverPath.get(l.id)!] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={thumbs[coverPath.get(l.id)!]} alt="" className="aspect-video w-full rounded-lg object-cover" loading="lazy" />
                ) : (
                  <div className="flex aspect-video items-center justify-center rounded-lg bg-muted text-muted-foreground"><House className="size-8" aria-hidden="true" /></div>
                )}
                <div className="flex items-start justify-between gap-3">
                  <span className="text-sm text-muted-foreground">{photoCount.get(l.id) ?? 0} photos</span>
                  <span className="flex flex-wrap justify-end gap-1">
                    {l.workflow_state === "draft" ? <Badge variant="warning">Draft</Badge> : null}
                    {l.created_by !== ctx.userId ? <Badge variant="outline">{l.created_by ? "Shared with you" : "Company"}</Badge> : null}
                    <Badge variant="secondary">{LISTING_STATUS_LABELS[l.status]}</Badge>
                  </span>
                </div>
                <div>
                  <p className="text-lg font-semibold leading-snug">{l.address_line || "Untitled listing"}</p>
                  <p className="text-base text-muted-foreground">{[l.city, l.state].filter(Boolean).join(", ") || " "}</p>
                </div>
                <p className="mt-auto text-base font-semibold">{formatPrice(l.price)}</p>
                <p className="text-sm text-muted-foreground">
                  {[l.bedrooms != null ? `${l.bedrooms} bd` : null, l.bathrooms != null ? `${l.bathrooms} ba` : null, l.square_feet != null ? `${l.square_feet.toLocaleString()} sq ft` : null].filter(Boolean).join(" · ") || "Details not added yet"}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={House}
          title="No listings yet"
          description="Add a home's address and photos, then turn it into a video."
          action={canCreate ? <form action={createDraftListing}><SubmitButton size="lg" pendingText="Starting…"><Plus aria-hidden="true" />Create your first listing</SubmitButton></form> : undefined}
        />
      )}
    </div>
  );
}
