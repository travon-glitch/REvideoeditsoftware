import { requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { ComingSoonNote } from "@/components/coming-soon";
import { SettingsForm } from "./settings-form";

export const metadata = { title: "System settings" };

export default async function SettingsPage() {
  const ctx = await requirePermission("settings.manage");
  const supabase = await createClient();
  const { data: settings } = await supabase.from("organization_settings").select("*").eq("organization_id", ctx.organization.id).maybeSingle();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="System settings" description="Super Admin only: AI services, costs and company-wide defaults." />
      <Card>
        <CardHeader>
          <CardTitle>AI and costs</CardTitle>
          <CardDescription>Budgets and defaults apply to the whole company.</CardDescription>
        </CardHeader>
        <CardContent>
          {settings ? <SettingsForm settings={settings} /> : <p className="text-base text-muted-foreground">Settings are not available.</p>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>AI services</CardTitle></CardHeader>
        <CardContent>
          <ComingSoonNote>
            Connecting AI video and photo services (and their API keys, kept on the server only) is part of the AI generation stage. No AI service is connected yet.
          </ComingSoonNote>
        </CardContent>
      </Card>
    </div>
  );
}
