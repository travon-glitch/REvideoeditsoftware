"use client";
import { jobErrorForPeople } from "@/lib/video/job-errors";
import { VideoMakerNotice } from "@/components/video/video-maker-notice";
import type { VideoMakerStatus } from "@/lib/video-maker";
import { useMemo, useState } from "react";
import { Check, Download, Film, LoaderCircle, Music, RefreshCw, Sparkles, Star, Type, Upload } from "lucide-react";
import { STILL_NAME, getMove } from "@lvs/camera-presets";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { MiniPreview } from "@/components/video/stage-view";
import { MUSIC_MIME_TYPES } from "@/lib/storage";
import {
  DURATIONS, DURATION_LABELS, ORIENTATION_LABELS, STYLES, STYLE_IDS, buildEasyPlan,
  type EasyBrand, type EasyListing, type EasySettings, type StyleId,
} from "@/lib/video/easy";
import { ASPECTS, CANVAS_1080, resolveScene, totalDuration, type EditPlan } from "@/lib/video/plan";
import { cn } from "@/lib/utils";

export interface WizardDetails {
  address_line: string; city: string; state: string; price: string;
  agent_name: string; brokerage: string; contact_phone: string; contact_email: string;
}
export interface WizardMusic { id: string; url: string | null; file_name: string; duration_seconds: number | null }
export interface WizardRender {
  id: string; aspect: EditPlan["aspect"]; status: "queued" | "running" | "succeeded" | "failed" | "cancelled"; progress: number;
  error_message: string | null; created_at: string; duration_seconds: number | null; width: number | null; height: number | null;
}

/** A big, tappable choice. */
function Choice({ selected, onClick, title, hint, className }: { selected: boolean; onClick: () => void; title: string; hint?: string; className?: string }) {
  return (
    <button type="button" role="radio" aria-checked={selected} onClick={onClick}
      className={cn("flex min-h-16 flex-col items-start justify-center gap-0.5 rounded-xl border-2 px-4 py-3 text-left transition-colors",
        selected ? "border-primary bg-primary/5" : "border-border hover:border-primary/40", className)}>
      <span className="flex w-full items-center justify-between gap-2 text-lg font-semibold">
        {title}{selected ? <Check className="size-5 text-primary" aria-hidden="true" /> : null}
      </span>
      {hint ? <span className="text-sm text-muted-foreground">{hint}</span> : null}
    </button>
  );
}

/* ── Step 2: style cards with a live sample made from the person's own photos ── */

export function StyleStep({
  settings, recommended, listing, photos, thumbUrls, brand, brandColor, onPick,
}: {
  settings: EasySettings; recommended: StyleId; listing: EasyListing; photos: { id: string }[]; thumbUrls: Record<string, string | null>;
  brand: EasyBrand | null; brandColor: string; onPick: (style: StyleId) => void;
}) {
  const samples = useMemo(() => Object.fromEntries(STYLE_IDS.map((id) => {
    const s = STYLES[id];
    try {
      return [id, buildEasyPlan({ listing, photos, brand, settings: { ...settings, style: id, aspect: s.aspect, duration: s.duration } })];
    } catch { return [id, null]; }
  })) as Record<StyleId, EditPlan | null>, [listing, photos, brand, settings]);

  return (
    <div role="radiogroup" aria-label="Video style" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {STYLE_IDS.map((id) => {
        const s = STYLES[id];
        const selected = settings.style === id;
        const sample = samples[id];
        const c = CANVAS_1080[s.aspect];
        return (
          <button key={id} type="button" role="radio" aria-checked={selected} onClick={() => onPick(id)}
            className={cn("flex flex-col overflow-hidden rounded-2xl border-2 bg-card text-left transition-colors",
              selected ? "border-primary ring-2 ring-primary/30" : "border-border hover:border-primary/40")}>
            <div className="flex aspect-[16/10] w-full justify-center bg-neutral-900">
              <div className="h-full" style={{ aspectRatio: `${c.width} / ${c.height}` }}>
                {sample ? <MiniPreview plan={sample} photoUrls={thumbUrls} brandColor={brandColor} /> : null}
              </div>
            </div>
            <div className="flex flex-col gap-1 p-4">
              <span className="flex items-center justify-between gap-2 text-lg font-semibold">
                {s.name}
                {selected ? <span className="flex items-center gap-1 text-sm text-primary"><Check className="size-5" aria-hidden="true" />Chosen</span> : null}
              </span>
              <span className="text-base text-muted-foreground">{s.description}</span>
              <span className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                {ORIENTATION_LABELS[s.aspect].label} · {DURATION_LABELS[s.duration].label.toLowerCase()}
                {id === recommended ? <span className="flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 font-semibold text-brand"><Star className="size-3.5" aria-hidden="true" />Suggested for this home</span> : null}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

/* ── Step 3: customize ─────────────────────────────────────────────────── */

function TextField({ id, label, value, onChange, error, placeholder, inputMode, autoComplete }: {
  id: keyof WizardDetails; label: string; value: string; onChange: (v: string) => void; error?: string; placeholder?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"]; autoComplete?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`easy-${id}`} className="text-base font-semibold">{label}</label>
      <Input id={`easy-${id}`} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} inputMode={inputMode}
        autoComplete={autoComplete} aria-invalid={error ? true : undefined} className="h-12 text-base" />
      {error ? <p className="text-sm font-medium text-destructive">{error}</p> : null}
    </div>
  );
}

export function CustomizeStep({
  details, settings, music, errors, musicBusy, musicMsg, onDetail, onSettings, onUploadMusic,
}: {
  details: WizardDetails; settings: EasySettings; music: WizardMusic[]; errors: Record<string, string>;
  musicBusy: boolean; musicMsg: string | null;
  onDetail: (field: keyof WizardDetails, value: string) => void;
  onSettings: (patch: Partial<EasySettings>) => void;
  onUploadMusic: (file: File | undefined, authorized: boolean) => void;
}) {
  const [authorized, setAuthorized] = useState(false);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="flex flex-col gap-4 rounded-2xl border bg-card p-5" aria-labelledby="sec-home">
        <h3 id="sec-home" className="text-xl font-semibold">The home</h3>
        <TextField id="address_line" label="Address" value={details.address_line} onChange={(v) => onDetail("address_line", v)} error={errors.address_line} placeholder="123 Main Street" autoComplete="street-address" />
        <div className="grid grid-cols-2 gap-3">
          <TextField id="city" label="City" value={details.city} onChange={(v) => onDetail("city", v)} error={errors.city} />
          <TextField id="state" label="State" value={details.state} onChange={(v) => onDetail("state", v)} error={errors.state} />
        </div>
        <TextField id="price" label="Price" value={details.price} onChange={(v) => onDetail("price", v)} error={errors.price} placeholder="$450,000" inputMode="decimal" />
      </section>

      <section className="flex flex-col gap-4 rounded-2xl border bg-card p-5" aria-labelledby="sec-agent">
        <h3 id="sec-agent" className="text-xl font-semibold">Your branding</h3>
        <TextField id="agent_name" label="Agent name" value={details.agent_name} onChange={(v) => onDetail("agent_name", v)} error={errors.agent_name} autoComplete="name" />
        <TextField id="brokerage" label="Company" value={details.brokerage} onChange={(v) => onDetail("brokerage", v)} error={errors.brokerage} autoComplete="organization" />
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField id="contact_phone" label="Phone" value={details.contact_phone} onChange={(v) => onDetail("contact_phone", v)} error={errors.contact_phone} inputMode="tel" autoComplete="tel" />
          <TextField id="contact_email" label="Email" value={details.contact_email} onChange={(v) => onDetail("contact_email", v)} error={errors.contact_email} inputMode="email" autoComplete="email" />
        </div>
        <label className="flex min-h-12 cursor-pointer items-center gap-3 text-base">
          <input type="checkbox" className="size-6 accent-[hsl(var(--primary))]" checked={settings.showBranding} onChange={(e) => onSettings({ showBranding: e.target.checked })} />
          Show my name and contact details at the end
        </label>
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border bg-card p-5" aria-labelledby="sec-length">
        <h3 id="sec-length" className="text-xl font-semibold">How long?</h3>
        <div role="radiogroup" aria-labelledby="sec-length" className="grid gap-3 sm:grid-cols-3">
          {DURATIONS.map((d) => <Choice key={d} selected={settings.duration === d} onClick={() => onSettings({ duration: d })} title={DURATION_LABELS[d].label} hint={DURATION_LABELS[d].hint} />)}
        </div>
        <h3 id="sec-shape" className="mt-3 text-xl font-semibold">Which shape?</h3>
        <div role="radiogroup" aria-labelledby="sec-shape" className="grid gap-3 sm:grid-cols-3">
          {ASPECTS.map((a) => <Choice key={a} selected={settings.aspect === a} onClick={() => onSettings({ aspect: a })} title={ORIENTATION_LABELS[a].label} hint={ORIENTATION_LABELS[a].hint} />)}
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border bg-card p-5" aria-labelledby="sec-music">
        <h3 id="sec-music" className="text-xl font-semibold">Music</h3>
        <div role="radiogroup" aria-labelledby="sec-music" className="flex flex-col gap-2">
          <Choice selected={!settings.musicAssetId} onClick={() => onSettings({ musicAssetId: null })} title="No music" />
          {music.map((m) => (
            <Choice key={m.id} selected={settings.musicAssetId === m.id} onClick={() => onSettings({ musicAssetId: m.id })} title={m.file_name} hint="Fades out at the end" />
          ))}
        </div>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5 size-5" checked={authorized} onChange={(e) => setAuthorized(e.target.checked)} />My company is authorised to use this music in advertising.</label>
        <label className={cn("flex min-h-14 cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 text-base font-semibold hover:border-primary/60", (musicBusy || !authorized) && "pointer-events-none opacity-60")}>
          {musicBusy ? <LoaderCircle className="size-5 animate-spin" aria-hidden="true" /> : <Upload className="size-5" aria-hidden="true" />}
          {musicBusy ? "Adding your music…" : "Add your own music (MP3, M4A or WAV)"}
          <input type="file" accept={MUSIC_MIME_TYPES.join(",")} className="sr-only" disabled={musicBusy || !authorized} onChange={(e) => { onUploadMusic(e.target.files?.[0], authorized); e.target.value = ""; }} />
        </label>
        {musicMsg ? <p role="status" className="text-base">{musicMsg}</p> : null}
        <p className="flex items-start gap-2 text-sm text-muted-foreground"><Music className="mt-0.5 size-4 shrink-0" aria-hidden="true" />Only use music your company may use in advertising.</p>

        <div className="mt-3 flex flex-col gap-2 border-t pt-4">
          <label className="flex min-h-12 items-center gap-3 text-base text-muted-foreground">
            <input type="checkbox" className="size-6" checked={false} disabled aria-describedby="ai-note" />
            <span className="flex items-center gap-2 font-semibold"><Sparkles className="size-5" aria-hidden="true" />AI effects</span>
          </label>
          <p id="ai-note" className="text-sm text-muted-foreground">
            AI effects aren&apos;t switched on for your company yet. Your video uses smooth, real photo motion instead — nothing is made up.
          </p>
        </div>
      </section>
    </div>
  );
}

/* ── Step 4: storyboard and the finished video ─────────────────────────── */

export function Storyboard({ plan, thumbUrls }: { plan: EditPlan; thumbUrls: Record<string, string | null> }) {
  return (
    <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-label="Storyboard">
      {plan.scenes.map((s, i) => {
        const words = plan.texts.filter((t) => resolveScene(plan, t.sceneId)?.id === s.id).map((t) => t.text.split("\n")[0]);
        return (
          <li key={s.id} className="flex flex-col overflow-hidden rounded-xl border bg-card">
            {thumbUrls[s.assetId] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={thumbUrls[s.assetId]!} alt={`Scene ${i + 1}`} className="aspect-video w-full object-cover" loading="lazy" />
            ) : <span className="aspect-video w-full bg-muted" />}
            <div className="flex flex-col gap-0.5 p-3">
              <span className="text-base font-semibold">Scene {i + 1} <span className="font-normal text-muted-foreground">· {s.duration.toFixed(1)} s</span></span>
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground"><Film className="size-4" aria-hidden="true" />{getMove(s.move)?.name ?? STILL_NAME}</span>
              {words.length ? <span className="flex items-start gap-1.5 text-sm"><Type className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="line-clamp-2">{words.join(" · ")}</span></span> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function VideoSummary({ plan, musicName }: { plan: EditPlan; musicName: string | null }) {
  return (
    <p className="text-base text-muted-foreground">
      {plan.scenes.length} scenes · about {Math.round(totalDuration(plan))} seconds · {ORIENTATION_LABELS[plan.aspect].label} · {musicName ? `music: ${musicName}` : "no music"}
    </p>
  );
}

export function RenderPanel({
  projectId, renders, canDownload, onRetry, maker,
}: { projectId: string; renders: WizardRender[]; canDownload: boolean; onRetry: () => void; maker?: VideoMakerStatus }) {
  const latest = renders[0];
  if (!latest) return null;
  const pct = Math.round(latest.progress * 100);
  return (
    <section className="flex flex-col gap-4 rounded-2xl border-2 border-primary/30 bg-card p-5" aria-live="polite" aria-labelledby="your-video">
      <h3 id="your-video" className="text-xl font-semibold">Your video</h3>
      {latest.status === "queued" || latest.status === "running" ? (
        <div className="flex flex-col gap-3">
          <p className="flex items-center gap-2 text-lg font-semibold"><LoaderCircle className="size-6 animate-spin text-primary" aria-hidden="true" />
            {latest.status === "queued" ? "Getting ready…" : `Making your video… ${pct}%`}
          </p>
          <VideoMakerNotice status={maker} waiting={latest.status === "queued"} />
          <div className="h-3 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Progress">
            <div className="h-3 rounded-full bg-primary transition-all" style={{ width: `${Math.max(4, pct)}%` }} />
          </div>
          <p className="text-base text-muted-foreground">This usually takes a minute or two. You can leave this page — it keeps going, and the video will be in My Videos.</p>
        </div>
      ) : null}
      {latest.status === "succeeded" ? (
        <div className="flex flex-col gap-4">
          <p className="flex items-center gap-2 text-lg font-semibold text-success"><Check className="size-6" aria-hidden="true" />Your video is ready!</p>
          {canDownload ? (
            <>
              <video key={latest.id} controls playsInline preload="metadata" className="max-h-[70vh] w-full rounded-xl bg-black"
                src={`/api/projects/${projectId}/renders/${latest.id}/download?play=1`} aria-label="Your finished video" />
              <Button asChild size="xl" className="self-start bg-brand text-white hover:bg-brand/90">
                <a href={`/api/projects/${projectId}/renders/${latest.id}/download`}><Download aria-hidden="true" />Download MP4</a>
              </Button>
            </>
          ) : (
            <p className="text-base text-muted-foreground">Downloads are turned off for your account. Ask an administrator to download it for you.</p>
          )}
          <p className="text-sm text-muted-foreground">{latest.width}×{latest.height} · {Math.round(latest.duration_seconds ?? 0)} seconds · MP4</p>
        </div>
      ) : null}
      {latest.status === "failed" || latest.status === "cancelled" ? (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center gap-3 text-base">
            Sorry — the video didn&apos;t finish. {jobErrorForPeople(latest.error_message)}
            <Button size="sm" variant="outline" onClick={onRetry}><RefreshCw aria-hidden="true" />Try again</Button>
          </AlertDescription>
        </Alert>
      ) : null}
    </section>
  );
}
