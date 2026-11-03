import { notFound, redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/storage";
import { parseCamera, signListingPhotos } from "@/lib/storage-server";
import { currentPlan, loadProjectAssets } from "@/lib/video/editor-data";
import { aiAvailability, studioActivity } from "@/lib/video/camera-store";
import { CameraStudio, type StudioProps } from "./studio";

export const metadata = { title: "Camera Studio" };

export default async function CameraStudioPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePermission("camera.use");
  const q = await searchParams;
  const db = await createClient();

  let listingId = isUuid(q.listing) ? q.listing : null;
  let scene: StudioProps["scene"] = null;

  // Opened from a video scene: /camera-studio?project=…&scene=…
  if (q.project) {
    if (!isUuid(q.project)) notFound();
    const { data: project } = await db.from("video_projects").select("*").eq("id", q.project).maybeSingle();
    if (!project || !project.listing_id) notFound();
    const { data: access } = await db.rpc("project_access", { p_project: project.id });
    if (access !== "edit") redirect(`/videos/${project.id}`);
    const { data: listing } = await db.from("listings").select("*").eq("id", project.listing_id).maybeSingle();
    const plan = currentPlan(project, listing, await loadProjectAssets(db, project));
    const index = plan.scenes.findIndex((s) => s.id === q.scene);
    const s = plan.scenes[index];
    if (!s) redirect(`/videos/${project.id}/edit`);
    listingId = project.listing_id;
    scene = { projectId: project.id, sceneId: s.id, label: `scene ${index + 1}`, photoId: s.assetId, camera: s.camera ?? null, aspect: plan.aspect, duration: s.duration };
  }

  const [{ data: listings }, photosRes, accessRes] = await Promise.all([
    db.from("listings").select("id,address_line,city").order("updated_at", { ascending: false }).limit(200),
    listingId
      ? db.from("media_assets").select("id,storage_path,thumbnail_path,file_name,width,height,camera_spec").eq("listing_id", listingId).eq("kind", "photo").order("sort_order")
      : Promise.resolve({ data: [] as { id: string; storage_path: string; thumbnail_path: string | null; file_name: string; width: number | null; height: number | null; camera_spec: unknown }[] }),
    listingId ? db.rpc("listing_access", { p_listing: listingId }) : Promise.resolve({ data: "none" as const }),
  ]);
  if (listingId && !(listings ?? []).some((l) => l.id === listingId) && !scene) notFound();
  const rows = photosRes.data ?? [];
  const signed = await signListingPhotos(rows);
  const photos = signed.map((s, i) => ({ ...s, width: rows[i]!.width, height: rows[i]!.height, camera: parseCamera(rows[i]!.camera_spec) }));

  const initialPhotoId = scene?.photoId
    ?? (q.photo === "latest" ? photos.at(-1)?.id : photos.find((x) => x.id === q.photo)?.id)
    ?? photos[0]?.id ?? null;

  const activity = listingId ? await studioActivity(db, ctx, listingId) : { clipProject: null, renders: [], jobs: [], clips: [] };

  return (
    <CameraStudio
      orgId={ctx.organization.id}
      listings={(listings ?? []).map((l) => ({ id: l.id, label: [l.address_line || "Untitled listing", l.city].filter(Boolean).join(", ") }))}
      listingId={listingId}
      canEdit={accessRes.data === "edit" || !listingId}
      photos={photos}
      initialPhotoId={initialPhotoId}
      initialMode={q.mode === "move" || q.mode === "easy" || q.mode === "advanced" ? q.mode : ctx.profile.ui_mode === "advanced" ? "advanced" : "easy"}
      scene={scene}
      canUseAi={ctx.profile.can_use_ai}
      generative={(await aiAvailability(db)).generative}
      canDownload={ctx.profile.can_download}
      activity={activity as StudioProps["activity"]}
    />
  );
}
