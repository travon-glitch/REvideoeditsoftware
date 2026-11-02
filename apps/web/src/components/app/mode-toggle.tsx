"use client";
import { useOptimistic, useTransition } from "react";
import { setUiMode } from "@/app/(app)/actions";
import { cn } from "@/lib/utils";

/** Easy Mode (default) hides advanced settings everywhere; Advanced Mode shows them. */
export function ModeToggle({ mode }: { mode: "easy" | "advanced" }) {
  const [optimistic, setOptimistic] = useOptimistic(mode);
  const [, startTransition] = useTransition();
  const choose = (next: "easy" | "advanced") =>
    startTransition(async () => {
      setOptimistic(next);
      await setUiMode(next);
    });
  return (
    <div role="radiogroup" aria-label="Screen mode" className="inline-flex rounded-lg border bg-muted p-1">
      {(["easy", "advanced"] as const).map((m) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={optimistic === m}
          onClick={() => choose(m)}
          className={cn(
            "min-h-9 rounded-md px-3 text-sm font-semibold transition-colors",
            optimistic === m ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {m === "easy" ? "Easy Mode" : "Advanced"}
        </button>
      ))}
    </div>
  );
}
