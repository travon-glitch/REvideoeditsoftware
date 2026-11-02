"use client";
import { useActionState, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImageUp, LoaderCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Field, FormMessage, SubmitButton, errorFor } from "@/components/form";
import { createClient } from "@/lib/supabase/client";
import { BUCKETS, LOGO_MIME_TYPES, brandLogoPath, checkLogoFile } from "@/lib/storage";
import type { BrandKitRow } from "@/lib/database.types";
import { saveBrandKit, setBrandLogo } from "../actions";

const FONTS = ["Montserrat", "Inter", "Playfair Display", "Poppins", "Lato", "Roboto", "Oswald", "DM Sans", "Bebas Neue", "Abril Fatface"];

function ColorField({ name, label, value, error }: { name: string; label: string; value: string; error?: string }) {
  const [color, setColor] = useState(value);
  return (
    <Field label={label} htmlFor={name} error={error}>
      <div className="flex items-center gap-3">
        <input type="color" aria-label={`${label} picker`} value={color} onChange={(e) => setColor(e.target.value.toUpperCase())} className="h-11 w-14 cursor-pointer rounded-lg border bg-background p-1" />
        <Input name={name} value={color} onChange={(e) => setColor(e.target.value)} className="font-mono uppercase" maxLength={7} />
      </div>
    </Field>
  );
}

export function BrandKitForm({ kit, advanced }: { kit: BrandKitRow | null; advanced: boolean }) {
  const [state, action] = useActionState(saveBrandKit, null);
  return (
    <form action={action} className="flex flex-col gap-6" noValidate>
      <FormMessage state={state} />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Company name on videos" htmlFor="company_name" optional error={errorFor(state, "company_name")}>
          <Input name="company_name" defaultValue={kit?.company_name ?? ""} />
        </Field>
        <Field label="Tagline" htmlFor="tagline" optional error={errorFor(state, "tagline")}>
          <Input name="tagline" defaultValue={kit?.tagline ?? ""} />
        </Field>
        <ColorField name="primary_color" label="Main color" value={kit?.primary_color ?? "#1D4ED8"} error={errorFor(state, "primary_color")} />
        {advanced ? (
          <>
            <ColorField name="secondary_color" label="Second color" value={kit?.secondary_color ?? "#0F172A"} error={errorFor(state, "secondary_color")} />
            <ColorField name="accent_color" label="Highlight color" value={kit?.accent_color ?? "#F59E0B"} error={errorFor(state, "accent_color")} />
          </>
        ) : (
          <>
            <input type="hidden" name="secondary_color" value={kit?.secondary_color ?? "#0F172A"} />
            <input type="hidden" name="accent_color" value={kit?.accent_color ?? "#F59E0B"} />
          </>
        )}
        <Field label="Title font" htmlFor="heading_font" error={errorFor(state, "heading_font")}>
          <NativeSelect name="heading_font" defaultValue={kit?.heading_font ?? "Montserrat"}>
            {FONTS.map((f) => <option key={f}>{f}</option>)}
          </NativeSelect>
        </Field>
        <Field label="Text font" htmlFor="body_font" error={errorFor(state, "body_font")}>
          <NativeSelect name="body_font" defaultValue={kit?.body_font ?? "Inter"}>
            {FONTS.map((f) => <option key={f}>{f}</option>)}
          </NativeSelect>
        </Field>
        <Field className="sm:col-span-2" label="Closing message" htmlFor="outro_text" optional hint="Shown at the end of every video, e.g. your phone number or website." error={errorFor(state, "outro_text")}>
          <Input name="outro_text" defaultValue={kit?.outro_text ?? ""} maxLength={280} />
        </Field>
        <Field className="sm:col-span-2" label="Legal text" htmlFor="disclaimer" optional hint="For example your brokerage license and equal-housing statement." error={errorFor(state, "disclaimer")}>
          <Textarea name="disclaimer" defaultValue={kit?.disclaimer ?? ""} maxLength={500} rows={3} />
        </Field>
      </div>
      <SubmitButton size="lg" className="self-start">Save branding</SubmitButton>
    </form>
  );
}

export function LogoUploader({ orgId, currentUrl, enabled }: { orgId: string; currentUrl: string | null; enabled: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    const check = checkLogoFile(file);
    if (!check.ok) return setMsg({ ok: false, text: check.reason });
    setBusy(true);
    setMsg(null);
    const supabase = createClient();
    const path = brandLogoPath(orgId, crypto.randomUUID(), file.type);
    const { error } = await supabase.storage.from(BUCKETS.brandAssets).upload(path, file, { contentType: file.type, upsert: false });
    if (error) {
      setBusy(false);
      return setMsg({ ok: false, text: "The logo couldn't be uploaded." });
    }
    const result = await setBrandLogo(path);
    if (!result.ok) await supabase.storage.from(BUCKETS.brandAssets).remove([path]);
    setMsg({ ok: result.ok, text: result.message ?? "" });
    setBusy(false);
    if (ref.current) ref.current.value = "";
    if (result.ok) router.refresh();
  }

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <div className="flex size-28 shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {currentUrl ? <img src={currentUrl} alt="Current logo" className="size-full object-contain p-2" /> : <span className="text-sm text-muted-foreground">No logo</span>}
      </div>
      <div className="flex flex-col gap-3">
        <label className={`inline-flex min-h-11 cursor-pointer items-center gap-2 self-start rounded-lg border bg-background px-5 text-base font-semibold shadow-sm hover:bg-accent focus-within:ring-2 focus-within:ring-ring ${!enabled || busy ? "pointer-events-none opacity-50" : ""}`}>
          {busy ? <LoaderCircle className="size-5 animate-spin" aria-hidden="true" /> : <ImageUp className="size-5" aria-hidden="true" />}
          {busy ? "Uploading…" : currentUrl ? "Replace logo" : "Upload logo"}
          <input ref={ref} type="file" accept={LOGO_MIME_TYPES.join(",")} className="sr-only" disabled={!enabled || busy} onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
        <p className="text-sm text-muted-foreground">PNG with a transparent background works best. Up to 10 MB.</p>
        {!enabled ? <p className="text-sm text-muted-foreground">Save the branding form once before adding a logo.</p> : null}
        {msg ? <Alert variant={msg.ok ? "success" : "destructive"}><AlertDescription>{msg.text}</AlertDescription></Alert> : null}
      </div>
    </div>
  );
}
