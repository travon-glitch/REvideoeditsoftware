import { UserX } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Account not active" };

/* Signed in, but no active profile (not set up by an admin yet, or access turned off). */
export default function NoAccessPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-sidebar px-4">
      <Card className="w-full max-w-md text-center">
        <CardHeader className="items-center">
          <div className="flex size-14 items-center justify-center rounded-full bg-warning/15 text-warning">
            <UserX className="size-7" aria-hidden="true" />
          </div>
          <CardTitle className="text-2xl">Your account isn&apos;t active</CardTitle>
          <CardDescription>
            Your sign-in worked, but your account hasn&apos;t been set up or has been turned off. Please contact your administrator.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action="/auth/signout" method="post">
            <Button type="submit" size="lg" variant="outline" className="w-full">Sign out</Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
