"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Layers, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function GenerateButton({ listingId, disabled, reason }: { listingId: string; disabled: boolean; reason: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function go() {
    setBusy(true); setError(null);
    const res = await fetch("/api/batches", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ listingId }) }).catch(() => null);
    const body = await res?.json().catch(() => ({}));
    if (!res?.ok || !body?.batchId) { setBusy(false); setError(body?.error ?? "We couldn't start. Check your connection and try again."); return; }
    router.push(`/batches/${body.batchId}`);
  }
  return (
    <div className="flex flex-col gap-2">
      <Button size="xl" className="h-16 w-full bg-brand text-xl text-white hover:bg-brand/90" disabled={disabled || busy} onClick={() => void go()}>
        {busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Layers aria-hidden="true" />}
        {busy ? "Building six storyboards…" : "Generate 6 Videos"}
      </Button>
      {reason ? <p className="text-sm font-medium text-warning">{reason}</p> : null}
      {error ? <Alert variant="destructive"><AlertDescription className="text-base">{error}</AlertDescription></Alert> : null}
    </div>
  );
}
