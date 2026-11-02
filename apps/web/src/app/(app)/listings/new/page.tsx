import { House } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { SubmitButton } from "@/components/form";
import { createDraftListing } from "../actions";

export const metadata = { title: "Create listing" };

export default async function NewListingPage() {
  await requirePermission("listings.create");
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Create a listing" description="Three simple parts. Nothing is required to start — your work is saved as a draft as you go." />
      <Card>
        <CardContent className="flex flex-col items-start gap-6 pt-6">
          <ol className="flex flex-col gap-3 text-lg">
            <li><strong>1. Property Information</strong> — address, price, rooms, agent and open house.</li>
            <li><strong>2. Upload Photos</strong> — 5 to 30 photos; drag to set the order and pick the main photo.</li>
            <li><strong>3. Save and Continue</strong> — check everything and go straight to making a video.</li>
          </ol>
          <form action={createDraftListing}>
            <SubmitButton size="xl" pendingText="Starting…"><House aria-hidden="true" />Start a new listing</SubmitButton>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
