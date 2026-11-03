"use client";
import { useCallback, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CircleCheck, Circle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { isReady, readinessChecklist } from "@/lib/listings";
import type { ListingRow } from "@/lib/database.types";
import { cn } from "@/lib/utils";
import { deleteListing, finishListing } from "../actions";
import { PropertyForm, SaveIndicator, type PropertyFormHandle, type SaveState } from "./property-form";
import { PhotoManager, type ManagedPhoto } from "./photo-manager";

const STEPS = ["Property Information", "Upload Photos", "Save and Continue"] as const;

export function ListingWorkspace({
  listing, photos, orgId, initialStep, advanced, canDelete, canCreateVideo, agents = [],
}: {
  listing: ListingRow; photos: ManagedPhoto[]; orgId: string; initialStep: number; advanced: boolean;
  canDelete: boolean; canCreateVideo: boolean; agents?: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [step, setStep] = useState(initialStep);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  const [finishError, setFinishError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const formRef = useRef<PropertyFormHandle>(null);
  const onSaveState = useCallback((s: SaveState) => setSaveState(s), []);

  const goTo = async (n: number) => {
    if (n === step) return;
    if (step === 0 && formRef.current && !(await formRef.current.flush())) return; // keep them on the form to fix errors
    setStep(n);
    router.replace(`?step=${n + 1}`, { scroll: false });
    router.refresh(); // pick up the saved values for the summary
    window.scrollTo({ top: 0 });
  };

  const checklist = readinessChecklist({ ...listing, photoCount: photos.length, hasCover: !!listing.cover_asset_id });
  const ready = isReady(checklist);

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Listing steps">
        <ol className="grid gap-2 sm:grid-cols-3">
          {STEPS.map((label, i) => (
            <li key={label}>
              <button
                type="button" onClick={() => void goTo(i)} aria-current={i === step ? "step" : undefined}
                className={cn(
                  "flex min-h-14 w-full items-center gap-3 rounded-xl border-2 px-4 text-left text-base font-semibold transition-colors",
                  i === step ? "border-primary bg-primary/5 text-foreground" : "border-border bg-card text-muted-foreground hover:border-primary/40",
                )}
              >
                <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full text-sm", i === step ? "bg-primary text-primary-foreground" : "bg-muted")}>{i + 1}</span>
                {label}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <SaveIndicator state={step === 0 ? saveState : { kind: "saved" }} />
        <p className="text-sm text-muted-foreground">{listing.workflow_state === "draft" ? "Draft — saved automatically" : "Ready for videos"}</p>
      </div>

      <Card>
        <CardContent className="pt-6">
          {step === 0 ? (
            <PropertyForm ref={formRef} listing={listing} advanced={advanced} onSaveState={onSaveState} agents={agents} />
          ) : null}
          {step === 1 ? (
            <PhotoManager orgId={orgId} listingId={listing.id} photos={photos} coverId={listing.cover_asset_id} />
          ) : null}
          {step === 2 ? (
            <div className="flex flex-col gap-6">
              <div>
                <h2 className="text-xl font-semibold">{listing.address_line || "Untitled listing"}</h2>
                <p className="text-base text-muted-foreground">Everything is saved. You can come back to this listing any time from My Listings.</p>
              </div>
              <ul className="flex flex-col gap-2" aria-label="Checklist">
                {checklist.map((c) => (
                  <li key={c.label} className="flex items-center gap-3 text-base">
                    {c.done ? <CircleCheck className="size-5 text-success" aria-hidden="true" /> : <Circle className={cn("size-5", c.required ? "text-destructive" : "text-muted-foreground")} aria-hidden="true" />}
                    <span className={cn(!c.done && c.required && "font-semibold")}>{c.label}</span>
                    <span className="text-sm text-muted-foreground">{c.done ? "" : c.required ? "— needed for a video" : "— optional"}</span>
                  </li>
                ))}
              </ul>
              {finishError ? <Alert variant="destructive"><AlertDescription className="text-base">{finishError}</AlertDescription></Alert> : null}
              <div className="flex flex-wrap gap-3">
                {canCreateVideo ? (
                  <Button
                    size="lg" className="bg-brand text-white hover:bg-brand/90" disabled={!ready || pending}
                    onClick={() => start(async () => {
                      setFinishError(null);
                      const r = await finishListing(listing.id);
                      if (r && !r.ok) setFinishError(r.message);
                    })}
                  >
                    {pending ? "Saving…" : "Save and create a video"}
                  </Button>
                ) : null}
                <Button size="lg" variant="outline" asChild><Link href="/listings">Save draft and finish later</Link></Button>
              </div>
              {!ready ? <p className="text-base text-muted-foreground">Add the items marked above to create a video. Your draft is already saved.</p> : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="flex flex-wrap justify-between gap-3">
        <Button variant="outline" size="lg" disabled={step === 0} onClick={() => void goTo(step - 1)}>Back</Button>
        {step < 2 ? <Button size="lg" onClick={() => void goTo(step + 1)}>Next: {STEPS[step + 1]}</Button> : null}
      </div>

      {canDelete ? (
        <div className="border-t pt-6">
          <Button
            type="button" variant="ghost" className="text-destructive hover:text-destructive"
            onClick={() => {
              if (!window.confirm("Delete this listing and all its photos? This cannot be undone.")) return;
              start(async () => {
                const r = await deleteListing(listing.id);
                if (r && !r.ok) window.alert(r.message);
              });
            }}
          >
            <Trash2 aria-hidden="true" /> Delete listing
          </Button>
        </div>
      ) : null}
    </div>
  );
}
