import Link from "next/link";
import { Bot } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { SettingsForm } from "./settings-form";

export const metadata = { title: "System settings" };

export default async function SettingsPage() {
  const ctx = await requirePermission("settings.manage");
  const supabase = await createClient();
  const { data: settings } = await supabase.from("organization_settings").select("*").eq("organization_id", ctx.organization.id).maybeSingle();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="System settings" description="Super Admin only: company-wide defaults and limits." />
      <Card>
        <CardHeader>
          <CardTitle>Defaults and limits</CardTitle>
          <CardDescription>They apply to the whole company. Limits for one person are set in People.</CardDescription>
        </CardHeader>
        <CardContent>
          {settings ? <SettingsForm settings={settings} /> : <p className="text-base text-muted-foreground">Settings are not available.</p>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Bot className="size-5 text-primary" aria-hidden="true" />AI services, keys and spending</CardTitle>
          <CardDescription>Claude and video AI credentials, models, AI switches, generation limits, spending ceilings and usage are in the AI control panel.</CardDescription>
        </CardHeader>
        <CardContent><Button asChild><Link href="/admin/ai">Open the AI control panel</Link></Button></CardContent>
      </Card>
    </div>
  );
}
