import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { needsCurrentPassword } from "@/lib/auth/reauth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PasswordForm } from "../account-forms";

export const metadata = { title: "Set password" };

export default async function PasswordPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireSession();
  const { welcome } = await searchParams;
  const askCurrent = await needsCurrentPassword(await createClient());
  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle className="text-2xl">{welcome ? `Welcome, ${ctx.profile.full_name.split(" ")[0] || "there"}!` : "Choose a new password"}</CardTitle>
        <CardDescription>{welcome ? "Choose a password to finish setting up your account." : "You'll use it the next time you sign in."}</CardDescription>
      </CardHeader>
      <CardContent><PasswordForm askCurrent={askCurrent} submitLabel={welcome ? "Finish and go to Dashboard" : "Save new password"} /></CardContent>
    </Card>
  );
}
