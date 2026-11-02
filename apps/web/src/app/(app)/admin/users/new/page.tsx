import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { assignableRoles } from "@/lib/auth/roles";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { CreateUserForm } from "../user-forms";

export const metadata = { title: "Create user" };

export default async function NewUserPage() {
  const ctx = await requirePermission("users.manage");
  const supabase = await createClient();
  const { data: settings } = await supabase.from("organization_settings").select("viewers_can_download_by_default")
    .eq("organization_id", ctx.organization.id).maybeSingle();
  return (
    <div className="flex flex-col gap-6">
      <Button variant="ghost" asChild className="self-start"><Link href="/admin/users"><ArrowLeft aria-hidden="true" />All users</Link></Button>
      <PageHeader title="Create user" description="We'll email them a secure link to set up their account. You can assign projects next." />
      <Card><CardContent className="pt-6">
        <CreateUserForm
          roles={assignableRoles(ctx.profile.role)}
          advanced={ctx.profile.ui_mode === "advanced"}
          viewersCanDownload={settings?.viewers_can_download_by_default ?? false}
        />
      </CardContent></Card>
    </div>
  );
}
