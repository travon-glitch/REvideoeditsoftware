import Link from "next/link";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";

export const metadata = { title: "No permission" };

export default function ForbiddenPage() {
  return (
    <EmptyState
      icon={Lock}
      title="You don't have access to this page"
      description="Ask an administrator if you need it."
      action={<Button asChild size="lg"><Link href="/dashboard">Go to Dashboard</Link></Button>}
    />
  );
}
