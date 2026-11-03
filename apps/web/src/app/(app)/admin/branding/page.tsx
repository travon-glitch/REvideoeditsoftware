import { requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { BUCKETS } from "@/lib/storage";
import { ensureBuiltinMusic, verifiedTracks } from "@/lib/music";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { BrandKitForm, LogoUploader } from "./brand-forms";

export const metadata = { title: "Brand kit" };

/* The company brand kit — Super Admin only (the database enforces it too). */
export default async function BrandingPage() {
  const ctx = await requirePermission("branding.manage");
  const supabase = await createClient();
  const sign = async (path: string | null | undefined) => {
    if (!path) return null;
    const { data } = await supabase.storage.from(BUCKETS.brandAssets).createSignedUrl(path, 3600);
    return data?.signedUrl ?? null;
  };
  await ensureBuiltinMusic(ctx.organization.id).catch(() => undefined);
  const [logoUrl, brokerageUrl, tracks] = await Promise.all([sign(ctx.brandKit?.logo_path), sign(ctx.brandKit?.brokerage_logo_path), verifiedTracks(supabase)]);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Brand kit" description="Shared by everyone in the company. Every template and video uses these settings." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Company logo</CardTitle><CardDescription>Intro and outro animations, and the corner of videos.</CardDescription></CardHeader>
          <CardContent><LogoUploader orgId={ctx.organization.id} currentUrl={logoUrl} enabled={!!ctx.brandKit} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Brokerage logo</CardTitle><CardDescription>Shown on the agent card at the end of videos.</CardDescription></CardHeader>
          <CardContent><LogoUploader orgId={ctx.organization.id} currentUrl={brokerageUrl} enabled={!!ctx.brandKit} which="brokerage" /></CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader><CardTitle>Brand settings</CardTitle></CardHeader>
        <CardContent><BrandKitForm kit={ctx.brandKit} tracks={tracks.map((t) => ({ id: t.assetId, title: t.title, mood: t.mood }))} /></CardContent>
      </Card>
    </div>
  );
}
