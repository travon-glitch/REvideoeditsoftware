/*
 * Verified listing facts, and the checker that keeps the Director honest.
 *
 * Claude only ever sees facts from the listing record the agent filled in. Every
 * piece of on-screen text it writes is then checked here, deterministically:
 *  - every number (price, beds, baths, size, times, phone digits) must appear in
 *    the verified facts;
 *  - every amenity word (pool, garage, fireplace, renovated, waterfront…) must be
 *    in the listing's own text or be a room type the photos actually show;
 *  - fair-housing problem phrases are removed.
 * Text that fails is dropped and reported — never shown in the video.
 */
import type { ListingRow } from "@/lib/database.types";
import { formatOpenHouse } from "@/lib/listings";
import type { FactKey, RoomType } from "./schema";

export type VerifiedFacts = Partial<Record<FactKey, string>>;

const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

/** Only fields the agent entered on the listing. Empty fields are left out entirely. */
export function verifiedFacts(l: Pick<ListingRow, "address_line" | "city" | "state" | "price" | "bedrooms" | "bathrooms" | "square_feet" |
  "property_type" | "status" | "agent_name" | "brokerage" | "contact_phone" | "contact_email" | "description" | "open_house_date" | "open_house_start" | "open_house_end">): VerifiedFacts {
  const f: VerifiedFacts = {};
  const set = (k: FactKey, v: string | null | undefined) => { if (v && v.trim()) f[k] = v.trim(); };
  set("address", l.address_line);
  set("city", [l.city, l.state].filter(Boolean).join(", "));
  if (l.price != null) set("price", money(l.price));
  if (l.bedrooms != null) set("bedrooms", String(l.bedrooms));
  if (l.bathrooms != null) set("bathrooms", String(l.bathrooms));
  if (l.square_feet != null) set("square_feet", `${l.square_feet.toLocaleString("en-US")} sq ft`);
  set("property_type", l.property_type?.replace(/_/g, " ") ?? null);
  set("status", l.status.replace(/_/g, " "));
  set("open_house", formatOpenHouse(l.open_house_date, l.open_house_start, l.open_house_end));
  set("agent", l.agent_name);
  set("brokerage", l.brokerage);
  set("phone", l.contact_phone);
  set("email", l.contact_email);
  set("description", l.description?.slice(0, 2000) ?? null);
  return f;
}

/* ── Claim checking ────────────────────────────────────────────────────── */

/** Amenity / condition words that are factual claims about the property. */
const AMENITIES: Record<string, string[]> = {
  pool: ["pool", "swimming"], spa: ["spa", "hot tub", "jacuzzi"], garage: ["garage", "carport"], fireplace: ["fireplace"],
  basement: ["basement"], patio: ["patio", "deck", "terrace"], backyard: ["backyard", "yard", "garden"], view: ["view", "views", "ocean", "lake", "mountain", "waterfront", "beach"],
  renovated: ["renovated", "remodeled", "updated", "new roof", "brand new", "newly", "upgraded"], hardwood: ["hardwood"],
  granite: ["granite", "quartz", "marble"], solar: ["solar"], smart: ["smart home"], acre: ["acre", "acres"],
  gated: ["gated"], elevator: ["elevator"], wine: ["wine cellar"], theater: ["theater", "theatre", "home cinema"], gym: ["gym", "fitness"],
  office: ["office", "study"], laundry: ["laundry"], ac: ["air conditioning", "central air", "a/c"], school: ["school", "schools"],
};
/** Room types the photos can prove (a pool photo grounds the word "pool"). */
const ROOM_GROUNDS: Partial<Record<RoomType, string[]>> = {
  pool: ["pool"], garage: ["garage"], basement: ["basement"], patio: ["patio"], backyard: ["backyard"],
};
/** Fair-housing: phrases that describe people instead of the property. */
const FAIR_HOUSING = [
  /perfect for (a )?(young )?(famil(y|ies)|couples?|singles?|retirees|bachelors?|empty.nesters)/i, /family[- ]friendly/i, /\bno (kids|children)\b/i,
  /adults? only/i, /bachelor pad/i, /\bexclusive (neighbou?rhood|community)\b/i, /walking distance to (church|synagogue|mosque|temple)/i,
  /\b(christian|jewish|muslim|catholic|hispanic|white|black|asian) (neighbou?rhood|community|area)\b/i, /\bideal for (families|seniors)\b/i,
];

export interface ClaimCheck { ok: boolean; reason?: string }

function numbersIn(text: string): string[] {
  return (text.match(/\d[\d,]*(\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, ""));
}

/**
 * Is every factual claim in `text` backed by the verified facts or the photos?
 * `rooms` = room types the photo analysis found.
 */
export function checkClaim(text: string, facts: VerifiedFacts, rooms: Set<RoomType>): ClaimCheck {
  const factText = Object.values(facts).join(" \n ").toLowerCase();
  const factNumbers = new Set(numbersIn(Object.values(facts).join(" ")));
  for (const n of numbersIn(text)) {
    if (!factNumbers.has(n) && !factNumbers.has(n.replace(/\.0+$/, ""))) return { ok: false, reason: `the number "${n}" isn't in the listing` };
  }
  const lower = ` ${text.toLowerCase()} `;
  for (const [amenity, words] of Object.entries(AMENITIES)) {
    for (const w of words) {
      if (!new RegExp(`\\b${w.replace(/[/]/g, "\\/")}\\b`, "i").test(lower)) continue;
      const grounded = words.some((x) => factText.includes(x))
        || Object.entries(ROOM_GROUNDS).some(([room, g]) => rooms.has(room as RoomType) && (g ?? []).includes(amenity));
      if (!grounded) return { ok: false, reason: `"${w}" isn't in the listing details or the photos` };
    }
  }
  for (const re of FAIR_HOUSING) if (re.test(text)) return { ok: false, reason: "describes people rather than the property (fair housing)" };
  return { ok: true };
}
