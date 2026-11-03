"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, Copy, EyeOff, LoaderCircle, Pencil, RotateCcw, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LISTING_STATUSES, LISTING_STATUS_LABELS } from "@/lib/validation";
import { ASPECTS, BRAND_FONTS, INTRO_STYLES, OUTRO_STYLES, PHOTO_FILTERS, TEXT_ANIMS, TRANSITIONS, TRANSITION_LABELS } from "@/lib/video/plan";
import { MUSIC_MOODS, templateSummary, type BrandRules, type TemplateSpec } from "@/lib/video/templates";
import type { TemplateView } from "@/lib/video/template-store";
import { cn } from "@/lib/utils";
import { saveBrandRules } from "../actions";
import { deleteTemplate, duplicateTemplate, setTemplateDefaults, setTemplateStatus, updateTemplate, type TemplateEdit } from "./actions";

const STATUS_STYLE: Record<string, string> = { approved: "bg-success/15 text-success", draft: "bg-warning/15 text-warning", disabled: "bg-muted text-muted-foreground" };
const RULES: { key: keyof BrandRules; label: string; hint: string }[] = [
  { key: "requireLogo", label: "Require the company logo", hint: "Added to every video if missing" },
  { key: "requireDisclosure", label: "Require the brokerage disclosure", hint: "Shown on the last scene of every video" },
  { key: "requireAgentCard", label: "Require the agent card", hint: "Every video ends with the assigned agent" },
  { key: "lockFonts", label: "Lock fonts to the brand kit", hint: "Templates can't use their own fonts" },
  { key: "lockColors", label: "Lock colours to the brand kit", hint: "Templates can't use their own colours" },
];

export function TemplateAdmin({ templates, rules }: { templates: TemplateView[]; rules: BrandRules }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [r, setR] = useState(rules);
  const [editing, setEditing] = useState<string | null>(null);
  const run = (fn: () => Promise<{ ok: boolean; message?: string }>, after?: () => void) => start(async () => {
    const res = await fn();
    setMsg({ ok: res.ok, text: res.message ?? "" });
    if (res.ok) { after?.(); router.refresh(); }
  });

  return (
    <div className="flex flex-col gap-6">
      {msg ? <Alert variant={msg.ok ? "success" : "destructive"} role="status"><AlertDescription className="text-base">{msg.text}</AlertDescription></Alert> : null}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ShieldCheck className="size-5 text-brand" aria-hidden="true" />Branding requirements</CardTitle>
          <CardDescription>Applied to every video when it is saved or rendered — templates, Easy Mode and the editor.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="grid gap-3 md:grid-cols-2">
            {RULES.map((x) => (
              <label key={x.key} className="flex cursor-pointer items-start gap-3 rounded-lg border p-3">
                <input type="checkbox" className="mt-0.5 size-5" checked={r[x.key]} onChange={(e) => setR({ ...r, [x.key]: e.target.checked })} />
                <span><span className="font-semibold">{x.label}</span><br /><span className="text-sm text-muted-foreground">{x.hint}</span></span>
              </label>
            ))}
          </div>
          <Button className="self-start" disabled={pending} onClick={() => run(() => saveBrandRules(r))}>Save requirements</Button>
        </CardContent>
      </Card>

      <ul className="grid gap-4 lg:grid-cols-2">
        {templates.map((t) => (
          <li key={t.id} className="flex flex-col gap-3 rounded-xl border bg-card p-4">
            <div className="flex gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/templates/${t.recipe}.jpg`} alt="" className="h-24 w-36 shrink-0 rounded-lg bg-muted object-cover" />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-lg font-semibold">{t.name}</span>
                  <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold capitalize", STATUS_STYLE[t.status])}>{t.status}</span>
                  {t.builtin ? <span className="rounded-full bg-muted px-2 py-0.5 text-xs">Built-in</span> : null}
                </div>
                <p className="text-sm text-muted-foreground">{t.usage}</p>
                <p className="text-xs text-muted-foreground">{templateSummary(t.spec)}</p>
                {t.defaultFor.length ? <p className="text-xs font-semibold text-brand">Default for: {t.defaultFor.map((s) => LISTING_STATUS_LABELS[s]).join(", ")}</p> : null}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {t.status !== "approved" ? <Button size="sm" disabled={pending} onClick={() => run(() => setTemplateStatus(t.id, "approved"))}><CircleCheck aria-hidden="true" />Approve</Button> : null}
              {t.status !== "disabled" ? <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => setTemplateStatus(t.id, "disabled"))}><EyeOff aria-hidden="true" />Disable</Button>
                : <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => setTemplateStatus(t.id, "draft"))}><RotateCcw aria-hidden="true" />Re-enable as draft</Button>}
              <Button size="sm" variant="outline" onClick={() => setEditing(editing === t.id ? null : t.id)}><Pencil aria-hidden="true" />Edit</Button>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => duplicateTemplate(t.id))}><Copy aria-hidden="true" />Create from this</Button>
              {!t.builtin ? <Button size="sm" variant="ghost" className="text-destructive" disabled={pending} onClick={() => run(() => deleteTemplate(t.id))}><Trash2 aria-hidden="true" />Delete</Button> : null}
            </div>
            {t.status === "approved" ? (
              <fieldset className="flex flex-wrap items-center gap-2 text-sm">
                <legend className="sr-only">Default for</legend>
                <span className="font-medium">Default for:</span>
                {LISTING_STATUSES.map((s) => (
                  <label key={s} className="flex items-center gap-1 rounded-full border px-2 py-1">
                    <input type="checkbox" checked={t.defaultFor.includes(s)} disabled={pending}
                      onChange={(e) => run(() => setTemplateDefaults(t.id, e.target.checked ? [...t.defaultFor, s] : t.defaultFor.filter((x) => x !== s)))} />
                    {LISTING_STATUS_LABELS[s]}
                  </label>
                ))}
              </fieldset>
            ) : null}
            {editing === t.id ? <TemplateEditor t={t} busy={pending} onSave={(edit) => run(() => updateTemplate(t.id, edit), () => setEditing(null))} /> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function TemplateEditor({ t, busy, onSave }: { t: TemplateView; busy: boolean; onSave: (e: TemplateEdit) => void }) {
  const [s, setS] = useState<TemplateSpec>(t.spec);
  const set = <K extends keyof TemplateSpec>(k: K, v: TemplateSpec[K]) => setS({ ...s, [k]: v });
  const look = <K extends keyof TemplateSpec["look"]>(k: K, v: TemplateSpec["look"][K]) => setS({ ...s, look: { ...s.look, [k]: v } });
  const text = (k: "name" | "usage" | "description" | "badge" | "headline" | "callToAction", label: string) => (
    <label className="flex flex-col gap-1 text-sm font-medium">{label}<Input value={s[k]} onChange={(e) => set(k, e.target.value)} /></label>
  );
  const select = <T extends string>(label: string, value: T, options: readonly T[], onChange: (v: T) => void, labels?: Record<string, string>) => (
    <label className="flex flex-col gap-1 text-sm font-medium">{label}
      <NativeSelect value={value} onChange={(e) => onChange(e.target.value as T)}>{options.map((o) => <option key={o} value={o}>{labels?.[o] ?? o}</option>)}</NativeSelect>
    </label>
  );
  return (
    <div className="grid gap-3 rounded-lg border bg-muted/30 p-4 sm:grid-cols-2">
      {text("name", "Name")}{text("usage", "Recommended usage")}
      {text("badge", "Badge (e.g. JUST LISTED)")}{text("headline", "Headline")}
      {text("callToAction", "Call to action")}{text("description", "Description")}
      {select("Shape", s.aspect, ASPECTS, (v) => set("aspect", v), { "16:9": "Wide 16:9", "9:16": "Vertical 9:16", "1:1": "Square 1:1" })}
      <label className="flex flex-col gap-1 text-sm font-medium">Length (seconds)
        <Input type="number" min={10} max={90} value={s.duration} onChange={(e) => set("duration", Number(e.target.value))} />
      </label>
      {select("Transition", s.transition, TRANSITIONS, (v) => set("transition", v), TRANSITION_LABELS)}
      {select("Camera feel", s.intensity, ["gentle", "normal", "dramatic"] as const, (v) => set("intensity", v))}
      {select("Title font", s.look.headingFont, BRAND_FONTS, (v) => look("headingFont", v))}
      {select("Text font", s.look.bodyFont, BRAND_FONTS, (v) => look("bodyFont", v))}
      {select("Title animation", s.look.titleAnim, TEXT_ANIMS, (v) => look("titleAnim", v))}
      {select("Banner animation", s.look.bannerAnim, TEXT_ANIMS, (v) => look("bannerAnim", v))}
      {select("Caption animation", s.look.captionAnim, TEXT_ANIMS, (v) => look("captionAnim", v))}
      {select("Photo look", s.look.filter, PHOTO_FILTERS, (v) => look("filter", v))}
      {select("Intro", s.intro, ["brand", ...INTRO_STYLES] as const, (v) => set("intro", v), { brand: "Brand kit default" })}
      {select("Outro", s.outro, ["brand", ...OUTRO_STYLES] as const, (v) => set("outro", v), { brand: "Brand kit default" })}
      {select("Music mood", s.music, MUSIC_MOODS, (v) => set("music", v))}
      <div className="flex flex-col gap-2 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={s.look.uppercase} onChange={(e) => look("uppercase", e.target.checked)} />Capital letters for titles</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={s.look.letterbox} onChange={(e) => look("letterbox", e.target.checked)} />Cinema bars</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={s.agentCard} onChange={(e) => set("agentCard", e.target.checked)} />End with the agent card</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={s.showLogo} onChange={(e) => set("showLogo", e.target.checked)} />Logo in the corner</label>
      </div>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button disabled={busy} onClick={() => onSave({
          name: s.name, usage: s.usage, description: s.description, badge: s.badge, headline: s.headline, callToAction: s.callToAction, aspect: s.aspect,
          duration: s.duration, transition: s.transition, intensity: s.intensity, intro: s.intro, outro: s.outro, music: s.music, agentCard: s.agentCard, showLogo: s.showLogo, look: s.look,
        })}>{busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}Save template</Button>
        {t.status === "approved" ? <span className="text-sm text-muted-foreground">Saving sends it back for approval.</span> : null}
      </div>
    </div>
  );
}
