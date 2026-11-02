"use client";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { CircleCheck, LoaderCircle, TriangleAlert } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Field } from "@/components/form";
import { LISTING_STATUSES, LISTING_STATUS_LABELS } from "@/lib/validation";
import { PROPERTY_TYPES, PROPERTY_TYPE_LABELS } from "@/lib/listings";
import type { ListingRow } from "@/lib/database.types";
import { saveListingDraft } from "../actions";

export type SaveState = { kind: "idle" | "saving" | "saved" | "error"; message?: string };
export interface PropertyFormHandle { flush: () => Promise<boolean> }

const AUTOSAVE_MS = 1200;

/** Property Information — saves automatically a moment after each change. Nothing is required for a draft. */
export const PropertyForm = forwardRef<PropertyFormHandle, {
  listing: ListingRow; advanced: boolean; onSaveState: (s: SaveState) => void;
}>(function PropertyForm({ listing, advanced, onSaveState }, ref) {
  const formRef = useRef<HTMLFormElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const save = useCallback(async (): Promise<boolean> => {
    if (!formRef.current) return true;
    if (inFlight.current) await inFlight.current;
    if (!dirty.current) return true;
    dirty.current = false;
    onSaveState({ kind: "saving" });
    const run = (async () => {
      const result = await saveListingDraft(listing.id, new FormData(formRef.current!));
      if (result.ok) {
        setErrors({});
        onSaveState({ kind: "saved" });
        return true;
      }
      setErrors(result.fieldErrors ?? {});
      onSaveState({ kind: "error", message: result.message });
      return false;
    })();
    inFlight.current = run;
    try {
      return await run;
    } finally {
      inFlight.current = null;
    }
  }, [listing.id, onSaveState]);

  const schedule = () => {
    dirty.current = true;
    onSaveState({ kind: "idle", message: "Unsaved changes" });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), AUTOSAVE_MS);
  };

  useImperativeHandle(ref, () => ({
    flush: async () => {
      if (timer.current) clearTimeout(timer.current);
      return save();
    },
  }), [save]);

  // Warn before leaving with unsaved typing; save when the tab is hidden.
  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => { if (dirty.current) e.preventDefault(); };
    const hidden = () => { if (document.visibilityState === "hidden" && dirty.current) void save(); };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("visibilitychange", hidden);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [save]);

  const v = (k: keyof ListingRow) => (listing[k] ?? "") as string | number;
  const e = (k: string) => errors[k];

  return (
    <form ref={formRef} onChange={schedule} onSubmit={(ev) => { ev.preventDefault(); void save(); }} className="flex flex-col gap-8" noValidate>
      <fieldset className="grid gap-5 sm:grid-cols-6">
        <legend className="mb-3 text-lg font-semibold">The home</legend>
        <Field className="sm:col-span-6" label="Property address" htmlFor="address_line" hint="Needed before you make a video. You can save a draft without it." error={e("address_line")}>
          <Input name="address_line" defaultValue={v("address_line")} autoComplete="street-address" placeholder="e.g. 742 Evergreen Terrace" />
        </Field>
        <Field className="sm:col-span-3" label="City" htmlFor="city" error={e("city")}>
          <Input name="city" defaultValue={v("city")} autoComplete="address-level2" />
        </Field>
        <Field className="sm:col-span-1" label="State" htmlFor="state" error={e("state")}>
          <Input name="state" defaultValue={v("state")} autoComplete="address-level1" maxLength={60} />
        </Field>
        <Field className="sm:col-span-2" label="ZIP" htmlFor="postal_code" error={e("postal_code")}>
          <Input name="postal_code" defaultValue={v("postal_code")} autoComplete="postal-code" inputMode="numeric" />
        </Field>
        <Field className="sm:col-span-3" label="Property type" htmlFor="property_type" error={e("property_type")}>
          <NativeSelect name="property_type" defaultValue={listing.property_type ?? ""}>
            <option value="">Choose…</option>
            {PROPERTY_TYPES.map((t) => <option key={t} value={t}>{PROPERTY_TYPE_LABELS[t]}</option>)}
          </NativeSelect>
        </Field>
        <Field className="sm:col-span-3" label="Listing price" htmlFor="price" hint="For example 525,000" error={e("price")}>
          <Input name="price" inputMode="decimal" defaultValue={v("price")} />
        </Field>
        <Field className="sm:col-span-2" label="Bedrooms" htmlFor="bedrooms" error={e("bedrooms")}>
          <Input name="bedrooms" inputMode="decimal" defaultValue={v("bedrooms")} />
        </Field>
        <Field className="sm:col-span-2" label="Bathrooms" htmlFor="bathrooms" error={e("bathrooms")}>
          <Input name="bathrooms" inputMode="decimal" defaultValue={v("bathrooms")} />
        </Field>
        <Field className="sm:col-span-2" label="Square footage" htmlFor="square_feet" error={e("square_feet")}>
          <Input name="square_feet" inputMode="numeric" defaultValue={v("square_feet")} />
        </Field>
        <Field className="sm:col-span-6" label="Property description" htmlFor="description" hint="Used later to write the video's voice-over." error={e("description")}>
          <Textarea name="description" defaultValue={v("description")} rows={5} />
        </Field>
        {advanced ? (
          <>
            <Field className="sm:col-span-3" label="Listing status" htmlFor="status" error={e("status")}>
              <NativeSelect name="status" defaultValue={listing.status}>
                {LISTING_STATUSES.map((s) => <option key={s} value={s}>{LISTING_STATUS_LABELS[s]}</option>)}
              </NativeSelect>
            </Field>
            <Field className="sm:col-span-3" label="MLS number" htmlFor="mls_number" error={e("mls_number")}>
              <Input name="mls_number" defaultValue={v("mls_number")} />
            </Field>
          </>
        ) : (
          <>
            <input type="hidden" name="status" value={listing.status} />
            <input type="hidden" name="mls_number" value={v("mls_number")} />
          </>
        )}
      </fieldset>

      <fieldset className="grid gap-5 sm:grid-cols-2">
        <legend className="mb-3 text-lg font-semibold">Agent and contact</legend>
        <Field label="Agent name" htmlFor="agent_name" error={e("agent_name")}>
          <Input name="agent_name" defaultValue={v("agent_name")} autoComplete="name" />
        </Field>
        <Field label="Brokerage" htmlFor="brokerage" error={e("brokerage")}>
          <Input name="brokerage" defaultValue={v("brokerage")} autoComplete="organization" />
        </Field>
        <Field label="Contact phone" htmlFor="contact_phone" error={e("contact_phone")}>
          <Input name="contact_phone" type="tel" defaultValue={v("contact_phone")} autoComplete="tel" />
        </Field>
        <Field label="Contact email" htmlFor="contact_email" error={e("contact_email")}>
          <Input name="contact_email" type="email" defaultValue={v("contact_email")} autoComplete="email" />
        </Field>
      </fieldset>

      <fieldset className="grid gap-5 sm:grid-cols-3">
        <legend className="mb-3 text-lg font-semibold">Open house <span className="font-normal text-muted-foreground">(if there is one)</span></legend>
        <Field label="Date" htmlFor="open_house_date" error={e("open_house_date")}>
          <Input name="open_house_date" type="date" defaultValue={v("open_house_date")} />
        </Field>
        <Field label="Starts" htmlFor="open_house_start" error={e("open_house_start")}>
          <Input name="open_house_start" type="time" defaultValue={String(v("open_house_start")).slice(0, 5)} />
        </Field>
        <Field label="Ends" htmlFor="open_house_end" error={e("open_house_end")}>
          <Input name="open_house_end" type="time" defaultValue={String(v("open_house_end")).slice(0, 5)} />
        </Field>
      </fieldset>
    </form>
  );
});

export function SaveIndicator({ state }: { state: SaveState }) {
  return (
    <p role="status" aria-live="polite" className="flex min-h-6 items-center gap-2 text-sm">
      {state.kind === "saving" ? <><LoaderCircle className="size-4 animate-spin" aria-hidden="true" /><span>Saving…</span></> : null}
      {state.kind === "saved" ? <><CircleCheck className="size-4 text-success" aria-hidden="true" /><span className="text-success">All changes saved</span></> : null}
      {state.kind === "error" ? <><TriangleAlert className="size-4 text-destructive" aria-hidden="true" /><span className="text-destructive">{state.message}</span></> : null}
      {state.kind === "idle" && state.message ? <span className="text-muted-foreground">{state.message}</span> : null}
    </p>
  );
}
