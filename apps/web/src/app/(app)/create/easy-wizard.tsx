"use client";
import type { VideoMakerStatus } from "@/lib/video-maker";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, ArrowRight, CircleCheck, ImagePlus, LoaderCircle, Sparkles, Star, Trash2, TriangleAlert, Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { UndoRedo } from "@/components/undo-redo";
import { PreviewPlayer } from "@/components/video/preview-player";
import { useHistory } from "@/lib/use-history";
import { uploadListingPhoto, type UploadedPhoto } from "@/lib/photo-upload";
import { uploadProjectMusic } from "@/lib/music-upload";
import { MAX_PHOTOS, MIN_PHOTOS, moveItem, orderForVideo, planUpload } from "@/lib/listings";
import { PHOTO_MIME_TYPES } from "@/lib/storage";
import {
  STYLES, autoDirector, buildEasyPlan, orderPhotos, type EasyBrand, type EasyListing, type EasySettings, type StyleId,
} from "@/lib/video/easy";
import type { EditPlan } from "@/lib/video/plan";
import type { CameraSpec } from "@lvs/camera-presets";
import { cn } from "@/lib/utils";
import { DirectorButton } from "@/components/director/director-button";
import { deletePhoto, registerPhotos, reorderPhotos, setMainPhoto } from "../listings/actions";
import { createEasyProject, listEasyPhotos, saveEasyDetails, startEasyListing } from "./actions";
import {
  CustomizeStep, RenderPanel, Storyboard, StyleStep, VideoSummary,
  type WizardDetails, type WizardMusic, type WizardRender,
} from "./easy-steps";

export type { WizardDetails, WizardRender };

export interface WizardPhoto { id: string; url: string | null; thumb: string | null; file_name: string; camera?: CameraSpec | null }

export interface WizardProps {
  orgId: string;
  listingId: string | null;
  projectId: string | null;
  revision: number;
  initialStep: number;
  listing: EasyListing;
  details: WizardDetails;
  photos: WizardPhoto[];
  music: WizardMusic[];
  renders: WizardRender[];
  settings: EasySettings;
  recommended: StyleId;
  order: string[];
  /** A plan changed in the Advanced editor — kept until something is changed here. */
  custom: EditPlan | null;
  /** The plan as saved on the server (to know what still needs saving). */
  savedPlan: EditPlan | null;
  brand: EasyBrand | null;
  brandColor: string;
  canDownload: boolean;
  /** Whether the video maker is running (or starts on demand). */
  maker?: VideoMakerStatus;
  /** The company switched on the Claude AI Director. */
  directorAvailable?: boolean;
}

/** Everything Undo / Redo covers. */
interface WizardState { settings: EasySettings; details: WizardDetails; order: string[]; custom: EditPlan | null }

type Notice = { tone: "error" | "info"; text: string; goStep?: number } | null;

const STEPS = [
  { n: 1, title: "Upload photos" },
  { n: 2, title: "Choose a style" },
  { n: 3, title: "Customize" },
  { n: 4, title: "Create video" },
] as const;

const PARALLEL_UPLOADS = 3;

/** JSON with sorted keys, so the same plan always compares equal. */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (v && typeof v === "object" && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, (v as Record<string, unknown>)[k]])) : v));
}

function priceNumber(v: string): number | null {
  const n = Number(v.replace(/[$,\s]/g, ""));
  return v.trim() && Number.isFinite(n) ? n : null;
}

export function EasyWizard(props: WizardProps) {
  const [listingId, setListingId] = useState(props.listingId);
  const [projectId, setProjectId] = useState(props.projectId);
  const [step, setStep] = useState(props.initialStep);
  const [photos, setPhotos] = useState(props.photos);
  const [music, setMusic] = useState(props.music);
  const [renders, setRenders] = useState(props.renders);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState<null | "next" | "auto" | "generate">(null);
  const [reasons, setReasons] = useState<string[] | null>(null);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error" | "conflict">("saved");
  const [detailErrors, setDetailErrors] = useState<Record<string, string>>({});

  const history = useHistory<WizardState>({ settings: props.settings, details: props.details, order: props.order, custom: props.custom });
  const st = history.value;

  /* ── Derived: photos in order, listing facts, and the storyboard plan ── */
  const ordered = useMemo(() => orderPhotos(photos, st.order), [photos, st.order]);
  const orderIds = useMemo(() => ordered.map((p) => p.id), [ordered]);
  const listing = useMemo<EasyListing>(() => ({
    ...props.listing,
    address_line: st.details.address_line.trim(),
    city: st.details.city.trim() || null,
    state: st.details.state.trim() || null,
    price: priceNumber(st.details.price),
    agent_name: st.details.agent_name.trim() || null,
    brokerage: st.details.brokerage.trim() || null,
    contact_phone: st.details.contact_phone.trim() || null,
    contact_email: st.details.contact_email.trim() || null,
  }), [props.listing, st.details]);
  const planFor = useCallback((settings: EasySettings): EditPlan | null => {
    if (ordered.length === 0) return null;
    return buildEasyPlan({ listing, photos: ordered, settings, brand: props.brand, order: orderIds });
  }, [listing, ordered, orderIds, props.brand]);
  const plan = useMemo(() => {
    if (st.custom) {
      const ids = new Set(photos.map((p) => p.id));
      if (st.custom.scenes.every((s) => ids.has(s.assetId))) return st.custom;
    }
    return planFor(st.settings);
  }, [st.custom, st.settings, planFor, photos]);
  const thumbUrls = useMemo(() => Object.fromEntries(photos.map((p) => [p.id, p.thumb ?? p.url])), [photos]);
  const photoUrls = useMemo(() => Object.fromEntries(photos.map((p) => [p.id, p.url])), [photos]);
  const enough = photos.length >= MIN_PHOTOS;

  /* ── Changes (all undoable) ── */
  const setSettings = (patch: Partial<EasySettings>) => history.set((s) => ({ ...s, settings: { ...s.settings, ...patch }, custom: null }));
  const setDetail = (field: keyof WizardDetails, value: string) => {
    setDetailErrors((e) => ({ ...e, [field]: "" }));
    history.set((s) => ({ ...s, details: { ...s.details, [field]: value }, custom: null }), `detail-${field}`);
  };
  const pickStyle = (style: StyleId) => setSettings({ style, aspect: STYLES[style].aspect, duration: STYLES[style].duration });

  /* ── Keep the address bar resumable (/create?project=…&step=…) ── */
  useEffect(() => {
    const q = projectId ? `?project=${projectId}&step=${step}` : listingId ? `?listing=${listingId}` : "";
    if (window.location.search !== q) window.history.replaceState(null, "", `/create${q}`);
  }, [projectId, listingId, step]);

  /* ── Autosave: listing details ── */
  const savedDetails = useRef(JSON.stringify(props.details));
  const flushDetails = useCallback(async (): Promise<boolean> => {
    if (!listingId) return true;
    const json = JSON.stringify(st.details);
    if (json === savedDetails.current) return true;
    const res = await saveEasyDetails(listingId, st.details).catch(() => null);
    if (!res) { setSaveState("error"); return false; }
    if (!res.ok) { setDetailErrors(res.fieldErrors ?? {}); setSaveState("error"); return false; }
    savedDetails.current = json;
    setDetailErrors({});
    return true;
  }, [listingId, st.details]);
  useEffect(() => {
    if (!listingId || JSON.stringify(st.details) === savedDetails.current) return;
    setSaveState("saving");
    const t = setTimeout(() => void flushDetails().then((ok) => ok && setSaveState("saved")), 900);
    return () => clearTimeout(t);
  }, [st.details, listingId, flushDetails]);

  /* ── Autosave: the storyboard plan (one save at a time, so revisions never clash) ── */
  const revision = useRef(props.revision);
  const savedPlan = useRef<string | null>(props.savedPlan ? stableJson(props.savedPlan) : null);
  const chain = useRef<Promise<boolean>>(Promise.resolve(true));
  const putPlan = useCallback((pid: string, p: EditPlan): Promise<boolean> => {
    const run = async () => {
      const json = stableJson(p);
      if (json === savedPlan.current) return true;
      setSaveState("saving");
      const res = await fetch(`/api/projects/${pid}/plan`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ baseRevision: revision.current, plan: p }),
      }).catch(() => null);
      const body = await res?.json().catch(() => ({}));
      if (res?.ok) { revision.current = body.revision; savedPlan.current = json; setSaveState("saved"); return true; }
      if (res?.status === 409) { setSaveState("conflict"); return false; }
      setSaveState("error");
      setNotice({ tone: "error", text: body?.error ?? "We couldn't save your changes. Check your internet connection and try again." });
      return false;
    };
    chain.current = chain.current.then(run, run);
    return chain.current;
  }, []);
  const planJson = plan ? stableJson(plan) : null;
  useEffect(() => {
    if (!projectId || !plan || saveState === "conflict") return;
    if (planJson === savedPlan.current) return;
    const t = setTimeout(() => void putPlan(projectId, plan), 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planJson, projectId]);

  /* ── Autosave: photo order (the first photo is the main photo) ── */
  const syncedOrder = useRef(JSON.stringify(props.photos.map((p) => p.id)));
  useEffect(() => {
    if (!listingId || orderIds.length === 0) return;
    const json = JSON.stringify(orderIds);
    if (json === syncedOrder.current) return;
    const t = setTimeout(async () => {
      const before = JSON.parse(syncedOrder.current) as string[];
      syncedOrder.current = json;
      const r = await reorderPhotos({ listing_id: listingId, asset_ids: orderIds }).catch(() => null);
      if (orderIds[0] && orderIds[0] !== before[0]) await setMainPhoto(listingId, orderIds[0]).catch(() => null);
      if (!r?.ok) setNotice({ tone: "error", text: "We couldn't save the new photo order. Please try again." });
    }, 700);
    return () => clearTimeout(t);
  }, [orderIds, listingId]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (saveState === "saving") e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saveState]);

  /* ── Render progress ── */
  const making = renders.some((r) => r.status === "queued" || r.status === "running");
  useEffect(() => {
    if (!making || !projectId) return;
    const t = setInterval(async () => {
      const res = await fetch(`/api/projects/${projectId}/renders`).catch(() => null);
      if (res?.ok) setRenders((await res.json()).renders);
    }, 3000);
    return () => clearInterval(t);
  }, [making, projectId]);

  /* ── Step 1: photos ── */
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const addressInput = useRef<HTMLInputElement>(null);

  async function addFiles(list: FileList | File[] | null) {
    if (!list || uploading) return;
    const files = Array.from(list);
    const chosen = planUpload(photos.length, files);
    if (chosen.accepted.length === 0) {
      setNotice({ tone: "error", text: chosen.rejected[0] ? `${chosen.rejected[0].file.name}: ${chosen.rejected[0].reason}` : "No photos were chosen." });
      return;
    }
    setNotice(null);
    let lid = listingId;
    if (!lid) {
      const r = await startEasyListing().catch(() => null);
      if (!r?.ok || !r.data) { setNotice({ tone: "error", text: r?.message ?? "We couldn't start. Check your internet connection and try again." }); return; }
      lid = r.data.listingId;
      setListingId(lid);
      await saveEasyDetails(lid, st.details).catch(() => null);
      savedDetails.current = JSON.stringify(st.details);
    }
    setUploading({ done: 0, total: chosen.accepted.length });
    const done: UploadedPhoto[] = [];
    const failed: string[] = [];
    let next = 0;
    const worker = async () => {
      while (next < chosen.accepted.length) {
        const f = chosen.accepted[next++]!;
        try { done.push(await uploadListingPhoto(props.orgId, lid!, f)); } catch { failed.push(f.name); }
        setUploading((u) => (u ? { ...u, done: u.done + 1 } : u));
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL_UPLOADS, chosen.accepted.length) }, worker));
    let problem = "";
    if (done.length) {
      const r = await registerPhotos({ listing_id: lid, files: done }).catch(() => null);
      if (!r?.ok) problem = r?.message ?? "We couldn't save the photos. Please try again.";
      const fresh = await listEasyPhotos(lid).catch(() => null);
      if (fresh?.ok && fresh.data) {
        const list = orderForVideo(fresh.data.photos, fresh.data.coverId);
        setPhotos(list);
        syncedOrder.current = JSON.stringify(orderPhotos(list, st.order).map((p) => p.id));
      }
    }
    if (failed.length) problem = `${problem} ${failed.length} photo${failed.length === 1 ? "" : "s"} didn't upload (${failed.slice(0, 3).join(", ")}). Please try those again.`.trim();
    if (chosen.rejected.length) problem = `${problem} ${chosen.rejected.length} file${chosen.rejected.length === 1 ? " was" : "s were"} skipped — ${chosen.rejected[0]!.reason}`.trim();
    setNotice(problem ? { tone: "error", text: problem } : null);
    setUploading(null);
    if (fileInput.current) fileInput.current.value = "";
  }

  async function removePhoto(id: string) {
    if (!window.confirm("Remove this photo from the listing?")) return;
    const r = await deletePhoto(id).catch(() => null);
    if (!r?.ok) { setNotice({ tone: "error", text: r?.message ?? "We couldn't remove that photo. Please try again." }); return; }
    setPhotos((ps) => ps.filter((p) => p.id !== id));
  }

  const movePhoto = (from: number, to: number) => {
    if (to < 0 || to >= orderIds.length || from === to) return;
    history.set((s) => ({ ...s, order: moveItem(orderIds, from, to), custom: null }));
  };

  /* ── Moving between steps ── */
  async function ensureProject(settings: EasySettings): Promise<string | null> {
    if (projectId) return projectId;
    if (!listingId) return null;
    if (!(await flushDetails())) { setNotice({ tone: "error", text: "Please check the details you typed.", goStep: 3 }); return null; }
    const r = await createEasyProject({ listingId, settings, order: orderIds }).catch(() => null);
    if (!r?.ok || !r.data) { setNotice({ tone: "error", text: r?.message ?? "We couldn't save the video. Please try again." }); return null; }
    revision.current = r.data.revision;
    savedPlan.current = stableJson(planFor(settings));
    setProjectId(r.data.projectId);
    return r.data.projectId;
  }

  async function goTo(n: number) {
    setNotice(null);
    if (n > 1 && !enough) { setNotice({ tone: "error", text: `Add at least ${MIN_PHOTOS} photos first — you have ${photos.length}.` }); return; }
    if (n > 1 && !projectId) {
      setBusy("next");
      const pid = await ensureProject(st.settings);
      setBusy(null);
      if (!pid) return;
    }
    setStep(n);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function needAddress(): boolean {
    if (st.details.address_line.trim()) return false;
    setNotice({ tone: "error", text: "Please type the property address first, so we can put it in your video.", goStep: step === 1 ? undefined : 3 });
    if (step === 1) addressInput.current?.focus();
    return true;
  }

  async function startRender(pid: string, p: EditPlan): Promise<boolean> {
    if (!(await putPlan(pid, p))) return false;
    const res = await fetch(`/api/projects/${pid}/renders`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ aspects: [p.aspect] }),
    }).catch(() => null);
    const body = await res?.json().catch(() => ({}));
    if (!res?.ok) { setNotice({ tone: "error", text: body?.error ?? "We couldn't start making your video. Please try again." }); return false; }
    setRenders((r) => [...body.renders, ...r]);
    return true;
  }

  /** One click: rule-based storyboard → save → start making the real MP4. */
  async function autoCreate() {
    setNotice(null);
    if (!enough) { setNotice({ tone: "error", text: `Add at least ${MIN_PHOTOS} photos first — you have ${photos.length}.` }); return; }
    if (needAddress()) return;
    setBusy("auto");
    try {
      const choice = autoDirector({ listing, photoCount: ordered.length, musicAssetIds: music.map((m) => m.id) });
      const nextPlan = planFor(choice.settings);
      if (!nextPlan) return;
      history.set((s) => ({ ...s, settings: choice.settings, custom: null }));
      if (!(await flushDetails())) { setNotice({ tone: "error", text: "Please check the details you typed.", goStep: 3 }); return; }
      const pid = await ensureProject(choice.settings);
      if (!pid) return;
      if (!(await startRender(pid, nextPlan))) return;
      setReasons(choice.reasons);
      setStep(4);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } finally {
      setBusy(null);
    }
  }

  async function generate() {
    setNotice(null);
    if (!plan || !projectId) return;
    if (needAddress()) return;
    setBusy("generate");
    try {
      if (!(await flushDetails())) { setNotice({ tone: "error", text: "Please check the details you typed.", goStep: 3 }); return; }
      await startRender(projectId, plan);
    } finally {
      setBusy(null);
    }
  }

  /* ── Music ── */
  const [musicBusy, setMusicBusy] = useState(false);
  const [musicMsg, setMusicMsg] = useState<string | null>(null);
  async function addMusic(file: File | undefined, authorized: boolean) {
    if (!file || !projectId) return;
    setMusicBusy(true); setMusicMsg(null);
    try {
      const added = await uploadProjectMusic(props.orgId, projectId, file, { authorized });
      setMusic((m) => [...m, added]);
      setSettings({ musicAssetId: added.id });
      setMusicMsg(`Added “${file.name}”.`);
    } catch (e) {
      setMusicMsg(e instanceof Error ? e.message : "The music couldn't be added.");
    } finally {
      setMusicBusy(false);
    }
  }

  const musicName = plan?.music.assetId ? music.find((m) => m.id === plan.music.assetId)?.file_name ?? null : null;
  const canReach = (n: number) => n === 1 || (enough && (projectId !== null || n === 2));

  return (
    <div className="flex flex-col gap-6">
      {/* Title row */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight">Create a new video</h1>
          <p className="text-lg text-muted-foreground">Four easy steps. Everything saves automatically.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <SaveStatus state={saveState} />
          <UndoRedo onUndo={history.undo} onRedo={history.redo} canUndo={history.canUndo} canRedo={history.canRedo} />
        </div>
      </div>

      {/* Steps */}
      <nav aria-label="Steps">
        <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {STEPS.map((s) => {
            const current = step === s.n;
            const done = step > s.n;
            return (
              <li key={s.n}>
                <button type="button" onClick={() => void goTo(s.n)} disabled={!canReach(s.n) || busy !== null} aria-current={current ? "step" : undefined}
                  className={cn("flex min-h-14 w-full items-center gap-3 rounded-xl border-2 px-3 text-left text-base font-semibold transition-colors disabled:cursor-not-allowed",
                    current ? "border-primary bg-primary text-primary-foreground" : done ? "border-primary/40 bg-primary/5" : "border-border bg-card text-muted-foreground")}>
                  <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full text-sm",
                    current ? "bg-primary-foreground text-primary" : done ? "bg-primary text-primary-foreground" : "bg-muted")}>
                    {done ? <CircleCheck className="size-5" aria-hidden="true" /> : s.n}
                  </span>
                  {s.title}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      {notice ? (
        <Alert variant={notice.tone === "error" ? "destructive" : "default"} role="alert">
          <AlertDescription className="flex flex-wrap items-center gap-3 text-base">
            <TriangleAlert className="size-5 shrink-0" aria-hidden="true" />{notice.text}
            {notice.goStep && notice.goStep !== step ? <Button size="sm" variant="outline" onClick={() => { setNotice(null); setStep(notice.goStep!); }}>Go to step {notice.goStep}</Button> : null}
          </AlertDescription>
        </Alert>
      ) : null}
      {saveState === "conflict" ? (
        <Alert variant="destructive"><AlertDescription className="flex flex-wrap items-center gap-3 text-base">
          This video was changed in another window. <Button size="sm" variant="outline" onClick={() => window.location.reload()}>Load the latest version</Button>
        </AlertDescription></Alert>
      ) : null}
      {st.custom && (step === 2 || step === 3) ? (
        <Alert><AlertDescription className="text-base">
          This video was fine-tuned in the Advanced editor. Choosing something here rebuilds the storyboard — you can always press Undo.
        </AlertDescription></Alert>
      ) : null}

      {/* ── Step 1 ── */}
      {step === 1 ? (
        <section className="flex flex-col gap-5" aria-labelledby="step1">
          <h2 id="step1" className="sr-only">Step 1: Upload photos</h2>
          <label
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files); }}
            className={cn("flex min-h-64 cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-4 border-dashed p-8 text-center transition-colors",
              dragOver ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary/50", uploading && "pointer-events-none opacity-70")}
          >
            {uploading ? <LoaderCircle className="size-14 animate-spin text-primary" aria-hidden="true" /> : <ImagePlus className="size-14 text-primary" aria-hidden="true" />}
            <span className="text-2xl font-bold">{uploading ? `Uploading ${uploading.done} of ${uploading.total}…` : "Drag your photos here"}</span>
            <span className="text-lg text-muted-foreground">{uploading ? "Please keep this page open." : `or click to choose them · ${MIN_PHOTOS} to ${MAX_PHOTOS} photos · JPG, PNG or WebP (iPhone photos convert automatically)`}</span>
            <input ref={fileInput} type="file" multiple accept={PHOTO_MIME_TYPES.join(",")} className="sr-only" aria-label="Choose photos to upload"
              disabled={!!uploading} onChange={(e) => void addFiles(e.target.files)} />
          </label>

          <div className="flex flex-col gap-2 rounded-2xl border bg-card p-5">
            <label htmlFor="easy-address" className="text-lg font-semibold">Property address</label>
            <Input ref={addressInput} id="easy-address" value={st.details.address_line} onChange={(e) => setDetail("address_line", e.target.value)}
              placeholder="123 Main Street" className="h-12 text-base" autoComplete="street-address" />
            <p className="text-sm text-muted-foreground">We put it on the first scene of your video.</p>
          </div>

          {photos.length > 0 ? (
            <div className="flex flex-col gap-3">
              <p className="text-base font-semibold" role="status">
                {photos.length} of {MAX_PHOTOS} photos
                {enough ? <span className="font-normal text-muted-foreground"> · drag to change the order — the first photo opens your video</span>
                  : <span className="font-normal text-warning"> · add {MIN_PHOTOS - photos.length} more</span>}
              </p>
              <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6" aria-label="Your photos in order">
                {ordered.map((p, i) => (
                  <li key={p.id} draggable
                    onDragStart={() => setDragIndex(i)} onDragOver={(e) => { if (dragIndex !== null) e.preventDefault(); }}
                    onDrop={(e) => { e.preventDefault(); if (dragIndex !== null) movePhoto(dragIndex, i); setDragIndex(null); }}
                    onDragEnd={() => setDragIndex(null)}
                    className={cn("group relative overflow-hidden rounded-xl border bg-card", dragIndex === i && "opacity-40", i === 0 && "ring-2 ring-brand")}>
                    {p.thumb ?? p.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={(p.thumb ?? p.url)!} alt={`Photo ${i + 1}`} className="aspect-[4/3] w-full cursor-grab object-cover" loading="lazy" />
                    ) : <span className="block aspect-[4/3] w-full bg-muted" />}
                    <span className="absolute left-2 top-2 rounded-md bg-black/70 px-2 py-0.5 text-sm font-semibold text-white">
                      {i === 0 ? <span className="flex items-center gap-1"><Star className="size-3.5" aria-hidden="true" />Main</span> : i + 1}
                    </span>
                    <div className="flex items-center justify-between gap-1 p-1.5">
                      <Button type="button" size="icon" variant="ghost" className="h-9 w-9" aria-label={`Move photo ${i + 1} earlier`} disabled={i === 0} onClick={() => movePhoto(i, i - 1)}><ArrowLeft aria-hidden="true" /></Button>
                      <Button type="button" size="icon" variant="ghost" className="h-9 w-9 text-destructive hover:text-destructive" aria-label={`Remove photo ${i + 1}`} onClick={() => void removePhoto(p.id)}><Trash2 aria-hidden="true" /></Button>
                      <Button type="button" size="icon" variant="ghost" className="h-9 w-9" aria-label={`Move photo ${i + 1} later`} disabled={i === ordered.length - 1} onClick={() => movePhoto(i, i + 1)}><ArrowRight aria-hidden="true" /></Button>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}

          {props.directorAvailable ? (
            <div className="flex flex-col gap-4 rounded-2xl bg-sidebar p-6 text-white">
              <div className="flex flex-col gap-1">
                <p className="flex items-center gap-2 text-xl font-bold"><Sparkles className="size-6" aria-hidden="true" />Let the AI Director make it</p>
                <p className="text-base text-white/80">Claude looks at every photo, picks the opening shot, order, timing, camera moves, text and call to action — using only your listing details — and the video starts rendering. You can inspect or edit it afterwards.</p>
              </div>
              <DirectorButton listingId={listingId} beforeStart={async () => {
                setNotice(null);
                if (!enough) { setNotice({ tone: "error", text: `Add at least ${MIN_PHOTOS} photos first — you have ${photos.length}.` }); return false; }
                if (needAddress()) return false;
                if (!(await flushDetails())) { setNotice({ tone: "error", text: "Please check the details you typed.", goStep: 3 }); return false; }
                return listingId;
              }} />
              <button type="button" className="self-start text-sm text-white/70 underline hover:text-white" disabled={!enough || busy !== null || !!uploading} onClick={() => void autoCreate()}>
                {busy === "auto" ? "Creating…" : "Or use the quick rule-based storyboard (no AI)"}
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-start gap-3 rounded-2xl bg-sidebar p-6 text-white sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-col gap-1">
                <p className="flex items-center gap-2 text-xl font-bold"><Sparkles className="size-6" aria-hidden="true" />In a hurry?</p>
                <p className="text-base text-white/80">We&apos;ll pick the style, order, timing, camera motion, text, music and your branding — and start making the video right away.</p>
              </div>
              <Button size="xl" className="shrink-0 bg-brand text-white hover:bg-brand/90" disabled={!enough || busy !== null || !!uploading} onClick={() => void autoCreate()}>
                {busy === "auto" ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Wand2 aria-hidden="true" />}
                {busy === "auto" ? "Creating…" : "Auto Create with AI"}
              </Button>
            </div>
          )}
        </section>
      ) : null}

      {/* ── Step 2 ── */}
      {step === 2 ? (
        <section className="flex flex-col gap-4" aria-labelledby="step2">
          <h2 id="step2" className="text-2xl font-semibold">Pick the look you like</h2>
          <p className="text-base text-muted-foreground">Each sample uses your own photos. You can change your mind any time.</p>
          <StyleStep settings={st.settings} recommended={props.recommended} listing={listing} photos={ordered} thumbUrls={thumbUrls}
            brand={props.brand} brandColor={props.brandColor} onPick={pickStyle} />
        </section>
      ) : null}

      {/* ── Step 3 ── */}
      {step === 3 ? (
        <section className="flex flex-col gap-4" aria-labelledby="step3">
          <h2 id="step3" className="text-2xl font-semibold">Make it yours</h2>
          <p className="text-base text-muted-foreground">We filled in what we know from the listing. Change anything you like.</p>
          <CustomizeStep details={st.details} settings={st.settings} music={music} errors={detailErrors} musicBusy={musicBusy} musicMsg={musicMsg}
            onDetail={setDetail} onSettings={setSettings} onUploadMusic={(f, ok) => void addMusic(f, ok)} />
        </section>
      ) : null}

      {/* ── Step 4 ── */}
      {step === 4 && plan && projectId ? (
        <section className="flex flex-col gap-6" aria-labelledby="step4">
          <div className="flex flex-col gap-1">
            <h2 id="step4" className="text-2xl font-semibold">Your storyboard</h2>
            <VideoSummary plan={plan} musicName={musicName} />
          </div>
          {reasons ? (
            <Alert>
              <AlertDescription className="flex flex-col gap-2 text-base">
                <span className="flex items-center gap-2 font-semibold"><Sparkles className="size-5" aria-hidden="true" />How we built your video</span>
                <ul className="ml-6 list-disc">{reasons.map((r) => <li key={r}>{r}</li>)}</ul>
                <span className="text-sm text-muted-foreground">Made by our smart storyboard builder, which follows set rules based on your listing. The AI Director isn&apos;t connected yet.</span>
              </AlertDescription>
            </Alert>
          ) : null}
          <RenderPanel projectId={projectId} renders={renders} canDownload={props.canDownload} onRetry={() => void generate()} maker={props.maker} />
          <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <div className="rounded-2xl border bg-card p-4">
              <PreviewPlayer plan={plan} photoUrls={photoUrls} musicUrl={music.find((m) => m.id === plan.music.assetId)?.url ?? null} brandColor={props.brandColor} />
            </div>
            <div className="flex flex-col gap-4 rounded-2xl border bg-card p-5">
              <p className="text-lg">Happy with the preview? Press the button and we&apos;ll make a full-quality 1080p MP4.</p>
              <Button size="xl" className="h-16 w-full bg-brand text-xl text-white hover:bg-brand/90" disabled={busy !== null || making} onClick={() => void generate()}>
                {busy === "generate" || making ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Wand2 aria-hidden="true" />}
                {making ? "Making your video…" : renders.some((r) => r.status === "succeeded") ? "Generate Again" : "Generate My Video"}
              </Button>
              <div className="flex flex-wrap gap-2 border-t pt-4 text-sm">
                <Button variant="outline" onClick={() => setStep(2)}>Change style</Button>
                <Button variant="outline" onClick={() => setStep(3)}>Change details</Button>
                <Button variant="ghost" asChild><Link href={`/videos/${projectId}/edit`}>Fine-tune in Advanced editor</Link></Button>
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <h3 className="text-xl font-semibold">Scene by scene</h3>
            <Storyboard plan={plan} thumbUrls={thumbUrls} />
          </div>
        </section>
      ) : null}

      {/* Bottom bar */}
      <div className="sticky bottom-0 z-20 -mx-4 border-t bg-background/95 backdrop-blur sm:-mx-6">
        <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Button size="lg" variant="outline" disabled={step === 1 || busy !== null} onClick={() => void goTo(step - 1)}>
            <ArrowLeft aria-hidden="true" />Back
          </Button>
          <span className="hidden text-base text-muted-foreground sm:inline">Step {step} of 4 · {STEPS[step - 1]!.title}</span>
          {step < 4 ? (
            <Button size="xl" disabled={busy !== null || !!uploading || (step === 1 && !enough)} onClick={() => void goTo(step + 1)}>
              {busy === "next" ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}
              Next: {STEPS[step]!.title}<ArrowRight aria-hidden="true" />
            </Button>
          ) : (
            <Button size="xl" asChild variant="outline"><Link href={`/videos/${projectId}`}>Done</Link></Button>
          )}
        </div>
      </div>
    </div>
  );
}

function SaveStatus({ state }: { state: "saved" | "saving" | "error" | "conflict" }) {
  return (
    <p role="status" aria-live="polite" className="flex items-center gap-2 text-sm">
      {state === "saving" ? <><LoaderCircle className="size-4 animate-spin" aria-hidden="true" />Saving…</> : null}
      {state === "saved" ? <><CircleCheck className="size-4 text-success" aria-hidden="true" /><span className="text-success">All changes saved</span></> : null}
      {state === "error" || state === "conflict" ? <><TriangleAlert className="size-4 text-destructive" aria-hidden="true" /><span className="text-destructive">Not saved</span></> : null}
    </p>
  );
}
