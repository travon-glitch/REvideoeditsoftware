"use client";
import { useEffect } from "react";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="flex flex-col items-center gap-6 rounded-xl border bg-card px-6 py-16 text-center">
      <div className="flex size-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <TriangleAlert className="size-7" aria-hidden="true" />
      </div>
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">This page didn&apos;t load</h1>
        <p className="text-base text-muted-foreground">Please try again. Your saved work is safe.</p>
        {error.digest ? <p className="text-sm text-muted-foreground">Reference: {error.digest}</p> : null}
      </div>
      <div className="flex flex-wrap justify-center gap-3">
        <Button size="lg" onClick={reset}>Try again</Button>
        <Button size="lg" variant="outline" asChild><Link href="/dashboard">Go to Dashboard</Link></Button>
      </div>
    </div>
  );
}
