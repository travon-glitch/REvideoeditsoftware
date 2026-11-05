"use client";
import { useActionState, useState, useTransition } from "react";
import { KeyRound, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FormMessage, SubmitButton, errorFor } from "@/components/form";
import type { ActionResult } from "@/lib/auth/session";
import type { OrganizationSettingsRow } from "@/lib/database.types";
import { PROVIDER_KEYS, VIDEO_MODELS, maskSecret, type ProviderKeyId } from "@/lib/admin/control";
import { removeProviderKey, saveAiControls, saveProviderKey } from "../control-actions";

const dollars = (c: number | null) => (c == null ? "" : (c / 100).toString());

function Switch({ name, label, text, checked }: { name: string; label: string; text: string; checked: boolean }) {
  return (
    <label className="flex min-h-14 cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
      <input type="checkbox" name={name} defaultChecked={checked} className="mt-1 size-5 accent-[hsl(var(--primary))]" />
      <span><span className="block font-semibold">{label}</span><span className="block text-sm text-muted-foreground">{text}</span></span>
    </label>
  );
}

/** AI switches, the video model, prices for estimates, spending ceilings and the default per-person AI limit. */
export function AiControlsForm({ settings }: { settings: OrganizationSettingsRow }) {
  const [state, action] = useActionState(saveAiControls, null);
  const custom = !VIDEO_MODELS.some((m) => m.id === settings.video_ai_model);
  return (
    <form action={action} className="flex flex-col gap-6" noValidate>
      <FormMessage state={state} />
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-base font-semibold">AI features</legend>
        <div className="grid gap-3 md:grid-cols-2">
          <Switch name="ai_enabled" checked={settings.ai_enabled} label="Generative AI video clips"
            text="Camera Studio sends a listing photo to the video AI provider below. Costs money; stops at the spending ceilings." />
          <Switch name="ai_depth_motion_enabled" checked={settings.ai_depth_motion_enabled} label="AI depth camera moves"
            text="3D camera moves made on your own AI worker from one photo. Free; photos never leave your servers." />
          <Switch name="ai_voiceover_enabled" checked={settings.ai_voiceover_enabled} label="AI narration"
            text="Text-to-speech voiceovers, made on this server. Free." />
          <Switch name="ai_captions_enabled" checked={settings.ai_captions_enabled} label="Automatic captions"
            text="Speech recognition that writes and times captions, on this server. Free." />
        </div>
        <p className="text-sm text-muted-foreground">The AI Director (Claude) is switched on or off in its own section below. Switching a feature off stops new requests right away; finished clips stay.</p>
      </fieldset>
      <fieldset className="grid gap-5 sm:grid-cols-2">
        <legend className="mb-2 text-base font-semibold">Video AI provider</legend>
        <Field label="Default video AI model" htmlFor="video_ai_model" hint="Used for every new generative clip." error={errorFor(state, "video_ai_model")}>
          <Input id="video_ai_model" name="video_ai_model" list="video-models" defaultValue={settings.video_ai_model} autoComplete="off" />
          <datalist id="video-models">{VIDEO_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</datalist>
        </Field>
        <Field label="Price of one clip ($)" htmlFor="video_ai_clip_cost_dollars" hint="Your provider's price, used to estimate spending." error={errorFor(state, "video_ai_clip_cost_dollars")}>
          <Input id="video_ai_clip_cost_dollars" name="video_ai_clip_cost_dollars" inputMode="decimal" defaultValue={dollars(settings.video_ai_clip_cost_cents)} />
        </Field>
        {custom ? <p className="text-sm text-muted-foreground sm:col-span-2">Using a custom model id.</p> : null}
      </fieldset>
      <fieldset className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <legend className="mb-2 text-base font-semibold">Spending ceilings and limits</legend>
        <Field label="Monthly ceiling ($)" htmlFor="monthly_ai_budget_dollars" optional hint="Paid AI stops when reached." error={errorFor(state, "monthly_ai_budget_dollars")}>
          <Input id="monthly_ai_budget_dollars" name="monthly_ai_budget_dollars" inputMode="decimal" defaultValue={dollars(settings.monthly_ai_budget_cents)} placeholder="No ceiling" />
        </Field>
        <Field label="Daily ceiling ($)" htmlFor="daily_ai_budget_dollars" optional hint="Resets at midnight (server time)." error={errorFor(state, "daily_ai_budget_dollars")}>
          <Input id="daily_ai_budget_dollars" name="daily_ai_budget_dollars" inputMode="decimal" defaultValue={dollars(settings.daily_ai_budget_cents)} placeholder="No ceiling" />
        </Field>
        <Field label="Warn me at (%)" htmlFor="ai_budget_alert_percent" hint="Of either ceiling." error={errorFor(state, "ai_budget_alert_percent")}>
          <Input id="ai_budget_alert_percent" name="ai_budget_alert_percent" inputMode="numeric" defaultValue={settings.ai_budget_alert_percent} />
        </Field>
        <Field label="AI clips per new person / month" htmlFor="default_max_ai_generations_per_month" optional hint="Default for people you add." error={errorFor(state, "default_max_ai_generations_per_month")}>
          <Input id="default_max_ai_generations_per_month" name="default_max_ai_generations_per_month" inputMode="numeric" defaultValue={settings.default_max_ai_generations_per_month ?? ""} placeholder="No limit" />
        </Field>
      </fieldset>
      <SubmitButton size="lg" className="self-start">Save AI controls</SubmitButton>
    </form>
  );
}

/** Save, replace or remove a provider key. The saved key is never sent back to the browser — only its last 4 characters. */
export function ProviderKeyForm({ provider, last4, updatedAt, envKey, canStore }: { provider: ProviderKeyId; last4: string | null; updatedAt: string | null; envKey: boolean; canStore: boolean }) {
  const spec = PROVIDER_KEYS[provider];
  const [state, action] = useActionState(saveProviderKey, null);
  const [msg, setMsg] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-4">
      <p className="flex flex-wrap items-center gap-2 text-base">
        <KeyRound className="size-5 text-muted-foreground" aria-hidden="true" />
        {last4 ? <><span>Key saved:</span><code className="rounded bg-muted px-1.5 py-0.5 text-sm">{maskSecret(last4)}</code>{updatedAt ? <span className="text-sm text-muted-foreground">(saved {new Date(updatedAt).toLocaleDateString()})</span> : null}<span className="basis-full text-sm text-muted-foreground">It can&apos;t be shown again — only replaced or removed.</span></>
          : envKey ? "Using a key set on the AI worker server." : "No key yet."}
      </p>
      <form action={action} className="flex flex-col gap-3" noValidate>
        <input type="hidden" name="provider" value={provider} />
        <FormMessage state={state} />
        <Field label={last4 ? "Replace the API key" : "API key"} htmlFor={`${provider}_key`} hint={`${spec.hint} Stored encrypted; never shown in the browser again.`} error={errorFor(state, "api_key")}>
          <Input id={`${provider}_key`} name="api_key" type="password" autoComplete="off" disabled={!canStore} />
        </Field>
        {!canStore ? <p className="text-sm text-warning">The server can&apos;t store keys: SUPABASE_SERVICE_ROLE_KEY (or LVS_SECRETS_KEY) isn&apos;t set on the web server.</p> : null}
        <div className="flex flex-wrap gap-2">
          <SubmitButton disabled={!canStore}>Save key</SubmitButton>
          {last4 ? (
            <Button type="button" variant="ghost" className="text-destructive" disabled={pending}
              onClick={() => { if (window.confirm(`Remove the ${spec.label} key? New generative AI clips stop until a key is saved again.`)) start(async () => setMsg(await removeProviderKey(provider))); }}>
              <Trash2 aria-hidden="true" />Remove key
            </Button>
          ) : null}
        </div>
        {msg ? <p role="status" className={msg.ok ? "text-sm text-success" : "text-sm text-destructive"}>{msg.message}</p> : null}
      </form>
    </div>
  );
}
