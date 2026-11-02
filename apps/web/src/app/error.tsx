"use client";
import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="flex size-16 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <TriangleAlert className="size-8" aria-hidden="true" />
      </div>
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">Something went wrong</h1>
        <p className="text-lg text-muted-foreground">Please try again. If it keeps happening, tell your administrator.</p>
        {error.digest ? <p className="text-sm text-muted-foreground">Reference: {error.digest}</p> : null}
      </div>
      <Button size="lg" onClick={reset}>Try again</Button>
    </main>
  );
}
