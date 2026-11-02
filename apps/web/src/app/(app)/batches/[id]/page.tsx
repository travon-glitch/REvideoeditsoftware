import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/storage";
import { batchStatus } from "@/lib/video/batch-store";
import { BatchDashboard } from "./batch-dashboard";

export const metadata = { title: "Six videos" };

export default async function BatchPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePermission("videos.view");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const r = await batchStatus(await createClient(), id);
  if (!r.ok) notFound();
  return <BatchDashboard initial={r.value} canDownload={ctx.profile.can_download} canEdit={ctx.profile.role !== "viewer"} />;
}
