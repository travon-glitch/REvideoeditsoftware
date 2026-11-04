import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Continue" };

/*
 * Emailed links land here first. The one-time code is used only when the person presses the button,
 * so company email scanners that open links (e.g. Outlook Safe Links) can't use up an invitation.
 */
export default async function ContinuePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { token_hash: token = "", type = "", next = "" } = await searchParams;
  const invite = type === "invite";
  const recovery = type === "recovery";
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">{invite ? "Welcome!" : recovery ? "Reset your password" : "Confirm"}</CardTitle>
        <CardDescription className="text-base">
          {invite ? "Press the button to set up your account." : recovery ? "Press the button to choose a new password." : "Press the button to continue."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form method="post" action="/auth/confirm">
          <input type="hidden" name="token_hash" value={token.slice(0, 200)} />
          <input type="hidden" name="type" value={type.slice(0, 20)} />
          <input type="hidden" name="next" value={next.slice(0, 200)} />
          <Button type="submit" size="lg" className="w-full">{invite ? "Set up my account" : recovery ? "Choose a new password" : "Continue"}</Button>
        </form>
      </CardContent>
    </Card>
  );
}
