import { Info } from "lucide-react";

/** Marks a feature whose engine is connected in a later build stage. */
export function ComingSoonNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-base">
      <Info className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
      <p>{children}</p>
    </div>
  );
}
