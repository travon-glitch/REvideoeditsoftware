import Link from "next/link";
import { Layers } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/storage";
import { parseCamera, signedUrlMap } from "@/lib/storage-server";
import { BUCKETS } from "@/lib/storage";
import { BATCH_TYPES, BATCH_TYPE_INFO, analyzeListing } from "@/lib/video/batch";
import { toEasyListing } from "@/lib/video/project-store";
import { ORIENTATION_LABELS } from "@/lib/video/easy";
import { formatDateTime } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { GenerateButton } from "./generate-button";

export const metadata = { title: "Generate 6 Videos" };

export default async function GeneratePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePermission("videos.create");
  const { listing: wanted } = await searchParams;
  const db = await createClient();
  const [{ data: listings }, { data: counts }, { data: batches }] = await Promise.all([
    db.from("listings").select("id,address_line,city,cover_asset_id").order("updated_at", { ascending: false }).limit(200),
    db.from("media_assets").select("listing_id").eq("kind", "photo").not("listing_id", "is", null),
    db.from("video_batches").select("id,listing_id,size,created_at").order("created_at", { ascending: false }).limit(8),
  ]);
  const photoCount = new Map<string, number>();
  for (const c of counts ?? []) if (c.listing_id) photoCount.set(c.listing_id, (photoCount.get(c.listing_id) ?? 0) + 1);
  const options = (listings ?? []).map((l) => ({ id: l.id, label: [l.address_line || "Untitled listing", l.city].filter(Boolean).join(", "), photos: photoCount.get(l.id) ?? 0 }));
  const selectedId = isUuid(wanted) && options.some((o) => o.id === wanted) ? wanted : options.find((o) => o.photos >= 5)?.id ?? options[0]?.id ?? null;

  let analysis = null as ReturnType<typeof analyzeListing> | null;
  let cover: string | null = null;
  if (selectedId) {
    const [{ data: listing }, { data: photos }] = await Promise.all([
      db.from("listings").select("*").eq("id", selectedId).maybeSingle(),
      db.from("media_assets").select("id,width,height,camera_spec,storage_path,thumbnail_path").eq("listing_id", selectedId).eq("kind", "photo").order("sort_order"),
    ]);
    if (listing) {
      analysis = analyzeListing(toEasyListing(listing), (photos ?? []).map((p) => ({ id: p.id, width: p.width, height: p.height, camera: parseCamera(p.camera_spec) })));
      const c = (photos ?? []).find((p) => p.id === listing.cover_asset_id) ?? photos?.[0];
      if (c) cover = (await signedUrlMap(BUCKETS.listingMedia, [c.thumbnail_path ?? c.storage_path], 3600))[c.thumbnail_path ?? c.storage_path] ?? null;
    }
  }
  const labelOf = new Map(options.map((o) => [o.id, o.label]));
  const selected = options.find((o) => o.id === selectedId);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Generate 6 Videos" description="One click makes six different marketing videos from one listing. They render in the background." />
      {!ctx.profile.can_batch_generate ? (
        <Alert variant="destructive"><AlertDescription className="text-base">Generate 6 Videos isn&apos;t switched on for your account. Ask your Super Admin.</AlertDescription></Alert>
      ) : null}
      {options.length === 0 ? (
        <p className="text-base text-muted-foreground">You don&apos;t have any listings yet. <Link className="underline" href="/listings">Create one</Link> and add at least 5 photos.</p>
      ) : (
        <Card>
          <CardContent className="flex flex-col gap-5 pt-6">
            <form className="flex flex-wrap items-end gap-3" action="/generate">
              <div className="flex min-w-64 flex-1 flex-col gap-1">
                <label htmlFor="listing" className="text-sm font-semibold">Listing</label>
                <select id="listing" name="listing" defaultValue={selectedId ?? ""} className="h-12 rounded-md border bg-background px-3 text-base">
                  {options.map((o) => <option key={o.id} value={o.id}>{o.label} — {o.photos} photos</option>)}
                </select>
              </div>
              <button type="submit" className="h-12 rounded-lg border px-4 text-base font-semibold hover:bg-accent">Show</button>
            </form>
            {selected && analysis ? (
              <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                <div className="flex flex-col gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {cover ? <img src={cover} alt="" className="aspect-video w-full rounded-xl object-cover" /> : <div className="aspect-video rounded-xl bg-muted" />}
                  <h2 className="text-lg font-semibold">What we found</h2>
                  <ul className="ml-5 list-disc text-base text-muted-foreground">{analysis.notes.map((n) => <li key={n}>{n}</li>)}</ul>
                </div>
                <div className="flex flex-col gap-4">
                  <h2 className="text-lg font-semibold">The six videos</h2>
                  <ol className="grid gap-2 sm:grid-cols-2">
                    {BATCH_TYPES.map((t, i) => (
                      <li key={t} className="rounded-lg border p-3">
                        <p className="font-semibold">{i + 1}. {BATCH_TYPE_INFO[t].title}</p>
                        <p className="text-sm text-muted-foreground">{BATCH_TYPE_INFO[t].purpose}</p>
                        <p className="mt-1 text-xs font-semibold text-muted-foreground">{ORIENTATION_LABELS[BATCH_TYPE_INFO[t].aspect].label}</p>
                      </li>
                    ))}
                  </ol>
                  <GenerateButton listingId={selected.id} disabled={!ctx.profile.can_batch_generate || selected.photos < 5}
                    reason={selected.photos < 5 ? `Add at least 5 photos — this listing has ${selected.photos}.` : null} />
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      )}
      {batches && batches.length ? (
        <Card>
          <CardHeader><CardTitle>Recent batches</CardTitle></CardHeader>
          <CardContent>
            <ul className="divide-y rounded-lg border">
              {batches.map((b) => (
                <li key={b.id}>
                  <Link href={`/batches/${b.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 text-base hover:bg-accent">
                    <Layers className="size-5 text-muted-foreground" aria-hidden="true" />
                    <span className="flex-1 font-semibold">{(b.listing_id && labelOf.get(b.listing_id)) || "Listing"}</span>
                    <span className="text-sm text-muted-foreground">{b.size} videos · {formatDateTime(b.created_at)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
