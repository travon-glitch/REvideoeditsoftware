import Link from "next/link";
import { MapPinOff } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="flex size-16 items-center justify-center rounded-full bg-primary/10 text-primary">
        <MapPinOff className="size-8" aria-hidden="true" />
      </div>
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">We couldn&apos;t find that page</h1>
        <p className="text-lg text-muted-foreground">It may have been moved, or you may not have access to it.</p>
      </div>
      <Button asChild size="lg">
        <Link href="/dashboard">Go to the Dashboard</Link>
      </Button>
    </main>
  );
}
