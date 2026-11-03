"use client";
import { useActionState, useState, useTransition } from "react";
import { KeyRound, PlugZap, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FormMessage, SubmitButton, errorFor } from "@/components/form";
import { DIRECTOR_MODELS } from "@/lib/director/claude";
import type { OrganizationSettingsRow } from "@/lib/database.types";
import type { ActionResult } from "@/lib/auth/session";
import { removeClaudeKey, saveClaudeKey, saveClaudeSettings, testClaudeConnection } from "../actions";

export function ClaudeSettingsForm({ settings }: { settings: OrganizationSettingsRow }) {
  const [state, action] = useActionState(saveClaudeSettings, null);
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <FormMessage state={state} />
      <label className="flex min-h-14 cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
        <input type="checkbox" name="claude_enabled" defaultChecked={settings.claude_enabled} className="mt-1 size-5 accent-[hsl(var(--primary))]" />
        <span><span className="block font-semibold">AI Director switched on</span><span className="block text-sm text-muted-foreground">Lets people use “Create My Video Automatically”. Listing photos are sent to Claude (Anthropic) for analysis.</span></span>
      </label>
      <div className="grid gap-5 sm:grid-cols-3">
        <Field label="Claude model" htmlFor="claude_model" error={errorFor(state, "claude_model")}>
          <select id="claude_model" name="claude_model" defaultValue={settings.claude_model} className="h-11 w-full min-w-0 rounded-md border bg-background px-3 text-base">
            {DIRECTOR_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label} — ${m.inputPerM}/${m.outputPerM} per M tokens</option>)}
          </select>
        </Field>
        <Field label="Runs per month (company)" htmlFor="claude_monthly_run_limit" optional hint="Leave empty for no limit." error={errorFor(state, "claude_monthly_run_limit")}>
          <Input name="claude_monthly_run_limit" inputMode="numeric" defaultValue={settings.claude_monthly_run_limit ?? ""} />
        </Field>
        <Field label="Runs per person per day" htmlFor="claude_daily_runs_per_user" optional hint="Leave empty for no limit." error={errorFor(state, "claude_daily_runs_per_user")}>
          <Input name="claude_daily_runs_per_user" inputMode="numeric" defaultValue={settings.claude_daily_runs_per_user ?? ""} />
        </Field>
      </div>
      <p className="text-sm text-muted-foreground">Claude costs count toward the AI spending ceiling above. People also need “AI” allowed on their account.</p>
      <SubmitButton size="lg" className="self-start">Save AI Director settings</SubmitButton>
    </form>
  );
}

export function ClaudeKeyForm({ status, envKey, canStore }: { status: { configured: boolean; last4?: string; updated_at?: string } | null; envKey: boolean; canStore: boolean }) {
  const [state, action] = useActionState(saveClaudeKey, null);
  const [msg, setMsg] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-4">
      <p className="flex items-center gap-2 text-base">
        <KeyRound className="size-5 text-muted-foreground" aria-hidden="true" />
        {status?.configured ? <>Key saved, ends in <strong>…{status.last4}</strong>. It can't be shown again — only replaced or removed.</>
          : envKey ? "Using the server's ANTHROPIC_API_KEY." : "No Claude API key yet."}
      </p>
      <form action={action} className="flex flex-col gap-3" noValidate>
        <FormMessage state={state} />
        <Field label={status?.configured ? "Replace the API key" : "Claude API key"} htmlFor="api_key" hint="From the Claude Console. Stored encrypted; never shown in the browser again." error={errorFor(state, "api_key")}>
          <Input name="api_key" type="password" autoComplete="off" placeholder="sk-ant-…" disabled={!canStore} />
        </Field>
        {!canStore ? <p className="text-sm text-warning">The server can't store keys until LVS_SECRETS_KEY is set (or set ANTHROPIC_API_KEY on the server).</p> : null}
        <div className="flex flex-wrap gap-2">
          <SubmitButton disabled={!canStore}>Save key</SubmitButton>
          <Button type="button" variant="outline" disabled={pending || (!status?.configured && !envKey)} onClick={() => start(async () => setMsg(await testClaudeConnection()))}>
            <PlugZap aria-hidden="true" />Test connection
          </Button>
          {status?.configured ? (
            <Button type="button" variant="ghost" className="text-destructive" disabled={pending}
              onClick={() => { if (window.confirm("Remove the Claude API key? The AI Director stops working until a new key is added.")) start(async () => setMsg(await removeClaudeKey())); }}>
              <Trash2 aria-hidden="true" />Remove key
            </Button>
          ) : null}
        </div>
        {msg ? <p role="status" className={msg.ok ? "text-sm text-success" : "text-sm text-destructive"}>{msg.message}</p> : null}
      </form>
    </div>
  );
}
