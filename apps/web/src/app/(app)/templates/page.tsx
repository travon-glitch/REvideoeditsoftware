import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/roles";
import { isUuid } from "@/lib/storage";
import { listTemplates, recommendFor } from "@/lib/video/template-store";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { TemplateGallery } from "./template-gallery";

export const metadata = { title: "Templates" };

export default async function TemplatesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePermission("templates.view");
  const { listing: wanted } = await searchParams;
  const db = await createClient();
  const [templates, { data: listings }, { data: counts }] = await Promise.all([
    listTemplates(db, ctx),
    db.from("listings").select("*").order("updated_at", { ascending: false }).limit(200),
    db.from("media_assets").select("listing_id").eq("kind", "photo").not("listing_id", "is", null),
  ]);
  const approved = templates.filter((t) => t.status === "approved");
  const photoCount = new Map<string, number>();
  for (const c of counts ?? []) if (c.listing_id) photoCount.set(c.listing_id, (photoCount.get(c.listing_id) ?? 0) + 1);
  const selected = (listings ?? []).find((l) => l.id === wanted && isUuid(wanted)) ?? null;
  const rec = selected ? recommendFor(selected, approved) : null;
  let agentName: string | null = null;
  if (selected?.agent_profile_id) {
    const { data } = await db.from("agent_profiles").select("name").eq("id", selected.agent_profile_id).maybeSingle();
    agentName = data?.name ?? null;
  }
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Templates" description="Pick a listing, then a template. The listing's details, your brand kit and the listing's agent are filled in automatically."
        actions={can(ctx.profile.role, "templates.manage") ? <Button asChild variant="outline"><Link href="/admin/templates">Manage templates</Link></Button> : undefined} />
      <TemplateGallery
        templates={approved.map((t) => ({ id: t.id, recipe: t.recipe, name: t.name, usage: t.usage, description: t.description, aspect: t.spec.aspect, duration: t.spec.duration, font: t.spec.look.headingFont }))}
        listings={(listings ?? []).map((l) => ({ id: l.id, label: [l.address_line || "Untitled listing", l.city].filter(Boolean).join(", "), photos: photoCount.get(l.id) ?? 0 }))}
        listingId={selected?.id ?? null}
        recommendation={rec ? { templateId: rec.template.id, reason: rec.reason } : null}
        agentName={agentName ?? selected?.agent_name ?? null}
        canCreate={can(ctx.profile.role, "videos.create")}
      />
    </div>
  );
}
