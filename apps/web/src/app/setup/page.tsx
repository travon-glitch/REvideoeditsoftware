import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Clapperboard } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { isSupabaseConfigured } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { SetupForm } from "./setup-form";

export const metadata: Metadata = { title: "First-time setup" };
export const dynamic = "force-dynamic";

export default async function SetupPage() {
  let problem: string | null = null;
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    problem = "The server isn't connected to Supabase yet. Fill in apps/web/.env.local (see docs/SETUP.md).";
  } else {
    const { data: done, error } = await createAdminClient().rpc("bootstrap_is_complete");
    if (error) problem = "The database isn't ready. Apply the migrations in supabase/migrations first.";
    // Once setup is done this page no longer exists.
    else if (done) notFound();
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-sidebar px-4 py-12">
      <div className="flex items-center gap-3 text-white">
        <div className="flex size-11 items-center justify-center rounded-xl bg-brand">
          <Clapperboard className="size-6" aria-hidden="true" />
        </div>
        <p className="text-lg font-bold">Video Studio — first-time setup</p>
      </div>
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="text-2xl">Create the Super Admin</CardTitle>
          <CardDescription>
            This page works only once. The Super Admin can then invite everyone else from the Admin Panel.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {problem ? (
            <Alert variant="info">
              <AlertTitle>Not ready yet</AlertTitle>
              <AlertDescription>{problem}</AlertDescription>
            </Alert>
          ) : (
            <SetupForm />
          )}
        </CardContent>
      </Card>
    </main>
  );
}
