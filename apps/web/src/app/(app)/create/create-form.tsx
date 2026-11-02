"use client";
import { useActionState, useState } from "react";
import Link from "next/link";
import { Check, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Field, FormMessage, SubmitButton, errorFor } from "@/components/form";
import { ASPECT_RATIOS, ASPECT_RATIO_LABELS } from "@/lib/validation";
import { cn } from "@/lib/utils";
import { createVideo } from "./actions";

interface Option { id: string; label: string; photos: number }
interface TemplateOption { id: string; name: string; description: string; aspect_ratios: string[] }

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-xl border bg-card p-5 sm:p-6" aria-labelledby={`step-${n}`}>
      <h2 id={`step-${n}`} className="flex items-center gap-3 text-xl font-semibold">
        <span className="flex size-9 items-center justify-center rounded-full bg-primary text-base text-primary-foreground">{n}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

export function CreateVideoForm({
  listings, templates, initialListing, advanced,
}: { listings: Option[]; templates: TemplateOption[]; initialListing?: string; advanced: boolean }) {
  const [state, action] = useActionState(createVideo, null);
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [listingId, setListingId] = useState(initialListing ?? listings[0]?.id ?? "");
  const selectedListing = listings.find((l) => l.id === listingId);

  return (
    <form action={action} className="flex flex-col gap-6" noValidate>
      <FormMessage state={state} />

      <Step n={1} title="Choose the home">
        {listings.length > 0 ? (
          <Field label="Listing" htmlFor="listing_id" error={errorFor(state, "listing_id")}>
            <NativeSelect name="listing_id" value={listingId} onChange={(e) => setListingId(e.target.value)}>
              {listings.map((l) => <option key={l.id} value={l.id}>{l.label} — {l.photos} photo{l.photos === 1 ? "" : "s"}</option>)}
            </NativeSelect>
          </Field>
        ) : (
          <p className="text-base text-muted-foreground">You don&apos;t have any listings yet.</p>
        )}
        {selectedListing && selectedListing.photos < 5 ? (
          <p className="text-base font-medium text-warning">
            A video needs at least 5 photos; this listing has {selectedListing.photos}.{" "}
            <Link className="underline" href={`/listings/${selectedListing.id}?step=2`}>Add photos</Link>.
          </p>
        ) : null}
        <Button variant="outline" asChild className="self-start"><Link href="/listings/new"><Plus aria-hidden="true" />Create a new listing</Link></Button>
      </Step>

      <Step n={2} title="Pick a style">
        <input type="hidden" name="template_id" value={templateId} />
        <div role="radiogroup" aria-label="Video style" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((t) => {
            const selected = t.id === templateId;
            return (
              <button
                key={t.id} type="button" role="radio" aria-checked={selected} onClick={() => setTemplateId(t.id)}
                className={cn(
                  "flex min-h-28 flex-col items-start gap-1 rounded-xl border-2 p-4 text-left transition-colors",
                  selected ? "border-primary bg-primary/5" : "border-border hover:border-primary/40",
                )}
              >
                <span className="flex w-full items-center justify-between text-lg font-semibold">
                  {t.name}
                  {selected ? <Check className="size-5 text-primary" aria-hidden="true" /> : null}
                </span>
                <span className="text-base text-muted-foreground">{t.description}</span>
              </button>
            );
          })}
        </div>
        {errorFor(state, "template_id") ? <p className="text-sm font-medium text-destructive">{errorFor(state, "template_id")}</p> : null}
      </Step>

      <Step n={3} title="Which shape first? (you can export all three later)">
        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="sr-only">Video shapes</legend>
          {ASPECT_RATIOS.map((r) => (
            <label key={r} className="flex min-h-14 cursor-pointer items-center gap-3 rounded-lg border px-4 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
              <input type="radio" name="aspect_ratios" value={r} defaultChecked={r === "16:9"} className="size-5 accent-[hsl(var(--primary))]" />
              <span className="text-base font-medium">{ASPECT_RATIO_LABELS[r]}</span>
            </label>
          ))}
        </fieldset>
        {errorFor(state, "aspect_ratios") ? <p className="text-sm font-medium text-destructive">{errorFor(state, "aspect_ratios")}</p> : null}
        {advanced ? (
          <Field label="Video name" htmlFor="title" optional hint="Leave empty to use the address and style.">
            <Input name="title" maxLength={160} />
          </Field>
        ) : null}
      </Step>

      <div className="flex flex-col gap-3 rounded-xl bg-sidebar p-5 text-white sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <p className="text-lg">We&apos;ll build a first version using your photos and company branding.</p>
        <SubmitButton size="xl" className="bg-brand text-white hover:bg-brand/90" disabled={listings.length === 0} pendingText="Creating…">
          Create and open the editor
        </SubmitButton>
      </div>
    </form>
  );
}
