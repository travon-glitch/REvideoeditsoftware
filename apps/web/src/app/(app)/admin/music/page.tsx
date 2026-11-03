import { requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { BUCKETS } from "@/lib/storage";
import { signedUrlMap } from "@/lib/storage-server";
import { ensureBuiltinMusic } from "@/lib/music";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { MusicLibrary, type TrackView } from "./music-library";

export const metadata = { title: "Music library" };

export default async function MusicPage() {
  const ctx = await requirePermission("admin.access");
  await ensureBuiltinMusic(ctx.organization.id).catch(() => undefined);
  const db = await createClient();
  const [{ data: tracks }, { data: people }] = await Promise.all([
    db.from("music_tracks").select("*").order("created_at"),
    db.from("profiles").select("id,full_name"),
  ]);
  const { data: assets } = tracks?.length ? await db.from("media_assets").select("id,storage_path,duration_seconds").in("id", tracks.map((t) => t.asset_id)) : { data: [] };
  const urls = await signedUrlMap(BUCKETS.musicLibrary, (assets ?? []).map((a) => a.storage_path), 3600);
  const nameOf = new Map((people ?? []).map((p) => [p.id, p.full_name]));
  const view: TrackView[] = (tracks ?? []).map((t) => {
    const a = (assets ?? []).find((x) => x.id === t.asset_id);
    return {
      assetId: t.asset_id, title: t.title, artist: t.artist, mood: t.mood, license: t.license_type, details: t.license_details, url: t.license_url,
      verified: t.commercial_use_verified, verifiedBy: t.verified_by ? nameOf.get(t.verified_by) ?? null : t.license_type === "original_builtin" ? "Built in" : null,
      verifiedAt: t.verified_at, audio: a ? urls[a.storage_path] ?? null : null, seconds: a?.duration_seconds == null ? null : Number(a.duration_seconds),
    };
  });
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Music library" description="Background music for videos. Only tracks verified for commercial use are offered to your team or picked automatically." />
      <Card>
        <CardHeader>
          <CardTitle>Tracks</CardTitle>
          <CardDescription>Built-in tracks are original music composed by this app, owned by your company and cleared for commercial use.</CardDescription>
        </CardHeader>
        <CardContent><MusicLibrary orgId={ctx.organization.id} tracks={view} /></CardContent>
      </Card>
    </div>
  );
}
