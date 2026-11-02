/* Listing + photo rules shared by the UI, server actions and tests (no I/O). */
import { checkPhotoFile } from "@/lib/storage";

export const MIN_PHOTOS = 5;
export const MAX_PHOTOS = 30;

export const PROPERTY_TYPES = [
  "single_family", "condo", "townhouse", "multi_family", "manufactured", "land", "commercial", "other",
] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

export const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = {
  single_family: "Single-family home",
  condo: "Condo / apartment",
  townhouse: "Townhouse",
  multi_family: "Multi-family",
  manufactured: "Manufactured / mobile",
  land: "Land / lot",
  commercial: "Commercial",
  other: "Other",
};

export interface UploadCandidate { name: string; type: string; size: number }
export interface UploadPlan<T extends UploadCandidate> {
  accepted: T[];
  rejected: { file: T; reason: string }[];
}

/** Which of the chosen files can be uploaded, given how many photos the listing already has. */
export function planUpload<T extends UploadCandidate>(existingCount: number, files: T[], max = MAX_PHOTOS): UploadPlan<T> {
  const accepted: T[] = [];
  const rejected: { file: T; reason: string }[] = [];
  let room = Math.max(0, max - existingCount);
  for (const file of files) {
    const check = checkPhotoFile(file);
    if (!check.ok) {
      rejected.push({ file, reason: check.reason });
    } else if (room <= 0) {
      rejected.push({ file, reason: `A listing can have up to ${max} photos.` });
    } else {
      accepted.push(file);
      room -= 1;
    }
  }
  return { accepted, rejected };
}

/** Returns a new array with the item at `from` moved to `to`. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const out = [...items];
  if (from < 0 || from >= out.length || to < 0 || to >= out.length || from === to) return out;
  const [item] = out.splice(from, 1);
  out.splice(to, 0, item!);
  return out;
}

export interface ReadinessInput {
  address_line: string | null;
  city: string | null;
  state: string | null;
  price: number | null;
  description: string | null;
  agent_name: string | null;
  photoCount: number;
  hasCover: boolean;
}

export interface ChecklistItem { label: string; done: boolean; required: boolean }

/** What "Save and Continue" shows. Only the address and 5–30 photos are required. */
export function readinessChecklist(l: ReadinessInput): ChecklistItem[] {
  return [
    { label: "Property address", done: !!l.address_line && l.address_line.trim().length >= 3, required: true },
    { label: `${MIN_PHOTOS} to ${MAX_PHOTOS} photos`, done: l.photoCount >= MIN_PHOTOS && l.photoCount <= MAX_PHOTOS, required: true },
    { label: "Main photo chosen", done: l.hasCover, required: false },
    { label: "City and state", done: !!l.city && !!l.state, required: false },
    { label: "Listing price", done: l.price != null, required: false },
    { label: "Description (used for the voice-over)", done: !!l.description && l.description.trim().length > 0, required: false },
    { label: "Agent name", done: !!l.agent_name, required: false },
  ];
}

export function isReady(items: ChecklistItem[]): boolean {
  return items.every((i) => !i.required || i.done);
}

/** Photo order for a video: the main photo first, then the rest in the chosen order. */
export function orderForVideo<T extends { id: string }>(photos: readonly T[], coverId: string | null): T[] {
  if (!coverId) return [...photos];
  const cover = photos.find((p) => p.id === coverId);
  return cover ? [cover, ...photos.filter((p) => p.id !== coverId)] : [...photos];
}

/** "Sat, Nov 15 · 1:00 PM – 3:00 PM" */
export function formatOpenHouse(date: string | null, start: string | null, end: string | null): string | null {
  if (!date) return null;
  const d = new Date(`${date}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const day = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }).format(d);
  const t = (hhmm: string | null) => {
    if (!hhmm) return null;
    const [h, m] = hhmm.split(":").map(Number);
    if (h == null || m == null || Number.isNaN(h) || Number.isNaN(m)) return null;
    const dt = new Date(2000, 0, 1, h, m);
    return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(dt);
  };
  const s = t(start), e = t(end);
  return [day, s && e ? `${s} – ${e}` : s].filter(Boolean).join(" · ");
}
