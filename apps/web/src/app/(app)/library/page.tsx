import { GalleryVerticalEnd } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { LibraryGrid } from "./library-grid";

export const metadata = { title: "Company Library" };

export default async function LibraryPage() {
  const ctx = await requirePermission("videos.view");
  const db = await createClient();
  const { data: items } = await db.from("library_videos").select("id,title,aspect,duration_seconds,saved_by,saved_at").order("saved_at", { ascending: false }).limit(200);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Company Library" description="Finished videos saved for everyone in the company." />
      {items && items.length ? (
        <LibraryGrid items={items.map((i) => ({ ...i, duration_seconds: i.duration_seconds == null ? null : Number(i.duration_seconds) }))}
          canDownload={ctx.profile.can_download} userId={ctx.userId} isAdmin={ctx.profile.role === "admin" || ctx.profile.role === "super_admin"} />
      ) : (
        <EmptyState icon={GalleryVerticalEnd} title="Nothing in the library yet" description="Open a batch from Generate 6 Videos and choose “Save to library”." />
      )}
    </div>
  );
}
