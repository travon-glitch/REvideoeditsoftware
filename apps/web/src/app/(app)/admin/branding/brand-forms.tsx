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
import { BRAND_FONTS } from "@/lib/video/plan";
import { saveBrandKit, setBrandLogo } from "../actions";



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

const INTRO_INFO: Record<string, string> = {
  "logo-reveal": "Logo reveal — your logo on a brand panel that lifts away to show the home",
  "bar-wipe": "Bar wipe — a brand-colour bar sweeps across with the title",
  "title-card": "Title card — a full card with the video's title and a drawn line",
  none: "No intro",
};
const OUTRO_INFO: Record<string, string> = {
  "agent-card": "Agent card — headshot, name, phone, email and brokerage",
  "logo-end": "Logo end card — company logo, name and phone",
  "contact-bar": "Contact bar — a lower bar with the agent's name and phone",
  none: "No end card",
};
const LAYOUT_INFO: Record<string, string> = {
  "photo-left": "Photo left, details right (wide videos; stacked on tall ones)",
  centered: "Photo on top, details centred",
  minimal: "No photo, details only",
};
const MOODS = ["elegant", "calm", "upbeat", "warm", "inspiring"] as const;

function Choice({ name, value, options, legend }: { name: string; value: string; options: Record<string, string>; legend: string }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-base font-semibold">{legend}</legend>
      {Object.entries(options).map(([k, label]) => (
        <label key={k} className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
          <input type="radio" name={name} value={k} defaultChecked={value === k} className="mt-1 size-4" />
          <span className="text-sm">{label}</span>
        </label>
      ))}
    </fieldset>
  );
}

export function BrandKitForm({ kit, tracks }: { kit: BrandKitRow | null; advanced?: boolean; tracks: { id: string; title: string; mood: string }[] }) {
  const [state, action] = useActionState(saveBrandKit, null);
  return (
    <form action={action} className="flex flex-col gap-8" noValidate>
      <FormMessage state={state} />
      <section className="grid gap-5 sm:grid-cols-2" aria-labelledby="bk-company">
        <h3 id="bk-company" className="text-lg font-semibold sm:col-span-2">Company and brokerage</h3>
        <Field label="Company name on videos" htmlFor="company_name" optional error={errorFor(state, "company_name")}>
          <Input name="company_name" defaultValue={kit?.company_name ?? ""} />
        </Field>
        <Field label="Tagline" htmlFor="tagline" optional error={errorFor(state, "tagline")}>
          <Input name="tagline" defaultValue={kit?.tagline ?? ""} />
        </Field>
        <Field label="Brokerage name" htmlFor="brokerage_name" optional hint="Shown on agent cards when an agent profile has no brokerage" error={errorFor(state, "brokerage_name")}>
          <Input name="brokerage_name" defaultValue={kit?.brokerage_name ?? ""} />
        </Field>
        <Field label="Brokerage licence" htmlFor="brokerage_license" optional error={errorFor(state, "brokerage_license")}>
          <Input name="brokerage_license" defaultValue={kit?.brokerage_license ?? ""} />
        </Field>
      </section>

      <section className="grid gap-5 sm:grid-cols-3" aria-labelledby="bk-colors">
        <h3 id="bk-colors" className="text-lg font-semibold sm:col-span-3">Colours and fonts</h3>
        <ColorField name="primary_color" label="Main colour" value={kit?.primary_color ?? "#1D4ED8"} error={errorFor(state, "primary_color")} />
        <ColorField name="secondary_color" label="Panel colour" value={kit?.secondary_color ?? "#0F172A"} error={errorFor(state, "secondary_color")} />
        <ColorField name="accent_color" label="Highlight colour" value={kit?.accent_color ?? "#F59E0B"} error={errorFor(state, "accent_color")} />
        <Field label="Title font" htmlFor="heading_font" error={errorFor(state, "heading_font")}>
          <NativeSelect name="heading_font" defaultValue={kit?.heading_font ?? "Montserrat"}>
            {BRAND_FONTS.map((f) => <option key={f}>{f}</option>)}
          </NativeSelect>
        </Field>
        <Field label="Text font" htmlFor="body_font" error={errorFor(state, "body_font")}>
          <NativeSelect name="body_font" defaultValue={kit?.body_font ?? "Inter"}>
            {BRAND_FONTS.map((f) => <option key={f}>{f}</option>)}
          </NativeSelect>
        </Field>
      </section>

      <section className="grid gap-5 lg:grid-cols-3" aria-labelledby="bk-anim">
        <h3 id="bk-anim" className="text-lg font-semibold lg:col-span-3">Intro, outro and agent card</h3>
        <Choice name="intro_style" legend="Intro animation" value={kit?.intro_style ?? "logo-reveal"} options={INTRO_INFO} />
        <Choice name="outro_style" legend="Outro animation" value={kit?.outro_style ?? "agent-card"} options={OUTRO_INFO} />
        <Choice name="agent_layout" legend="Agent contact layout" value={kit?.agent_layout ?? "photo-left"} options={LAYOUT_INFO} />
        <p className="text-sm text-muted-foreground lg:col-span-3">Templates use these unless a template has its own intro or outro.</p>
      </section>

      <section className="grid gap-5" aria-labelledby="bk-legal">
        <h3 id="bk-legal" className="text-lg font-semibold">Disclosures and closing message</h3>
        <Field label="Brokerage disclosure" htmlFor="disclaimer" optional hint="For example your brokerage licence and equal-housing statement. Shown small on the last scene." error={errorFor(state, "disclaimer")}>
          <Textarea name="disclaimer" defaultValue={kit?.disclaimer ?? ""} maxLength={500} rows={3} />
        </Field>
        <label className="flex items-center gap-3 text-base">
          <input type="checkbox" name="disclosure_required" defaultChecked={kit?.disclosure_required ?? false} className="size-5" />
          Required on every video
        </label>
        <Field label="Closing message" htmlFor="outro_text" optional hint="Used by older Easy Mode styles, e.g. your website." error={errorFor(state, "outro_text")}>
          <Input name="outro_text" defaultValue={kit?.outro_text ?? ""} maxLength={280} />
        </Field>
      </section>

      <section className="grid gap-5 sm:grid-cols-3" aria-labelledby="bk-music">
        <h3 id="bk-music" className="text-lg font-semibold sm:col-span-3">Default music</h3>
        <Field label="Preferred mood" htmlFor="music_mood" error={errorFor(state, "music_mood")}>
          <NativeSelect name="music_mood" defaultValue={kit?.music_mood ?? "calm"}>
            {MOODS.map((m) => <option key={m} value={m}>{m[0]!.toUpperCase() + m.slice(1)}</option>)}
          </NativeSelect>
        </Field>
        <Field label="Default track" htmlFor="music_asset_id" optional hint="Only tracks verified for commercial use" error={errorFor(state, "music_asset_id")}>
          <NativeSelect name="music_asset_id" defaultValue={kit?.music_asset_id ?? ""}>
            <option value="">Pick by mood</option>
            {tracks.map((t) => <option key={t.id} value={t.id}>{t.title} ({t.mood})</option>)}
          </NativeSelect>
        </Field>
        <Field label="Music volume" htmlFor="music_volume" error={errorFor(state, "music_volume")}>
          <NativeSelect name="music_volume" defaultValue={String(kit?.music_volume ?? 0.65)}>
            {[0.4, 0.5, 0.65, 0.8, 1].map((v) => <option key={v} value={v}>{Math.round(v * 100)}%</option>)}
          </NativeSelect>
        </Field>
        <label className="flex items-center gap-3 text-base sm:col-span-3">
          <input type="checkbox" name="music_follow_template" defaultChecked={kit?.music_follow_template ?? true} className="size-5" />
          Let each template pick music that suits it (from the verified library)
        </label>
      </section>
      <SubmitButton size="lg" className="self-start">Save brand kit</SubmitButton>
    </form>
  );
}

export function LogoUploader({ orgId, currentUrl, enabled, which = "logo" }: { orgId: string; currentUrl: string | null; enabled: boolean; which?: "logo" | "brokerage" }) {
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
    const result = await setBrandLogo(path, which);
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
