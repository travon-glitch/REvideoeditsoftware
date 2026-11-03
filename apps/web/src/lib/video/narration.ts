/*
 * Narration scripts from VERIFIED listing information only (the fields the agent entered),
 * and a fact check for edited scripts (same checker as the AI Director: numbers must be on the
 * listing, amenity words must be in the listing's own text, fair-housing phrases are flagged).
 */
import { checkClaim, verifiedFacts } from "@/lib/director/facts";
import type { ListingRow } from "@/lib/database.types";
import { formatOpenHouse } from "@/lib/listings";

export const NARRATION_TONES = ["warm", "luxury", "concise"] as const;
export type NarrationTone = (typeof NARRATION_TONES)[number];

type NarrationListing = Pick<ListingRow, "address_line" | "city" | "state" | "price" | "bedrooms" | "bathrooms" | "square_feet" | "property_type" | "status" |
  "agent_name" | "brokerage" | "contact_phone" | "contact_email" | "description" | "open_house_date" | "open_house_start" | "open_house_end">;

const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
const TYPE: Record<string, string> = { single_family: "single-family home", condo: "condo", townhouse: "townhouse", multi_family: "multi-family property", land: "lot", commercial: "commercial property" };
const num = (n: number) => (Number.isInteger(n) ? String(n) : String(n));

/** A narration draft from the listing's facts (written words; the voice engine says them properly). */
export function draftNarration(l: NarrationListing, opts: { tone?: NarrationTone; agent?: { name: string; brokerage?: string | null } | null } = {}): string {
  const tone = opts.tone ?? "warm";
  const where = [l.city, l.state].filter(Boolean).join(", ");
  const address = l.address_line.trim();
  const type = l.property_type ? TYPE[l.property_type] ?? "home" : "home";
  const out: string[] = [];
  const at = address ? `${address}${where ? `, ${where}` : ""}` : where;
  if (tone === "luxury") out.push(at ? `Presenting ${at}.` : "Presenting this residence.");
  else if (tone === "concise") out.push(at ? `${at}.` : "A new listing.");
  else out.push(at ? `Welcome to ${at}.` : "Welcome home.");
  const rooms = [l.bedrooms != null ? `${num(Number(l.bedrooms))} bedroom${Number(l.bedrooms) === 1 ? "" : "s"}` : "", l.bathrooms != null ? `${num(Number(l.bathrooms))} bathroom${Number(l.bathrooms) === 1 ? "" : "s"}` : ""].filter(Boolean);
  const size = l.square_feet != null ? `${Number(l.square_feet).toLocaleString("en-US")} square feet` : "";
  if (rooms.length || size) {
    const what = rooms.join(" and ");
    if (tone === "concise") out.push(`${[what, size].filter(Boolean).join(", ")}.`.replace(/^./, (c) => c.toUpperCase()));
    else out.push(`This ${type} offers ${what || size}${what && size ? ` across ${size}` : ""}.`);
  }
  const oh = formatOpenHouse(l.open_house_date, l.open_house_start, l.open_house_end);
  if (oh) out.push(`Join us for the open house, ${oh}.`);
  if (l.price != null) {
    const p = money(Number(l.price));
    out.push(l.status === "for_rent" ? `Available for ${p} a month.` : l.status === "sold" ? `Sold.` : tone === "luxury" ? `Offered at ${p}.` : `It's offered at ${p}.`);
  }
  const agent = opts.agent?.name ?? l.agent_name;
  const brokerage = opts.agent?.brokerage ?? l.brokerage;
  if (agent) out.push(`To arrange a private showing, contact ${agent}${brokerage ? ` of ${brokerage}` : ""}.`);
  else if (l.contact_phone) out.push(`Call ${l.contact_phone} to arrange a showing.`);
  return out.join(" ");
}

/** Sentences of an edited script that make claims the listing doesn't back up. */
export function checkNarration(script: string, l: NarrationListing): { sentence: string; reason: string }[] {
  const facts = verifiedFacts(l);
  return script.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean).flatMap((s) => {
    const c = checkClaim(s, facts, new Set());
    return c.ok ? [] : [{ sentence: s, reason: c.reason ?? "not on the listing" }];
  });
}
