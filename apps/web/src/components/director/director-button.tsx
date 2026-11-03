"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { DIRECTOR_STYLES, DIRECTOR_STYLE_INFO, type DirectorStyle } from "@/lib/director/schema";
import { cn } from "@/lib/utils";

/** "Create My Video Automatically" — Claude plans the video; the real render starts right away. */
export function DirectorButton({ listingId, beforeStart, compact = false, initialStyle = "listing_tour" }: {
  listingId: string | null;
  /** e.g. save the address first; return false to stop. */
  beforeStart?: () => Promise<string | null | false>;
  compact?: boolean;
  initialStyle?: DirectorStyle;
}) {
  const router = useRouter();
  const [style, setStyle] = useState<DirectorStyle>(initialStyle);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function go() {
    setError(null);
    let id = listingId;
    if (beforeStart) { const r = await beforeStart(); if (r === false) return; if (r) id = r; }
    if (!id) { setError("Add photos first."); return; }
    setBusy(true);
    const res = await fetch("/api/director", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ listingId: id, style }) }).catch(() => null);
    const body = await res?.json().catch(() => ({}));
    if (!res?.ok || !body?.runId) { setBusy(false); setError(body?.error ?? "The AI Director couldn't start. Check your connection and try again."); return; }
    router.push(`/director/${body.runId}`);
  }
  return (
    <div className="flex flex-col gap-3">
      <div role="radiogroup" aria-label="Video style" className={cn("grid gap-2", compact ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2 sm:grid-cols-3")}>
        {DIRECTOR_STYLES.map((s) => (
          <button key={s} type="button" role="radio" aria-checked={style === s} onClick={() => setStyle(s)} disabled={busy}
            className={cn("min-h-11 rounded-lg border-2 px-3 text-sm font-semibold", style === s ? "border-brand bg-brand/10" : "border-white/20 bg-white/5 hover:border-white/50")}>
            {DIRECTOR_STYLE_INFO[s].label}
          </button>
        ))}
      </div>
      <Button size="xl" className="bg-brand text-white hover:bg-brand/90" disabled={busy} onClick={() => void go()}>
        {busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
        {busy ? "Claude is studying your photos…" : "Create My Video Automatically"}
      </Button>
      {busy ? <p role="status" className="text-sm opacity-80">This takes about a minute: Claude looks at every photo, then plans the storyboard. The video starts rendering right after.</p> : null}
      {error ? <Alert variant="destructive"><AlertDescription className="text-base">{error}</AlertDescription></Alert> : null}
    </div>
  );
}
