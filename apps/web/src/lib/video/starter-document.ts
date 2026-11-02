/*
 * Builds the first FableCut project document (project.json) for a new video:
 * each listing photo becomes an image clip with a Ken Burns camera move, plus
 * an address/price title card and an outro card from the brand kit.
 *
 * The schema is FableCut's (packages/fablecut-core/upstream/CLAUDE.md,
 * "project.json schema"); documents are validated with FableCut's own
 * ProjectOps.checkProject before they are saved. Media `src` uses FableCut's
 * "/media/<file>" convention; the Editor Gateway (Stage 3) maps it to signed
 * storage URLs via `assetId`.
 */
import { CAMERA_MOVES, kenBurnsKeyframes } from "@lvs/camera-presets";
import { formatPrice } from "@/lib/utils";

export type AspectRatio = "16:9" | "9:16" | "1:1" | "4:5";

export const CANVAS: Record<AspectRatio, { width: number; height: number }> = {
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
};

export interface StarterListing {
  address_line: string;
  city: string | null;
  state: string | null;
  price: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  square_feet: number | null;
  agent_name?: string | null;
  brokerage?: string | null;
  contact_phone?: string | null;
  contact_email?: string | null;
  /** Already formatted, e.g. "Sat, Nov 15 · 1:00 PM – 3:00 PM". */
  open_house_text?: string | null;
}

export interface StarterPhoto {
  id: string;
  storage_path: string;
  file_name: string;
  width: number | null;
  height: number | null;
}

export interface StarterBrand {
  company_name: string | null;
  primary_color: string;
  heading_font: string;
  body_font: string;
  outro_text: string | null;
}

export interface StarterTemplate {
  slug: string;
  style: { pace?: string } & Record<string, unknown>;
}

const PACE_SECONDS: Record<string, number> = { slow: 4.5, medium: 3.5, fast: 2.5 };
/** Free (Ken Burns) moves, rotated so consecutive photos differ. */
const FREE_MOVES = CAMERA_MOVES.filter((m) => !m.aiOnly).map((m) => m.id);

const round = (n: number) => Math.round(n * 1000) / 1000;

export function photoDuration(template: StarterTemplate): number {
  return PACE_SECONDS[String(template.style.pace ?? "medium")] ?? 3.5;
}

export function specsLine(l: StarterListing): string {
  return [
    l.bedrooms != null ? `${l.bedrooms} bd` : null,
    l.bathrooms != null ? `${l.bathrooms} ba` : null,
    l.square_feet != null ? `${l.square_feet.toLocaleString("en-US")} sq ft` : null,
  ].filter(Boolean).join("  ·  ");
}

export function buildStarterDocument(input: {
  title: string;
  aspect: AspectRatio;
  listing: StarterListing;
  photos: StarterPhoto[];
  template: StarterTemplate;
  brand: StarterBrand | null;
}): Record<string, unknown> {
  const { width, height } = CANVAS[input.aspect];
  const per = photoDuration(input.template);
  const fade = 0.6;

  const media = input.photos.map((p) => ({
    id: `m_${p.id.replace(/-/g, "").slice(0, 16)}`,
    assetId: p.id,
    name: p.file_name,
    kind: "image",
    src: `/media/${p.storage_path.split("/").pop()}`,
    ...(p.width && p.height ? { width: p.width, height: p.height } : {}),
  }));

  const clips: Record<string, unknown>[] = media.map((m, i) => {
    const move = FREE_MOVES[i % FREE_MOVES.length]!;
    return {
      id: `c_photo_${i + 1}`,
      mediaId: m.id,
      kind: "image",
      track: "V1",
      start: round(i * per),
      in: 0,
      duration: round(per + (i < media.length - 1 ? fade : 0)),
      name: `Photo ${i + 1}`,
      props: { fit: "cover" },
      cameraMove: move,
      keyframes: kenBurnsKeyframes(move, per, { width, height }),
      ...(i > 0 ? { transitionIn: { type: "fade", duration: fade } } : {}),
    };
  });

  const total = round(Math.max(media.length, 1) * per);
  const titleFont = input.brand?.heading_font ?? "Montserrat";
  const bodyFont = input.brand?.body_font ?? "Inter";
  const where = [input.listing.city, input.listing.state].filter(Boolean).join(", ");
  const priceLine = input.listing.price != null ? formatPrice(input.listing.price) : "";
  const lowerThird = Math.round(height * 0.3);

  clips.push({
    id: "c_title",
    mediaId: null,
    kind: "text",
    track: "V2",
    start: 0,
    in: 0,
    duration: round(Math.min(total, per * 1.5)),
    name: "Address",
    props: {
      text: [input.listing.address_line, where].filter(Boolean).join("\n"),
      font: titleFont, fontSize: Math.round(width * 0.04), bold: true, color: "#ffffff",
      y: lowerThird, textShadow: 14, textAnim: "rise-mask",
    },
    transitionOut: { type: "fade", duration: 0.5 },
  });

  const details = [priceLine, specsLine(input.listing)].filter(Boolean).join("\n");
  if (details && media.length > 1) {
    clips.push({
      id: "c_details",
      mediaId: null,
      kind: "text",
      track: "V2",
      start: round(per * 2),
      in: 0,
      duration: round(Math.min(per * 1.5, Math.max(total - per * 2, 1))),
      name: "Price and details",
      props: {
        text: details, font: bodyFont, fontSize: Math.round(width * 0.03), color: "#ffffff",
        bgColor: input.brand?.primary_color ?? "#1D4ED8", bgOpacity: 0.85, y: lowerThird, textAnim: "word-slide",
      },
    });
  }

  if (input.listing.open_house_text && media.length > 2) {
    clips.push({
      id: "c_open_house",
      mediaId: null,
      kind: "text",
      track: "V2",
      start: round(Math.max(total - per * 2.5, per)),
      in: 0,
      duration: round(per),
      name: "Open house",
      props: {
        text: `OPEN HOUSE\n${input.listing.open_house_text}`, font: titleFont, fontSize: Math.round(width * 0.035), bold: true,
        color: "#ffffff", bgColor: input.brand?.primary_color ?? "#1D4ED8", bgOpacity: 0.9, y: lowerThird, textAnim: "zoom-in",
      },
    });
  }

  const agentLine = [input.listing.agent_name, input.listing.brokerage].filter(Boolean).join(" · ");
  const contactLine = [input.listing.contact_phone, input.listing.contact_email].filter(Boolean).join("  ·  ");
  const outro = [agentLine || input.brand?.company_name, contactLine, input.brand?.outro_text].filter(Boolean).join("\n");
  if (outro) {
    clips.push({
      id: "c_outro",
      mediaId: null,
      kind: "text",
      track: "V3",
      start: round(Math.max(total - per, 0)),
      in: 0,
      duration: round(per),
      name: "Outro",
      props: { text: outro, font: titleFont, fontSize: Math.round(width * 0.035), color: "#ffffff", textShadow: 16, textAnim: "zoom-in" },
      transitionIn: { type: "fade", duration: 0.5 },
    });
  }

  return {
    name: input.title,
    width,
    height,
    fps: 30,
    background: "#000000",
    revision: 1,
    panSchema: 1,
    markers: [],
    tracks: [
      { id: "V3", kind: "video" }, { id: "V2", kind: "video" }, { id: "V1", kind: "video" },
      { id: "A1", kind: "audio" }, { id: "A2", kind: "audio" },
    ],
    media,
    clips,
    meta: { generator: "lvs-starter@1", template: input.template.slug, aspect: input.aspect },
  };
}
