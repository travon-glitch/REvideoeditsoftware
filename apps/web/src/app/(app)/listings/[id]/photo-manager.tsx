"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, GripVertical, ImagePlus, LoaderCircle, RefreshCw, Star, Trash2, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PHOTO_MIME_TYPES, checkPhotoFile } from "@/lib/storage";
import { uploadListingPhoto } from "@/lib/photo-upload";
import { MAX_PHOTOS, MIN_PHOTOS, moveItem, planUpload } from "@/lib/listings";
import { cn } from "@/lib/utils";
import { deletePhoto, registerPhotos, reorderPhotos, replacePhoto, setMainPhoto } from "../actions";

export interface ManagedPhoto { id: string; url: string | null; thumb?: string | null; file_name: string }
interface Uploading { key: string; name: string; preview: string; state: "waiting" | "uploading" | "done" | "failed" }

const PARALLEL_UPLOADS = 3;

export function PhotoManager({
  orgId, listingId, photos: initial, coverId: initialCover,
}: { orgId: string; listingId: string; photos: ManagedPhoto[]; coverId: string | null }) {
  const router = useRouter();
  const [photos, setPhotos] = useState(initial);
  const [coverId, setCoverId] = useState(initialCover);
  const [uploads, setUploads] = useState<Uploading[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const replaceTarget = useRef<string | null>(null);

  // Take fresh server data (new signed URLs, new photos) after each refresh.
  useEffect(() => { setPhotos(initial); setCoverId(initialCover); }, [initial, initialCover]);

  const count = photos.length;
  const room = MAX_PHOTOS - count;

  async function uploadOne(file: File) {
    return uploadListingPhoto(orgId, listingId, file);
  }

  async function addFiles(list: FileList | File[] | null) {
    if (!list || busy) return;
    const plan = planUpload(count, Array.from(list));
    if (plan.accepted.length === 0) {
      setMessage({ ok: false, text: plan.rejected[0] ? `${plan.rejected[0].file.name}: ${plan.rejected[0].reason}` : "No photos chosen." });
      return;
    }
    setBusy(true);
    setMessage(null);
    const items: Uploading[] = plan.accepted.map((f, i) => ({ key: `${Date.now()}-${i}`, name: f.name, preview: URL.createObjectURL(f), state: "waiting" }));
    setUploads(items);
    const results: Awaited<ReturnType<typeof uploadOne>>[] = [];
    const failed: string[] = [];
    let next = 0;
    const worker = async () => {
      while (next < plan.accepted.length) {
        const i = next++;
        setUploads((u) => u.map((x, j) => (j === i ? { ...x, state: "uploading" } : x)));
        try {
          results[i] = await uploadOne(plan.accepted[i]!);
          setUploads((u) => u.map((x, j) => (j === i ? { ...x, state: "done" } : x)));
        } catch {
          failed.push(plan.accepted[i]!.name);
          setUploads((u) => u.map((x, j) => (j === i ? { ...x, state: "failed" } : x)));
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL_UPLOADS, plan.accepted.length) }, worker));
    const done = results.filter(Boolean);
    let text = "";
    let ok = true;
    if (done.length > 0) {
      const result = await registerPhotos({ listing_id: listingId, files: done });
      ok = result.ok;
      text = result.message ?? "";
      if (result.ok) router.refresh();
    }
    if (failed.length > 0) { ok = false; text = `${text} ${failed.length} photo(s) didn't upload: ${failed.slice(0, 3).join(", ")}.`.trim(); }
    if (plan.rejected.length > 0) { ok = false; text = `${text} ${plan.rejected.length} file(s) skipped — ${plan.rejected[0]!.reason}`.trim(); }
    setMessage({ ok, text });
    items.forEach((x) => URL.revokeObjectURL(x.preview));
    setUploads([]);
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function saveOrder(nextPhotos: ManagedPhoto[]) {
    const before = photos;
    setPhotos(nextPhotos);
    const result = await reorderPhotos({ listing_id: listingId, asset_ids: nextPhotos.map((p) => p.id) });
    if (!result.ok) {
      setPhotos(before);
      setMessage({ ok: false, text: result.message ?? "The new order wasn't saved." });
    }
  }

  async function makeMain(id: string) {
    const before = coverId;
    setCoverId(id);
    const result = await setMainPhoto(listingId, id);
    if (!result.ok) { setCoverId(before); setMessage({ ok: false, text: result.message ?? "" }); }
  }

  async function remove(id: string) {
    if (!window.confirm("Remove this photo? This can't be undone.")) return;
    const before = photos;
    setPhotos(photos.filter((p) => p.id !== id));
    const result = await deletePhoto(id);
    if (!result.ok) { setPhotos(before); setMessage({ ok: false, text: result.message ?? "" }); return; }
    router.refresh();
  }

  async function onReplaceFile(file: File | undefined) {
    const target = replaceTarget.current;
    replaceTarget.current = null;
    if (replaceRef.current) replaceRef.current.value = "";
    if (!file || !target) return;
    const check = checkPhotoFile(file);
    if (!check.ok) { setMessage({ ok: false, text: check.reason }); return; }
    setBusy(true);
    setMessage(null);
    try {
      const uploaded = await uploadOne(file);
      const result = await replacePhoto({ asset_id: target, ...uploaded });
      setMessage({ ok: result.ok, text: result.message ?? "" });
      if (result.ok) router.refresh();
    } catch {
      setMessage({ ok: false, text: `${file.name} couldn't be uploaded.` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-lg font-semibold">
          {count} of {MAX_PHOTOS} photos
          <span className={cn("ml-2 text-base font-normal", count >= MIN_PHOTOS ? "text-success" : "text-muted-foreground")}>
            {count >= MIN_PHOTOS ? "— enough for a video" : `— add at least ${MIN_PHOTOS - count} more`}
          </span>
        </p>
        <p className="text-sm text-muted-foreground">Drag photos to change the order. The main photo opens the video.</p>
      </div>

      <label
        onDragOver={(e) => { e.preventDefault(); if (e.dataTransfer.types.includes("Files")) setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files); }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors focus-within:ring-2 focus-within:ring-ring",
          dragOver ? "border-primary bg-primary/5" : "border-input bg-card hover:border-primary/60",
          (busy || room <= 0) && "pointer-events-none opacity-60",
        )}
      >
        {busy ? <LoaderCircle className="size-9 animate-spin text-primary" aria-hidden="true" /> : <ImagePlus className="size-9 text-primary" aria-hidden="true" />}
        <span className="text-lg font-semibold">
          {busy ? "Uploading…" : room <= 0 ? "This listing has the maximum of 30 photos" : "Drop photos here, or click to choose"}
        </span>
        <span className="text-base text-muted-foreground">JPG, PNG, WebP or HEIC · choose several at once · up to {MAX_PHOTOS} photos · 50 MB each</span>
        <input
          ref={inputRef} type="file" multiple accept={PHOTO_MIME_TYPES.join(",")} className="sr-only"
          disabled={busy || room <= 0} onChange={(e) => void addFiles(e.target.files)} aria-label="Choose photos to upload"
        />
      </label>
      <input ref={replaceRef} type="file" accept={PHOTO_MIME_TYPES.join(",")} className="hidden" onChange={(e) => void onReplaceFile(e.target.files?.[0])} tabIndex={-1} aria-hidden="true" />

      {message ? (
        <Alert variant={message.ok ? "success" : "destructive"} aria-live="polite">
          <AlertDescription className="text-base">{message.text}</AlertDescription>
        </Alert>
      ) : null}

      {uploads.length > 0 ? (
        <ul className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-6" aria-label="Uploading">
          {uploads.map((u) => (
            <li key={u.key} className="relative overflow-hidden rounded-lg border bg-muted">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={u.preview} alt="" className={cn("aspect-[4/3] w-full object-cover", u.state !== "done" && "opacity-50")} />
              <span className="absolute inset-x-0 bottom-0 bg-black/70 px-2 py-1 text-xs text-white">
                {u.state === "waiting" ? "Waiting…" : u.state === "uploading" ? "Uploading…" : u.state === "done" ? "Uploaded" : "Failed"}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {photos.length > 0 ? (
        <ol className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4" aria-label="Photos in video order">
          {photos.map((p, i) => {
            const isMain = p.id === coverId;
            return (
              <li
                key={p.id}
                draggable={!busy}
                onDragStart={(e) => { setDragIndex(i); e.dataTransfer.effectAllowed = "move"; }}
                onDragOver={(e) => { if (dragIndex !== null) e.preventDefault(); }}
                onDrop={(e) => { e.preventDefault(); if (dragIndex !== null && dragIndex !== i) void saveOrder(moveItem(photos, dragIndex, i)); setDragIndex(null); }}
                onDragEnd={() => setDragIndex(null)}
                className={cn("flex flex-col overflow-hidden rounded-xl border-2 bg-card", isMain ? "border-primary" : "border-border", dragIndex === i && "opacity-40")}
              >
                <button type="button" className="relative block" onClick={() => setPreview(i)} aria-label={`Preview photo ${i + 1}`}>
                  {p.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.thumb ?? p.url} alt={`Photo ${i + 1}`} className="aspect-[4/3] w-full object-cover" loading="lazy" />
                  ) : (
                    <span className="flex aspect-[4/3] items-center justify-center bg-muted text-sm text-muted-foreground">Preview not available</span>
                  )}
                  <span className="absolute left-2 top-2 flex items-center gap-1 rounded-md bg-black/70 px-2 py-0.5 text-sm font-semibold text-white">
                    <GripVertical className="size-4" aria-hidden="true" />{i + 1}
                  </span>
                  {isMain ? <span className="absolute right-2 top-2 rounded-md bg-primary px-2 py-0.5 text-sm font-semibold text-primary-foreground">Main photo</span> : null}
                </button>
                <div className="flex flex-wrap items-center gap-1 p-2">
                  <Button type="button" size="icon" variant="ghost" className="h-9 w-9" aria-label={`Move photo ${i + 1} earlier`} disabled={i === 0 || busy} onClick={() => void saveOrder(moveItem(photos, i, i - 1))}><ArrowLeft aria-hidden="true" /></Button>
                  <Button type="button" size="icon" variant="ghost" className="h-9 w-9" aria-label={`Move photo ${i + 1} later`} disabled={i === photos.length - 1 || busy} onClick={() => void saveOrder(moveItem(photos, i, i + 1))}><ArrowRight aria-hidden="true" /></Button>
                  <Button type="button" size="icon" variant="ghost" className="h-9 w-9" aria-label={isMain ? "This is the main photo" : `Make photo ${i + 1} the main photo`} aria-pressed={isMain} disabled={isMain || busy} onClick={() => void makeMain(p.id)}>
                    <Star className={cn(isMain && "fill-primary text-primary")} aria-hidden="true" />
                  </Button>
                  <Button type="button" size="icon" variant="ghost" className="h-9 w-9" aria-label={`Replace photo ${i + 1}`} disabled={busy} onClick={() => { replaceTarget.current = p.id; replaceRef.current?.click(); }}><RefreshCw aria-hidden="true" /></Button>
                  <Button type="button" size="icon" variant="ghost" className="ml-auto h-9 w-9 text-destructive hover:text-destructive" aria-label={`Remove photo ${i + 1}`} disabled={busy} onClick={() => void remove(p.id)}><Trash2 aria-hidden="true" /></Button>
                </div>
              </li>
            );
          })}
        </ol>
      ) : null}

      {preview !== null && photos[preview] ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4" role="dialog" aria-modal="true" aria-label={`Photo ${preview + 1} of ${photos.length}`}
          onKeyDown={(e) => {
            if (e.key === "Escape") setPreview(null);
            if (e.key === "ArrowRight") setPreview((p) => (p === null ? p : Math.min(photos.length - 1, p + 1)));
            if (e.key === "ArrowLeft") setPreview((p) => (p === null ? p : Math.max(0, p - 1)));
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {photos[preview]!.url ? <img src={photos[preview]!.url!} alt={`Photo ${preview + 1}`} className="max-h-[85vh] max-w-full rounded-lg object-contain" /> : null}
          <Button autoFocus type="button" size="icon" variant="secondary" className="absolute right-4 top-4" aria-label="Close preview" onClick={() => setPreview(null)}><X aria-hidden="true" /></Button>
          <Button type="button" size="icon" variant="secondary" className="absolute left-4 top-1/2" aria-label="Previous photo" disabled={preview === 0} onClick={() => setPreview(preview - 1)}><ChevronLeft aria-hidden="true" /></Button>
          <Button type="button" size="icon" variant="secondary" className="absolute right-4 top-1/2" aria-label="Next photo" disabled={preview === photos.length - 1} onClick={() => setPreview(preview + 1)}><ChevronRight aria-hidden="true" /></Button>
          <p className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-md bg-black/70 px-3 py-1 text-white">{preview + 1} / {photos.length}</p>
        </div>
      ) : null}
    </div>
  );
}
