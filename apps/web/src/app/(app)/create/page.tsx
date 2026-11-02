import { requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/storage";
import { PageHeader } from "@/components/page-header";
import { CreateVideoForm } from "./create-form";

export const metadata = { title: "Create Video" };

export default async function CreatePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePermission("videos.create");
  const { listing } = await searchParams;
  const supabase = await createClient();

  const [{ data: listings }, { data: templates }, { data: photos }] = await Promise.all([
    supabase.from("listings").select("id,address_line,city,workflow_state").order("updated_at", { ascending: false }).limit(200),
    supabase.from("video_templates").select("id,name,description,aspect_ratios").eq("is_active", true).order("sort_order"),
    supabase.from("media_assets").select("listing_id").eq("kind", "photo").not("listing_id", "is", null),
  ]);
  const counts = new Map<string, number>();
  for (const p of photos ?? []) if (p.listing_id) counts.set(p.listing_id, (counts.get(p.listing_id) ?? 0) + 1);

  const options = (listings ?? []).map((l) => ({
    id: l.id,
    label: [l.address_line || "Untitled listing", l.city].filter(Boolean).join(", ") + (l.workflow_state === "draft" ? " (draft)" : ""),
    photos: counts.get(l.id) ?? 0,
  }));
  const initial = isUuid(listing) && options.some((o) => o.id === listing) ? listing : undefined;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Create a new video" description="Three quick steps. You can fine-tune everything afterwards." />
      <CreateVideoForm
        listings={options}
        templates={templates ?? []}
        initialListing={initial}
        advanced={ctx.profile.ui_mode === "advanced"}
      />
    </div>
  );
}
