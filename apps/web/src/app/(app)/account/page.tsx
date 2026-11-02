import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from "@/lib/auth/roles";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { ProfileForm } from "./account-forms";

export const metadata = { title: "My account" };

export default async function AccountPage() {
  const ctx = await requireSession();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="My account" />
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>
            {ctx.email}{ctx.profile.job_title ? ` · ${ctx.profile.job_title}` : ""} · {ROLE_LABELS[ctx.profile.role]} — {ROLE_DESCRIPTIONS[ctx.profile.role]}
            <br />
            {ctx.profile.can_download ? "You can download videos." : "Downloads are turned off for your account."}
            {ctx.profile.role !== "viewer" ? (ctx.profile.can_use_ai ? " You can use AI features." : " AI features are turned off for your account.") : ""}
          </CardDescription>
        </CardHeader>
        <CardContent><ProfileForm firstName={ctx.profile.first_name} lastName={ctx.profile.last_name} /></CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Password</CardTitle></CardHeader>
        <CardContent><Button asChild variant="outline" size="lg"><Link href="/account/password">Change my password</Link></Button></CardContent>
      </Card>
    </div>
  );
}
