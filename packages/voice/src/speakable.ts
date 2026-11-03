/*
 * Turns written listing text into what the voice should say ("$525,000" → "five hundred
 * twenty-five thousand dollars", "742 Evergreen" → "seven forty-two Evergreen", "2.5 baths" →
 * "two and a half baths", "OR" after a city → "Oregon") and remembers which spoken words came
 * from which written word, so captions can show the written words at the spoken times.
 */

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const ORD: Record<string, string> = { one: "first", two: "second", three: "third", five: "fifth", eight: "eighth", nine: "ninth", twelve: "twelfth" };

function under1000(n: number): string {
  const h = Math.floor(n / 100), r = n % 100;
  const parts: string[] = [];
  if (h) parts.push(`${ONES[h]} hundred`);
  if (r) parts.push(r < 20 ? ONES[r]! : `${TENS[Math.floor(r / 10)]}${r % 10 ? `-${ONES[r % 10]}` : ""}`);
  return parts.join(" ");
}

/** 1234567 → "one million two hundred thirty-four thousand five hundred sixty-seven". */
export function numberToWords(n: number): string {
  if (!Number.isFinite(n)) return "";
  if (n < 0) return `minus ${numberToWords(-n)}`;
  n = Math.floor(n);
  if (n === 0) return "zero";
  const scales: [number, string][] = [[1e12, "trillion"], [1e9, "billion"], [1e6, "million"], [1e3, "thousand"]];
  const out: string[] = [];
  for (const [v, name] of scales) {
    if (n >= v) { out.push(`${under1000(Math.floor(n / v))} ${name}`); n %= v; }
  }
  if (n) out.push(under1000(n));
  return out.join(" ");
}

/** House numbers the way people say them: 742 → "seven forty-two", 1600 → "sixteen hundred", 12 → "twelve". */
export function houseNumber(n: number): string {
  if (n < 100 || n >= 10000) return numberToWords(n);
  if (n < 1000) {
    const h = Math.floor(n / 100), r = n % 100;
    return r === 0 ? `${ONES[h]} hundred` : `${ONES[h]} ${r < 10 ? `oh ${ONES[r]}` : numberToWords(r)}`;
  }
  const hi = Math.floor(n / 100), lo = n % 100;
  if (n % 1000 === 0) return numberToWords(n);
  return lo === 0 ? `${numberToWords(hi)} hundred` : `${numberToWords(hi)} ${lo < 10 ? `oh ${ONES[lo]}` : numberToWords(lo)}`;
}

function ordinal(n: number): string {
  const w = numberToWords(n).split(/([ -])/);
  const last = w[w.length - 1]!;
  w[w.length - 1] = ORD[last] ?? (last.endsWith("y") ? `${last.slice(0, -1)}ieth` : `${last}th`);
  return w.join("");
}

const STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts",
  MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island",
  SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia",
  WI: "Wisconsin", WY: "Wyoming", DC: "D C",
};
const ABBREV: Record<string, string> = {
  st: "street", ave: "avenue", rd: "road", dr: "drive", blvd: "boulevard", ln: "lane", ct: "court", pl: "place", hwy: "highway", pkwy: "parkway", ter: "terrace",
  sqft: "square feet", ft: "feet", sq: "square", apt: "apartment", ste: "suite", hoa: "h o a", mls: "m l s", bd: "bedroom", ba: "bath", approx: "approximately",
};

export interface SpokenWord { written: string; spoken: string[] }

/** Split written text into words, each with what will be said for it. */
export function speakable(text: string): { words: SpokenWord[]; spoken: string } {
  const raw = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const words: SpokenWord[] = [];
  for (let i = 0; i < raw.length; i++) {
    const w = raw[i]!;
    const prev = raw[i - 1] ?? "";
    const next = raw[i + 1] ?? "";
    const core = w.replace(/^[("'“]+|[)"'”.,!?;:]+$/g, "");
    let say: string;
    let m: RegExpExecArray | null;
    if ((m = /^\$(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?([kKmM])?$/.exec(core))) {
      const base = Number(m[1]!.replace(/,/g, ""));
      const suffix = m[3]?.toLowerCase();
      if (suffix === "m") say = `${m[2] ? `${numberToWords(base)} point ${m[2].split("").map((d) => ONES[Number(d)]).join(" ")}` : numberToWords(base)} million dollars`;
      else if (suffix === "k") say = `${numberToWords(base)} thousand dollars`;
      else say = `${numberToWords(base)} dollars${m[2] && Number(m[2]) ? ` and ${numberToWords(Number(m[2].padEnd(2, "0").slice(0, 2)))} cents` : ""}`;
    } else if ((m = /^(\d+)\.5$/.exec(core))) {
      say = `${numberToWords(Number(m[1]))} and a half`;
    } else if ((m = /^(\d+)\.(\d+)$/.exec(core))) {
      say = `${numberToWords(Number(m[1]))} point ${m[2]!.split("").map((d) => ONES[Number(d)]).join(" ")}`;
    } else if ((m = /^(\d{1,3}(?:,\d{3})+)$/.exec(core))) {
      say = numberToWords(Number(m[1]!.replace(/,/g, "")));
    } else if ((m = /^(\d+)(st|nd|rd|th)$/i.exec(core))) {
      say = ordinal(Number(m[1]));
    } else if ((m = /^(\d+)$/.exec(core))) {
      const n = Number(m[1]);
      // a house number: digits right before a capitalised street name
      say = n >= 100 && n < 10000 && /^[A-Z][a-z]/.test(next) && !/^(19|20)\d\d$/.test(core) ? houseNumber(n) : numberToWords(n);
    } else if ((m = /^(\d+)%$/.exec(core))) {
      say = `${numberToWords(Number(m[1]))} percent`;
    } else if (/^[A-Z]{2}$/.test(core) && STATES[core] && /,$/.test(prev)) {
      say = STATES[core]!;
    } else if (ABBREV[core.toLowerCase().replace(/\.$/, "")] && (core.length <= 5)) {
      say = ABBREV[core.toLowerCase().replace(/\.$/, "")]!;
    } else if (core === "&") {
      say = "and";
    } else {
      say = core;
    }
    const spoken = say.toLowerCase().replace(/[-–—/]/g, " ").replace(/[^a-z0-9' ]/g, "").split(" ").filter(Boolean);
    words.push({ written: w, spoken });
  }
  // what the voice is given: the expanded words with the original punctuation kept for pauses
  const spokenText = words.map((x) => {
    const tail = /[.,!?;:]+$/.exec(x.written)?.[0] ?? "";
    return x.spoken.join(" ") + tail;
  }).filter((s) => s.replace(/[.,!?;:]/g, "").length > 0).join(" ");
  return { words, spoken: spokenText };
}

/** Sentences (for synthesis one at a time, so their start and end are exact). */
export function sentences(text: string): string[] {
  return text.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+(?=[A-Z0-9$"“])/).map((s) => s.trim()).filter(Boolean);
}
