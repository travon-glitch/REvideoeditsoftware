"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, LoaderCircle, ShieldAlert, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { createClient } from "@/lib/supabase/client";
import { BUCKETS, MUSIC_MIME_TYPES, checkMusicFile } from "@/lib/storage";
import { addMusicTrack, deleteMusicTrack, setMusicVerified } from "../actions";

export interface TrackView {
  assetId: string; title: string; artist: string | null; mood: string; license: string; details: string; url: string | null;
  verified: boolean; verifiedBy: string | null; verifiedAt: string | null; audio: string | null; seconds: number | null;
}
const LICENSES: Record<string, string> = { original_builtin: "Original (built in)", royalty_free: "Royalty-free", licensed: "Licensed", company_owned: "Company-owned" };
const MOODS = ["elegant", "calm", "upbeat", "warm", "inspiring"] as const;

export function MusicLibrary({ orgId, tracks }: { orgId: string; tracks: TrackView[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function upload(form: HTMLFormElement) {
    const fd = new FormData(form);
    const file = fd.get("file") as File | null;
    if (!file || !file.size) { setMsg({ ok: false, text: "Choose an audio file." }); return; }
    const check = checkMusicFile(file);
    if (!check.ok) { setMsg({ ok: false, text: check.reason }); return; }
    setBusy(true); setMsg(null);
    const ext = file.type === "audio/mpeg" ? "mp3" : /wav/.test(file.type) ? "wav" : file.type === "audio/aac" ? "aac" : "m4a";
    const path = `${orgId}/music/${crypto.randomUUID()}.${ext}`;
    const duration = await new Promise<number | null>((ok) => { const a = new Audio(); const u = URL.createObjectURL(file); a.onloadedmetadata = () => { URL.revokeObjectURL(u); ok(Number.isFinite(a.duration) ? a.duration : null); }; a.onerror = () => ok(null); a.src = u; });
    const { error } = await createClient().storage.from(BUCKETS.musicLibrary).upload(path, file, { contentType: file.type });
    if (error) { setBusy(false); setMsg({ ok: false, text: "The file couldn't be uploaded." }); return; }
    const r = await addMusicTrack({
      path, file_name: file.name, mime_type: file.type, size_bytes: file.size, duration_seconds: duration,
      title: fd.get("title"), artist: fd.get("artist") || undefined, mood: fd.get("mood"), license_type: fd.get("license_type"),
      license_details: fd.get("license_details"), license_url: fd.get("license_url") || "", verified: fd.get("verified") === "on",
    });
    setBusy(false);
    setMsg({ ok: r.ok, text: r.message ?? (r.ok ? "Added." : "Couldn't add the track.") });
    if (r.ok) { form.reset(); router.refresh(); } else await createClient().storage.from(BUCKETS.musicLibrary).remove([path]);
  }

  return (
    <div className="flex flex-col gap-6">
      {msg ? <Alert variant={msg.ok ? "success" : "destructive"}><AlertDescription className="text-base">{msg.text}</AlertDescription></Alert> : null}
      <ul className="flex flex-col divide-y rounded-lg border">
        {tracks.map((t) => (
          <li key={t.assetId} className="flex flex-col gap-2 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-base font-semibold">{t.title}</span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold capitalize">{t.mood}</span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold">{LICENSES[t.license] ?? t.license}</span>
              {t.verified
                ? <span className="flex items-center gap-1 text-sm font-semibold text-success"><CircleCheck className="size-4" aria-hidden="true" />Cleared for commercial use{t.verifiedBy ? ` · ${t.verifiedBy}` : ""}</span>
                : <span className="flex items-center gap-1 text-sm font-semibold text-warning"><ShieldAlert className="size-4" aria-hidden="true" />Not offered until verified</span>}
            </div>
            <p className="text-sm text-muted-foreground">{t.details}{t.url ? <> · <a className="underline" href={t.url} target="_blank" rel="noreferrer">licence</a></> : null}</p>
            <div className="flex flex-wrap items-center gap-3">
              {t.audio ? <audio controls preload="none" src={t.audio} className="h-10 max-w-full" aria-label={`Play ${t.title}`} /> : null}
              {t.license !== "original_builtin" ? (
                <>
                  <Button size="sm" variant="outline" disabled={pending} onClick={() => start(async () => { const r = await setMusicVerified(t.assetId, !t.verified); setMsg(r.ok ? null : { ok: false, text: r.message ?? "" }); router.refresh(); })}>
                    {t.verified ? "Withdraw clearance" : "I verified the licence — clear for use"}
                  </Button>
                  <Button size="sm" variant="ghost" className="text-destructive" disabled={pending} onClick={() => { if (window.confirm(`Remove “${t.title}”?`)) start(async () => { await deleteMusicTrack(t.assetId); router.refresh(); }); }}>
                    <Trash2 aria-hidden="true" />Remove
                  </Button>
                </>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      <form className="flex flex-col gap-4 rounded-xl border p-4" onSubmit={(e) => { e.preventDefault(); void upload(e.currentTarget); }}>
        <h3 className="text-lg font-semibold">Add a licensed track</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm font-semibold">Audio file (MP3, M4A, WAV)<input name="file" type="file" accept={MUSIC_MIME_TYPES.join(",")} className="text-sm font-normal" /></label>
          <label className="flex flex-col gap-1 text-sm font-semibold">Title<Input name="title" required maxLength={120} /></label>
          <label className="flex flex-col gap-1 text-sm font-semibold">Artist (optional)<Input name="artist" maxLength={120} /></label>
          <label className="flex flex-col gap-1 text-sm font-semibold">Mood
            <select name="mood" className="h-11 rounded-md border bg-background px-3 text-base font-normal">{MOODS.map((m) => <option key={m} value={m}>{m}</option>)}</select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold">Licence type
            <select name="license_type" className="h-11 rounded-md border bg-background px-3 text-base font-normal">
              <option value="licensed">Licensed (purchased / subscription)</option><option value="royalty_free">Royalty-free</option><option value="company_owned">Company-owned</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold">Licence link (optional)<Input name="license_url" type="url" maxLength={500} placeholder="https://…" /></label>
          <label className="flex flex-col gap-1 text-sm font-semibold sm:col-span-2">Licence details<Input name="license_details" required maxLength={1000} placeholder="Who granted it, licence number, and that it covers advertising use" /></label>
        </div>
        <label className="flex items-start gap-3 text-base">
          <input type="checkbox" name="verified" className="mt-1 size-5" />
          <span>I checked the licence: this track may be used in commercial real estate advertising. (Leave unticked to verify later — it won&apos;t be offered until then.)</span>
        </label>
        <Button type="submit" className="self-start" disabled={busy}>{busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Upload aria-hidden="true" />}Add track</Button>
      </form>
    </div>
  );
}
