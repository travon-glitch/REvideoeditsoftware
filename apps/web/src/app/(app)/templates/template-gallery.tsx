"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, LoaderCircle, Play, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

interface Card { id: string; recipe: string; name: string; usage: string; description: string; aspect: string; duration: number; font: string }
const SHAPE: Record<string, string> = { "16:9": "Wide", "9:16": "Vertical", "1:1": "Square" };

export function TemplateGallery({ templates, listings, listingId, recommendation, agentName, canCreate }: {
  templates: Card[]; listings: { id: string; label: string; photos: number }[]; listingId: string | null;
  recommendation: { templateId: string; reason: string } | null; agentName: string | null; canCreate: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const listing = listings.find((l) => l.id === listingId) ?? null;
  const ordered = recommendation ? [...templates].sort((a, b) => (a.id === recommendation.templateId ? -1 : b.id === recommendation.templateId ? 1 : 0)) : templates;

  async function select(t: Card) {
    if (!listingId) return;
    setBusy(t.id); setError(null);
    const res = await fetch("/api/templates/apply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ listingId, templateId: t.id, render: true }) }).catch(() => null);
    const body = await res?.json().catch(() => ({}));
    if (!res?.ok || !body?.projectId) { setBusy(null); setError(body?.error ?? "We couldn't start. Please try again."); return; }
    const notes = [...(body.warnings ?? []), ...(body.changes ?? []).map((c: string) => ({ message: c }))].map((w: { message: string }) => w.message);
    router.push(`/videos/${body.projectId}?created=1${notes.length ? `&notes=${encodeURIComponent(notes.join("\n").slice(0, 900))}` : ""}`);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
        <label className="flex min-w-64 flex-1 flex-col gap-1 text-sm font-semibold">
          Listing
          <NativeSelect value={listingId ?? ""} onChange={(e) => router.push(e.target.value ? `/templates?listing=${e.target.value}` : "/templates")}>
            <option value="">Choose a listing…</option>
            {listings.map((l) => <option key={l.id} value={l.id}>{l.label} — {l.photos} photos</option>)}
          </NativeSelect>
        </label>
        {listing ? <p className="text-sm text-muted-foreground">Agent on the video: <span className="font-semibold text-foreground">{agentName ?? "none assigned (the company is shown)"}</span></p> : null}
      </div>
      {recommendation && listing ? (
        <Alert className="border-brand/40 bg-brand/5">
          <AlertDescription className="flex items-center gap-2 text-base"><Sparkles className="size-5 text-brand" aria-hidden="true" />
            <span><strong>Recommended for this listing:</strong> {templates.find((t) => t.id === recommendation.templateId)?.name}. {recommendation.reason}</span>
          </AlertDescription>
        </Alert>
      ) : null}
      <p className="text-sm text-muted-foreground">Previews are real renders of each template with a sample listing. Your video uses your listing&apos;s photos, facts, agent and brand kit.</p>
      {error ? <Alert variant="destructive"><AlertDescription className="text-base">{error}</AlertDescription></Alert> : null}
      {templates.length === 0 ? <p className="text-base text-muted-foreground">No approved templates yet. An administrator can approve them.</p> : null}
      <ul className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
        {ordered.map((t) => {
          const recommended = recommendation?.templateId === t.id && !!listing;
          return (
            <li key={t.id} className={cn("flex flex-col overflow-hidden rounded-2xl border bg-card", recommended && "border-brand ring-2 ring-brand/30")}>
              <div className="relative aspect-video bg-neutral-900">
                {preview === t.id ? (
                  <>
                    <video src={`/templates/${t.recipe}.mp4`} autoPlay muted loop playsInline className="absolute inset-0 size-full object-contain" aria-label={`${t.name} preview`} />
                    <button type="button" onClick={() => setPreview(null)} className="absolute right-2 top-2 rounded-full bg-black/70 p-1.5 text-white" aria-label="Close preview"><X className="size-4" /></button>
                  </>
                ) : (
                  <button type="button" onClick={() => setPreview(t.id)} className="group size-full" aria-label={`Preview ${t.name}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/templates/${t.recipe}.jpg`} alt="" className="size-full object-cover" />
                    <span className="absolute inset-0 flex items-center justify-center bg-black/0 transition group-hover:bg-black/30">
                      <span className="flex items-center gap-2 rounded-full bg-black/70 px-4 py-2 text-sm font-semibold text-white"><Play className="size-4" aria-hidden="true" />Preview</span>
                    </span>
                  </button>
                )}
                {recommended ? <span className="absolute left-2 top-2 rounded-full bg-brand px-3 py-1 text-xs font-bold text-white">Recommended</span> : null}
              </div>
              <div className="flex flex-1 flex-col gap-2 p-4">
                <h2 className="text-xl font-semibold">{t.name}</h2>
                <p className="text-base">{t.usage}</p>
                <p className="text-sm text-muted-foreground">{t.description}</p>
                <p className="text-xs font-medium text-muted-foreground">{SHAPE[t.aspect]} · about {t.duration} s · {t.font}</p>
                {canCreate ? (
                  <Button size="lg" className="mt-auto w-full bg-brand text-white hover:bg-brand/90" disabled={!listing || (listing?.photos ?? 0) < 1 || !!busy} onClick={() => void select(t)}>
                    {busy === t.id ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Check aria-hidden="true" />}
                    {busy === t.id ? "Building your video…" : listing ? "Select" : "Choose a listing first"}
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
