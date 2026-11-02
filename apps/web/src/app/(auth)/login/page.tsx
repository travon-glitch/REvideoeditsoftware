import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { isSupabaseConfigured } from "@/lib/env";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : undefined;
  const notice = typeof params.notice === "string" ? params.notice : undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">Sign in</CardTitle>
        <CardDescription>Use the work email your administrator added you with.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {!isSupabaseConfigured() ? (
          <Alert variant="info">
            <AlertTitle>Almost ready</AlertTitle>
            <AlertDescription>
              This app isn&apos;t connected to its database yet. Your IT contact needs to follow docs/SETUP.md.
            </AlertDescription>
          </Alert>
        ) : null}
        {notice === "signed-out" ? (
          <Alert variant="success"><AlertDescription>You&apos;ve been signed out.</AlertDescription></Alert>
        ) : null}
        {notice === "link-expired" ? (
          <Alert variant="destructive"><AlertDescription>That link has expired or was already used. Ask your administrator for a new one.</AlertDescription></Alert>
        ) : null}
        {notice === "password-updated" ? (
          <Alert variant="success"><AlertDescription>Your password has been updated. Please sign in.</AlertDescription></Alert>
        ) : null}
        <LoginForm next={next} />
        <p className="text-center text-sm text-muted-foreground">
          There is no public sign-up. New team members are invited by an administrator.
        </p>
      </CardContent>
    </Card>
  );
}
