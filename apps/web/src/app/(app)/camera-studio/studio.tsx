"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Check, Clapperboard, Download, ImagePlus, Info, LoaderCircle, Save, Sparkles, Wand2,
} from "lucide-react";
import {
  AI_METHOD_LABELS, EASY_CAMERAS, EASY_DURATIONS, INTENSITIES, LENS_FEEL, STANDARD_QUALITY_LABELS, cameraKeyframes, describeSpec,
  easySpec, getStudioMove, hasManual, transformAt, type CameraSpec, type CameraView, type EasyCameraId, type Intensity,
} from "@lvs/camera-presets";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { UndoRedo } from "@/components/undo-redo";
import { useHistory } from "@/lib/use-history";
import { uploadListingPhoto } from "@/lib/photo-upload";
import { PHOTO_MIME_TYPES } from "@/lib/storage";
import { CANVAS_1080, type Aspect } from "@/lib/video/plan";
import { ORIENTATION_LABELS } from "@/lib/video/easy";
import { cn } from "@/lib/utils";
import { registerPhotos } from "../listings/actions";
import { startEasyListing } from "../create/actions";
import { CameraPreview, MiniCameraPreview } from "./camera-preview";
import { AdvancedPanel, QualityBadge } from "./advanced-panel";
import { ClipsPanel, type Activity } from "./clips-panel";
import { MovementPanel } from "./movement-panel";

export interface StudioPhoto { id: string; url: string | null; thumb: string | null; file_name: string; width: number | null; height: number | null; camera: CameraSpec | null }
export interface StudioProps {
  orgId: string;
  listings: { id: string; label: string }[];
  listingId: string | null;
  canEdit: boolean;
  photos: StudioPhoto[];
  initialPhotoId: string | null;
  initialMode: "easy" | "move" | "advanced";
  scene: { projectId: string; sceneId: string; label: string; photoId: string; camera: CameraSpec | null; aspect: Aspect; duration: number } | null;
  canUseAi: boolean;
  generative: { id: string; model: string } | null;
  canDownload: boolean;
  activity: Activity;
}

interface Shot { spec: CameraSpec; duration: number; aspect: Aspect }
type Notice = { tone: "ok" | "error"; text: string; href?: string; hrefLabel?: string } | null;

export function CameraStudio(p: StudioProps) {
  const router = useRouter();
  const [photoId, setPhotoId] = useState<string | null>(p.initialPhotoId);
  const photo = p.photos.find((x) => x.id === photoId) ?? null;
  const [mode, setMode] = useState(p.initialMode);
  const [easyId, setEasyId] = useState<EasyCameraId>("closer");
  const [intensity, setIntensity] = useState<Intensity>("normal");
  const history = useHistory<Shot>({
    // new moves start with the whole photo in view (Show Entire Photo)
    spec: p.scene?.camera ?? photo?.camera ?? { ...easySpec("closer", "normal"), fit: "contain" },
    duration: p.scene?.duration ? Math.min(10, Math.max(2, p.scene.duration)) : 5,
    aspect: p.scene?.aspect ?? "16:9",
  });
  const shot = history.value;
  const move = getStudioMove(shot.spec.move)!;
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState<null | string>(null);
  const [activity, setActivity] = useState(p.activity);
  const time = useRef(0);
  const onTime = useCallback((t: number) => { time.current = t; }, []);

  const setSpec = useCallback((fn: (s: CameraSpec) => CameraSpec, key?: string) => history.set((h) => ({ ...h, spec: fn(h.spec) }), key), [history]);
  // a new move keeps the chosen framing (fit, background, Smart Fit area)
  const keepFraming = (from: CameraSpec, to: CameraSpec): CameraSpec => ({ ...to, fit: from.fit ?? "cover", background: from.background ?? null, safeArea: from.safeArea ?? null });
  const pickEasy = (id: EasyCameraId, level = intensity) => { setEasyId(id); setIntensity(level); history.set((h) => ({ ...h, spec: keepFraming(h.spec, easySpec(id, level)) })); };
  const choosePhoto = (id: string) => {
    setPhotoId(id);
    const saved = p.photos.find((x) => x.id === id)?.camera;
    // Smart Fit's safe area belongs to one photo: find it again for the next
    history.set((h) => ({ ...h, spec: saved ?? { ...h.spec, safeArea: null } }));
  };
  const [replay, setReplay] = useState(0);

  /* What the preview shows right now, as a view (for keyframes / frames). */
  const lensZoom = shot.spec.lens ? LENS_FEEL[shot.spec.lens].zoom : 1;
  const currentView = useCallback((): CameraView & { t: number } => {
    const c = CANVAS_1080[shot.aspect];
    const r = cameraKeyframes(shot.spec, shot.duration, c, photo?.width && photo.height ? { width: photo.width, height: photo.height } : null);
    const tr = transformAt(r.keyframes, time.current);
    const kz = tr.scale / r.framing.zoom; // the view's own zoom × the edge guard / fit limit
    return {
      t: time.current, x: -tr.x / (kz * c.width) - (r.framing.zoom * r.framing.cx) / c.width, y: -tr.y / (kz * c.height) - (r.framing.zoom * r.framing.cy) / c.height,
      zoom: Math.max(1, kz / (r.edgeGuard * r.fitScale * lensZoom)), rotation: tr.rotation,
    };
  }, [shot, photo, lensZoom]);

  /* ── Activity (exports, AI jobs, AI clips) ── */
  const refresh = useCallback(async () => {
    if (!p.listingId) return;
    const res = await fetch(`/api/camera/listings/${p.listingId}`).catch(() => null);
    if (!res?.ok || !res.headers.get("content-type")?.includes("json")) return;
    const data = await res.json().catch(() => null);
    if (data) setActivity(data);
  }, [p.listingId]);
  const working = activity.renders.some((r) => r.status === "queued" || r.status === "running") || activity.jobs.some((j) => j.status === "queued" || j.status === "running");
  useEffect(() => {
    if (!working) return;
    const t = setInterval(() => void refresh(), 3000);
    return () => clearInterval(t);
  }, [working, refresh]);

  /* ── Actions ── */
  async function call(path: string, method: string, body: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
    const res = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const data = (await res?.json().catch(() => ({}))) ?? {};
    return { ok: !!res?.ok, data };
  }
  async function run(name: string, fn: () => Promise<void>) {
    setBusy(name); setNotice(null);
    try { await fn(); } finally { setBusy(null); }
  }
  const apply = () => run("apply", async () => {
    if (!photo) return;
    if (p.scene) {
      const r = await call("/api/camera/apply", "POST", { projectId: p.scene.projectId, sceneId: p.scene.sceneId, camera: shot.spec, clipAssetId: null });
      setNotice(r.ok ? { tone: "ok", text: `Applied to ${p.scene.label}.`, href: `/videos/${p.scene.projectId}/edit`, hrefLabel: "Back to the editor" } : { tone: "error", text: String(r.data.error ?? "That didn't save.") });
      return;
    }
    const r = await call(`/api/camera/photos/${photo.id}`, "PUT", { camera: shot.spec });
    setNotice(r.ok ? { tone: "ok", text: `Saved on this photo: ${describeSpec(shot.spec, shot.duration)}. New and Easy Mode videos of this listing will use it.` } : { tone: "error", text: String(r.data.error ?? "That didn't save.") });
    if (r.ok) router.refresh();
  });
  const clearSaved = () => run("clear", async () => {
    if (!photo) return;
    const r = await call(`/api/camera/photos/${photo.id}`, "PUT", { camera: null });
    setNotice(r.ok ? { tone: "ok", text: "This photo uses the video style's camera move again." } : { tone: "error", text: String(r.data.error ?? "That didn't save.") });
    if (r.ok) router.refresh();
  });
  const exportClip = () => run("export", async () => {
    if (!photo) return;
    const r = await call("/api/camera/export", "POST", { assetId: photo.id, camera: shot.spec, duration: shot.duration, aspect: shot.aspect });
    setNotice(r.ok ? { tone: "ok", text: "Making your 1080p MP4 clip. It appears below in a minute." } : { tone: "error", text: String(r.data.error ?? "The export couldn't start.") });
    await refresh();
  });
  const makeAi = (method: "depth" | "generative") => run(method, async () => {
    if (!photo) return;
    const r = await call("/api/camera/ai", "POST", { assetId: photo.id, camera: shot.spec, duration: shot.duration, aspect: shot.aspect, method });
    setNotice(r.ok ? { tone: "ok", text: method === "depth" ? "Making the AI depth version. It appears below with a side-by-side check against your photo." : "Sent to the generative AI service. This can take a few minutes." }
      : { tone: "error", text: String(r.data.error ?? "The AI clip couldn't start.") });
    await refresh();
  });
  const useClip = async (clipId: string) => {
    if (!p.scene) return;
    const r = await call("/api/camera/apply", "POST", { projectId: p.scene.projectId, sceneId: p.scene.sceneId, camera: shot.spec, clipAssetId: clipId });
    setNotice(r.ok ? { tone: "ok", text: `The AI clip now plays in ${p.scene.label}.`, href: `/videos/${p.scene.projectId}/edit`, hrefLabel: "Back to the editor" } : { tone: "error", text: String(r.data.error ?? "That didn't save.") });
  };

  /* ── Upload ── */
  const [uploading, setUploading] = useState(false);
  async function upload(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setUploading(true); setNotice(null);
    try {
      let lid = p.listingId;
      if (!lid) {
        const r = await startEasyListing();
        if (!r.ok || !r.data) throw new Error(r.message ?? "We couldn't start a listing.");
        lid = r.data.listingId;
      }
      const up = await uploadListingPhoto(p.orgId, lid, file);
      const reg = await registerPhotos({ listing_id: lid, files: [up] });
      if (!reg.ok) throw new Error(reg.message);
      router.push(`/camera-studio?listing=${lid}&photo=latest`);
      router.refresh();
    } catch (e) {
      setNotice({ tone: "error", text: e instanceof Error ? e.message : "The photo couldn't be uploaded." });
    } finally {
      setUploading(false);
    }
  }

  const photoUrls = useMemo(() => Object.fromEntries(p.photos.map((x) => [x.id, x.url])), [p.photos]);
  const previewPhoto = photo ? { url: photo.url, width: photo.width, height: photo.height } : null;
  const thumbPhoto = photo ? { url: photo.thumb ?? photo.url, width: photo.width, height: photo.height } : null;
  const standInNote = hasManual(shot.spec)
    ? (shot.spec.manual?.pan || shot.spec.manual?.tilt ? "Preview: pan and tilt shown as a slide (flat photo). The AI depth version turns the camera for real." : null)
    : move.requiresAI || move.standard === "stand-in"
    ? `Preview: 2D stand-in. A real ${move.name.toLowerCase()} needs ${move.ai.map((a) => AI_METHOD_LABELS[a]).join(" or ")}.` : null;
  const manual = hasManual(shot.spec);
  const canDepth = manual || move.ai.includes("depth");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          {p.scene ? <Link href={`/videos/${p.scene.projectId}/edit`} className="flex items-center gap-1 text-sm font-semibold text-primary"><ArrowLeft className="size-4" aria-hidden="true" />Back to the editor</Link> : null}
          <h1 className="text-3xl font-bold tracking-tight">Camera Studio</h1>
          <p className="text-lg text-muted-foreground">{p.scene ? `Camera for ${p.scene.label}` : "Turn a property photo into a cinematic clip."}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div role="radiogroup" aria-label="Camera mode" className="flex rounded-lg border p-1">
            {(["easy", "move", "advanced"] as const).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)}
                className={cn("min-h-10 rounded-md px-4 text-sm font-semibold", mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>
                {m === "easy" ? "Easy camera" : m === "move" ? "Move camera" : "Advanced camera"}
              </button>
            ))}
          </div>
          <UndoRedo onUndo={history.undo} onRedo={history.redo} canUndo={history.canUndo} canRedo={history.canRedo} />
        </div>
      </div>

      {/* Photo source */}
      <Card>
        <CardContent className="flex flex-col gap-3 pt-6">
          <div className="flex flex-wrap items-end gap-3">
            {!p.scene ? (
              <div className="flex min-w-60 flex-1 flex-col gap-1">
                <label htmlFor="studio-listing" className="text-sm font-semibold">Listing</label>
                <select id="studio-listing" value={p.listingId ?? ""} onChange={(e) => router.push(e.target.value ? `/camera-studio?listing=${e.target.value}` : "/camera-studio")}
                  className="h-11 rounded-md border bg-background px-3 text-base">
                  <option value="">Choose a listing…</option>
                  {p.listings.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
                </select>
              </div>
            ) : null}
            {!p.scene && (p.canEdit || !p.listingId) ? (
              <label className={cn("flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border-2 border-dashed px-4 text-base font-semibold hover:border-primary/60", uploading && "pointer-events-none opacity-60")}>
                {uploading ? <LoaderCircle className="size-5 animate-spin" aria-hidden="true" /> : <ImagePlus className="size-5" aria-hidden="true" />}
                {uploading ? "Uploading…" : "Upload a photo"}
                <input type="file" accept={PHOTO_MIME_TYPES.join(",")} className="sr-only" aria-label="Upload a property photo" onChange={(e) => void upload(e.target.files)} />
              </label>
            ) : null}
          </div>
          {p.photos.length ? (
            <div role="radiogroup" aria-label="Photo" className="flex gap-2 overflow-x-auto pb-1">
              {p.photos.map((x, i) => (
                <button key={x.id} type="button" role="radio" aria-checked={x.id === photoId} aria-label={`Photo ${i + 1}`}
                  disabled={!!p.scene && x.id !== p.scene.photoId} onClick={() => choosePhoto(x.id)}
                  className={cn("relative h-16 w-24 shrink-0 overflow-hidden rounded-md border-2 disabled:opacity-30", x.id === photoId ? "border-primary" : "border-transparent")}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {x.thumb ?? x.url ? <img src={(x.thumb ?? x.url)!} alt="" className="size-full object-cover" /> : null}
                  {x.camera ? <span className="absolute bottom-0.5 right-0.5 rounded bg-black/70 px-1 text-[10px] font-semibold text-white">Camera</span> : null}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-base text-muted-foreground">{p.listingId ? "This listing has no photos yet. Upload one to start." : "Choose a listing, or upload a photo to start."}</p>
          )}
        </CardContent>
      </Card>

      {notice ? (
        <Alert variant={notice.tone === "error" ? "destructive" : "success"} role="status">
          <AlertDescription className="flex flex-wrap items-center gap-3 text-base">
            {notice.text}
            {notice.href ? <Button size="sm" variant="outline" asChild><Link href={notice.href}>{notice.hrefLabel}</Link></Button> : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {photo ? (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="flex flex-col gap-4">
            <Card>
              <CardContent className="flex flex-col gap-4 pt-6">
                <CameraPreview photo={previewPhoto} spec={shot.spec} duration={shot.duration} aspect={shot.aspect} note={standInNote} onTime={onTime} replay={replay} />
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-semibold">{describeSpec(shot.spec, shot.duration)}</span>
                  <QualityBadge move={move} />
                </div>
                <div className="rounded-lg bg-muted p-3 text-sm">
                  <p className="flex items-start gap-2"><Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                    <span>
                      <strong>{STANDARD_QUALITY_LABELS[move.standard]}.</strong>{" "}
                      {move.standard === "stand-in"
                        ? "Standard moves and zooms the flat photo; it can't show new angles or real depth."
                        : "Made from exact keyframes on your photo — what you see is what you get."}
                      {move.ai.length ? ` AI version: ${move.ai.map((a) => AI_METHOD_LABELS[a]).join(" or ")}${move.ai.includes("generative") ? " (generative AI may change details — always compare with the photo)" : ""}.` : ""}
                    </span>
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Make it</CardTitle></CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div role="radiogroup" aria-label="Clip shape" className="grid grid-cols-3 gap-2">
                  {(["16:9", "9:16", "1:1"] as const).map((a) => (
                    <button key={a} type="button" role="radio" aria-checked={shot.aspect === a} onClick={() => history.set((h) => ({ ...h, aspect: a }))}
                      className={cn("min-h-11 rounded-lg border-2 text-sm font-semibold", shot.aspect === a ? "border-primary bg-primary/5" : "border-border")}>
                      {ORIENTATION_LABELS[a].label}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button size="xl" className="bg-brand text-white hover:bg-brand/90" disabled={!!busy || !p.canEdit} onClick={() => void apply()}>
                    {busy === "apply" ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Check aria-hidden="true" />}
                    {p.scene ? `Apply to ${p.scene.label}` : "Apply to this photo"}
                  </Button>
                  <Button size="xl" variant="outline" disabled={!!busy || !p.canEdit} onClick={() => void exportClip()}>
                    {busy === "export" ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Download aria-hidden="true" />}
                    Export MP4 clip
                  </Button>
                  {!p.scene && photo.camera ? <Button variant="ghost" disabled={!!busy} onClick={() => void clearSaved()}><Save aria-hidden="true" />Remove saved move</Button> : null}
                </div>
                <div className="flex flex-col gap-2 border-t pt-4">
                  <p className="flex items-center gap-2 text-base font-semibold"><Sparkles className="size-5 text-brand" aria-hidden="true" />AI Enhanced</p>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" disabled={!!busy || !p.canEdit || !p.canUseAi || !canDepth} onClick={() => void makeAi("depth")}
                      title={!canDepth ? "This move doesn't need AI depth." : undefined}>
                      {busy === "depth" ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Clapperboard aria-hidden="true" />}
                      Make AI depth version
                    </Button>
                    <Button variant="outline" disabled={!!busy || !p.canEdit || !p.canUseAi || !p.generative} onClick={() => void makeAi("generative")}>
                      {busy === "generative" ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Wand2 aria-hidden="true" />}
                      Make generative AI version
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    AI depth runs on our own server with an open depth model: it moves a virtual camera through your photo&apos;s estimated depth. It can&apos;t see behind objects, so edges may stretch — those are flagged.{" "}
                    {p.generative ? `Generative AI uses ${p.generative.id} (${p.generative.model}); the photo is sent to that service.` : "No generative AI video service is connected yet."}
                    {!p.canUseAi ? " AI isn't switched on for your account." : ""}
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="self-start">
            <CardContent className="pt-6">
              {mode === "easy" ? (
                <div className="flex flex-col gap-5">
                  <div role="radiogroup" aria-label="Camera movement" className="grid grid-cols-2 gap-3">
                    {EASY_CAMERAS.map((c) => (
                      <button key={c.id} type="button" role="radio" aria-checked={easyId === c.id && shot.spec.move === c.move} onClick={() => pickEasy(c.id)}
                        className={cn("flex flex-col overflow-hidden rounded-xl border-2 text-left", easyId === c.id && shot.spec.move === c.move ? "border-primary ring-2 ring-primary/20" : "border-border hover:border-primary/40")}>
                        <MiniCameraPreview photo={thumbPhoto} spec={easySpec(c.id, intensity)} />
                        <span className="flex flex-col gap-0.5 p-2.5">
                          <span className="text-base font-semibold">{c.name}</span>
                          <span className="text-xs text-muted-foreground">{c.description}</span>
                          {c.aiNote ? <span className="text-[11px] text-warning">{c.aiNote}</span> : null}
                        </span>
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-col gap-2">
                    <span id="intensity" className="text-base font-semibold">Intensity</span>
                    <div role="radiogroup" aria-labelledby="intensity" className="grid grid-cols-3 gap-2">
                      {INTENSITIES.map((i) => (
                        <button key={i} type="button" role="radio" aria-checked={intensity === i} onClick={() => pickEasy(easyId, i)}
                          className={cn("min-h-12 rounded-lg border-2 text-base font-semibold capitalize", intensity === i ? "border-primary bg-primary/5" : "border-border")}>{i}</button>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <span id="duration" className="text-base font-semibold">Duration</span>
                    <div role="radiogroup" aria-labelledby="duration" className="grid grid-cols-3 gap-2">
                      {EASY_DURATIONS.map((d) => (
                        <button key={d} type="button" role="radio" aria-checked={shot.duration === d} onClick={() => history.set((h) => ({ ...h, duration: d }))}
                          className={cn("min-h-12 rounded-lg border-2 text-base font-semibold", shot.duration === d ? "border-primary bg-primary/5" : "border-border")}>{d} seconds</button>
                      ))}
                    </div>
                  </div>
                  <Button size="xl" className="w-full bg-brand text-white hover:bg-brand/90" disabled={!!busy || !p.canEdit} onClick={() => void apply()}>
                    <Check aria-hidden="true" />Apply
                  </Button>
                </div>
              ) : mode === "move" ? (
                <MovementPanel spec={shot.spec} setSpec={setSpec} photoUrl={photo.url ?? photo.thumb} photoSize={photo.width && photo.height ? { width: photo.width, height: photo.height } : null} aspect={shot.aspect}
                  duration={shot.duration} setDuration={(d) => history.set((h) => ({ ...h, duration: d }), "duration")}
                  busy={busy === "apply"} canApply={p.canEdit && !busy} onApply={() => void apply()} onPreview={() => setReplay((n) => n + 1)}
                  aiExtendAvailable={false}
                  applyLabel={p.scene ? `Apply Camera Movement to ${p.scene.label}` : "Apply Camera Movement"} />
              ) : (
                <AdvancedPanel spec={shot.spec} setSpec={setSpec} duration={shot.duration}
                  setDuration={(d) => history.set((h) => ({ ...h, duration: d }), "duration")} currentView={currentView} photoUrl={photo.thumb ?? photo.url} />
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {p.listingId ? (
        <Card>
          <CardHeader><CardTitle>Your clips</CardTitle></CardHeader>
          <CardContent>
            <ClipsPanel activity={activity} photoUrls={photoUrls} canDownload={p.canDownload}
              sceneContext={p.scene ? { photoId: p.scene.photoId, label: p.scene.label } : null} onUseClip={useClip} onReviewed={() => void refresh()} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
