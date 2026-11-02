"use client";
import { useActionState } from "react";
import { Input } from "@/components/ui/input";
import { Field, FormMessage, SubmitButton, errorFor } from "@/components/form";
import type { OrganizationSettingsRow } from "@/lib/database.types";
import { saveOrgSettings } from "../actions";

export function SettingsForm({ settings }: { settings: OrganizationSettingsRow }) {
  const [state, action] = useActionState(saveOrgSettings, null);
  return (
    <form action={action} className="flex flex-col gap-6" noValidate>
      <FormMessage state={state} />
      <label className="flex min-h-14 cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
        <input type="checkbox" name="ai_enabled" defaultChecked={settings.ai_enabled} className="mt-1 size-5 accent-[hsl(var(--primary))]" />
        <span><span className="block font-semibold">AI features switched on</span><span className="block text-sm text-muted-foreground">Turn on after an AI service has been approved and connected.</span></span>
      </label>
      <label className="flex min-h-14 cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
        <input type="checkbox" name="viewers_can_download_by_default" defaultChecked={settings.viewers_can_download_by_default} className="mt-1 size-5 accent-[hsl(var(--primary))]" />
        <span><span className="block font-semibold">New Viewers may download by default</span><span className="block text-sm text-muted-foreground">You can still change it for each person.</span></span>
      </label>
      <div className="grid gap-5 sm:grid-cols-3">
        <Field label="AI spending ceiling ($ per month)" htmlFor="monthly_ai_budget_dollars" optional hint="Paid AI jobs stop when it's reached." error={errorFor(state, "monthly_ai_budget_dollars")}>
          <Input name="monthly_ai_budget_dollars" inputMode="decimal" defaultValue={settings.monthly_ai_budget_cents != null ? (settings.monthly_ai_budget_cents / 100).toString() : ""} />
        </Field>
        <Field label="Default videos per person / month" htmlFor="default_max_videos_per_month" optional error={errorFor(state, "default_max_videos_per_month")}>
          <Input name="default_max_videos_per_month" inputMode="numeric" defaultValue={settings.default_max_videos_per_month ?? ""} />
        </Field>
        <Field label="Default AI generations per person / month" htmlFor="default_max_ai_generations_per_month" optional error={errorFor(state, "default_max_ai_generations_per_month")}>
          <Input name="default_max_ai_generations_per_month" inputMode="numeric" defaultValue={settings.default_max_ai_generations_per_month ?? ""} />
        </Field>
      </div>
      <fieldset className="flex flex-col gap-4 rounded-lg border p-4">
        <legend className="px-1 text-base font-semibold">Generate 6 Videos and rendering</legend>
        <div className="grid gap-5 sm:grid-cols-3">
          <Field label="Maximum batch size" htmlFor="max_batch_size" hint="Videos per click (1–12)." error={errorFor(state, "max_batch_size")}>
            <Input name="max_batch_size" inputMode="numeric" defaultValue={settings.max_batch_size} />
          </Field>
          <Field label="Videos rendering at once" htmlFor="concurrent_render_limit" hint="For the whole company (1–50)." error={errorFor(state, "concurrent_render_limit")}>
            <Input name="concurrent_render_limit" inputMode="numeric" defaultValue={settings.concurrent_render_limit} />
          </Field>
          <Field label="Daily video limit per person" htmlFor="daily_video_limit" optional hint="Leave empty for no daily limit." error={errorFor(state, "daily_video_limit")}>
            <Input name="daily_video_limit" inputMode="numeric" defaultValue={settings.daily_video_limit ?? ""} />
          </Field>
        </div>
        <p className="text-sm text-muted-foreground">Who may use Generate 6 Videos is set per person on each person&apos;s page in Users.</p>
      </fieldset>
      <SubmitButton size="lg" className="self-start">Save settings</SubmitButton>
    </form>
  );
}
