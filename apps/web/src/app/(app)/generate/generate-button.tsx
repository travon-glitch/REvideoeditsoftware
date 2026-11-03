"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Layers, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { Aspect } from "@/lib/video/plan";

export interface ExpectedUsage {
  videos: number;
  dailyLeft: number | null;
  monthlyLeft: number | null;
  renderMinutes: number;
  concurrent: number | null;
}

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export function GenerateButton({ listingId, disabled, reason, shapes, usage, ai }: {
  listingId: string;
  disabled: boolean;
  reason: string | null;
  shapes: { aspect: Aspect; label: string; size: string }[];
  usage: ExpectedUsage;
  /** Only present when the AI Director is available to this person. */
  ai: { cents: number; photos: number; budgetLeftCents: number | null } | null;
}) {
  const router = useRouter();
  const [aspect, setAspect] = useState<Aspect>("9:16");
  const [planner, setPlanner] = useState<"rules" | "ai_director">("rules");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const overLimit = (usage.dailyLeft != null && usage.dailyLeft < usage.videos) || (usage.monthlyLeft != null && usage.monthlyLeft < usage.videos);
  const overBudget = planner === "ai_director" && ai?.budgetLeftCents != null && ai.budgetLeftCents < ai.cents;
  const needsConfirm = planner === "ai_director" && !confirmed;

  async function go() {
    setBusy(true); setError(null);
    const payload = { listingId, aspect, planner, ...(planner === "ai_director" && ai ? { confirmedCents: ai.cents } : {}) };
    const res = await fetch("/api/batches", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }).catch(() => null);
    const body = await res?.json().catch(() => ({}));
    if (!res?.ok || !body?.batchId) { setBusy(false); setError(body?.error ?? "We couldn't start. Check your connection and try again."); return; }
    router.push(`/batches/${body.batchId}`);
  }

  return (
    <div className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-semibold">Shape</legend>
        <div className="grid grid-cols-3 gap-2">
          {shapes.map((s) => (
            <label key={s.aspect} className={`flex cursor-pointer flex-col rounded-lg border p-3 text-center ${aspect === s.aspect ? "border-brand bg-brand/10" : "hover:bg-accent"}`}>
              <input type="radio" name="shape" value={s.aspect} checked={aspect === s.aspect} onChange={() => setAspect(s.aspect)} className="sr-only" />
              <span className="font-semibold">{s.label}{s.aspect === "9:16" ? " (default)" : ""}</span>
              <span className="text-xs text-muted-foreground">{s.size}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-semibold">Storyboards</legend>
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3">
          <input type="radio" name="planner" checked={planner === "rules"} onChange={() => { setPlanner("rules"); setConfirmed(false); }} className="mt-1 size-4" />
          <span><span className="font-semibold">Standard</span> — built automatically from your photos and listing facts. No AI cost.</span>
        </label>
        {ai ? (
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3">
            <input type="radio" name="planner" checked={planner === "ai_director"} onChange={() => setPlanner("ai_director")} className="mt-1 size-4" />
            <span><span className="font-semibold">AI Director</span> — Claude looks at {ai.photos} photos once and writes six storyboards. Expected cost about <strong>{money(ai.cents)}</strong>.</span>
          </label>
        ) : null}
      </fieldset>

      <div className="rounded-lg border bg-muted/40 p-4" aria-label="Expected usage">
        <h3 className="mb-2 font-semibold">Expected usage</h3>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Videos</dt><dd className="font-medium">{usage.videos} MP4 renders</dd>
          <dt className="text-muted-foreground">Left today</dt><dd className="font-medium">{usage.dailyLeft == null ? "No daily limit" : `${usage.dailyLeft} videos`}</dd>
          <dt className="text-muted-foreground">Left this month</dt><dd className="font-medium">{usage.monthlyLeft == null ? "No monthly limit" : `${usage.monthlyLeft} videos`}</dd>
          <dt className="text-muted-foreground">Render time</dt><dd className="font-medium">{usage.renderMinutes ? `about ${usage.renderMinutes} min` : "—"}{usage.concurrent ? ` (${usage.concurrent} at a time)` : ""}</dd>
          <dt className="text-muted-foreground">AI cost</dt><dd className="font-medium">{planner === "ai_director" && ai ? `about ${money(ai.cents)}` : "$0.00"}</dd>
          {planner === "ai_director" && ai?.budgetLeftCents != null ? (<><dt className="text-muted-foreground">AI budget left</dt><dd className="font-medium">{money(ai.budgetLeftCents)}</dd></>) : null}
        </dl>
        {planner === "ai_director" && ai ? (
          <label className="mt-3 flex items-start gap-2 text-sm">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5 size-4" />
            <span>I understand this uses Claude and will cost about {money(ai.cents)}.</span>
          </label>
        ) : null}
      </div>

      <Button size="xl" className="h-16 w-full bg-brand text-xl text-white hover:bg-brand/90" disabled={disabled || busy || overLimit || overBudget || needsConfirm} onClick={() => void go()}>
        {busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Layers aria-hidden="true" />}
        {busy ? "Building six storyboards…" : "Generate 6 Videos"}
      </Button>
      {reason ? <p className="text-sm font-medium text-warning">{reason}</p> : null}
      {overLimit ? <p className="text-sm font-medium text-warning">You don&apos;t have {usage.videos} videos left in your limit.</p> : null}
      {overBudget ? <p className="text-sm font-medium text-warning">The company&apos;s AI budget doesn&apos;t cover this. Use Standard storyboards.</p> : null}
      {error ? <Alert variant="destructive"><AlertDescription className="text-base">{error}</AlertDescription></Alert> : null}
    </div>
  );
}
