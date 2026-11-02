import { requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { BUCKETS } from "@/lib/storage";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { BrandKitForm, LogoUploader } from "./brand-forms";

export const metadata = { title: "Branding" };

export default async function BrandingPage() {
  const ctx = await requirePermission("branding.manage");
  let logoUrl: string | null = null;
  if (ctx.brandKit?.logo_path) {
    const supabase = await createClient();
    const { data } = await supabase.storage.from(BUCKETS.brandAssets).createSignedUrl(ctx.brandKit.logo_path, 3600);
    logoUrl = data?.signedUrl ?? null;
  }
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Branding" description="Shared by everyone in the company. Every new video uses these settings." />
      <Card>
        <CardHeader><CardTitle>Logo</CardTitle><CardDescription>Shown in the app and on your videos.</CardDescription></CardHeader>
        <CardContent><LogoUploader orgId={ctx.organization.id} currentUrl={logoUrl} enabled={!!ctx.brandKit} /></CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Colors, fonts and text</CardTitle></CardHeader>
        <CardContent><BrandKitForm kit={ctx.brandKit} advanced={ctx.profile.ui_mode === "advanced"} /></CardContent>
      </Card>
    </div>
  );
}
