/*
 * AI Video Director — the JSON Claude must return (validated twice: by the API's
 * structured-output schema, and again here with Zod before anything is used).
 */
import * as z from "zod/v4";
import { STUDIO_MOVE_IDS } from "@lvs/camera-presets";
import { TRANSITIONS, TEXT_POSITIONS, TEXT_STYLES } from "@/lib/video/plan";

export const ROOM_TYPES = [
  "exterior", "living_room", "kitchen", "bedroom", "bathroom", "dining_area", "basement",
  "backyard", "garage", "pool", "patio", "other",
] as const;
export type RoomType = (typeof ROOM_TYPES)[number];
export const ROOM_LABELS: Record<RoomType, string> = {
  exterior: "Exterior", living_room: "Living room", kitchen: "Kitchen", bedroom: "Bedroom", bathroom: "Bathroom",
  dining_area: "Dining area", basement: "Basement", backyard: "Backyard", garage: "Garage", pool: "Pool", patio: "Patio", other: "Other",
};

export const DIRECTOR_STYLES = ["luxury", "modern", "cinematic", "social", "open_house", "listing_tour"] as const;
export type DirectorStyle = (typeof DIRECTOR_STYLES)[number];
export const DIRECTOR_STYLE_INFO: Record<DirectorStyle, { label: string; aspect: "16:9" | "9:16" | "1:1"; seconds: [number, number]; brief: string }> = {
  luxury: { label: "Luxury", aspect: "16:9", seconds: [35, 50], brief: "Slow, elegant and understated. Few long shots, gentle camera moves, soft fades, refined minimal text." },
  modern: { label: "Modern", aspect: "16:9", seconds: [25, 35], brief: "Clean and crisp. Medium pacing, slides and wipes, bold short text." },
  cinematic: { label: "Cinematic", aspect: "16:9", seconds: [40, 60], brief: "Film-like storytelling: establish the exterior, flow room to room, slow moves with motion blur, emotional hook." },
  social: { label: "Social Media", aspect: "9:16", seconds: [15, 22], brief: "Vertical, fast, scroll-stopping hook in the first two seconds, quick cuts, punchy text, clear call to action." },
  open_house: { label: "Open House", aspect: "1:1", seconds: [20, 30], brief: "Invite people to the open house: date and time early and again near the end (only if the listing has them)." },
  listing_tour: { label: "Professional Listing Tour", aspect: "16:9", seconds: [45, 75], brief: "Complete, orderly walkthrough: exterior, main living spaces, kitchen, bedrooms, bathrooms, outdoor spaces. Informative room labels." },
};

export const MUSIC_MOODS = ["elegant", "calm", "upbeat", "warm", "inspiring", "none"] as const;

/* ── Call 1: photo interpretation ───────────────────────────────────────── */

export const photoAnalysisSchema = z.object({
  photos: z.array(z.object({
    ref: z.string().describe("The photo label exactly as given, e.g. P01"),
    room_type: z.enum(ROOM_TYPES),
    description: z.string().describe("One plain sentence describing only what is visible"),
    visible_features: z.array(z.string()).describe("Short nouns for clearly visible features, e.g. 'fireplace', 'island'. Empty if unsure."),
    quality: z.number().int().describe("Photo quality for marketing, 1 (poor) to 10 (excellent): sharpness, light, composition"),
    opener_score: z.number().int().describe("1 to 10: how well this works as the first shot of a video"),
    suggested_move: z.enum(STUDIO_MOVE_IDS),
  })),
  property_summary: z.string().describe("Two sentences on what the photos show overall, without guessing facts"),
});
export type PhotoAnalysis = z.infer<typeof photoAnalysisSchema>;

/* ── Call 2: storyboard ─────────────────────────────────────────────────── */

export const FACT_KEYS = [
  "address", "city", "price", "bedrooms", "bathrooms", "square_feet", "property_type", "status",
  "open_house", "agent", "brokerage", "phone", "email", "description",
] as const;
export type FactKey = (typeof FACT_KEYS)[number];

export const storyboardSchema = z.object({
  title: z.string(),
  opening_photo: z.string().describe("Ref of the best opening photo; must also be the first scene"),
  scenes: z.array(z.object({
    photo: z.string().describe("Photo ref, e.g. P07"),
    seconds: z.number().describe("1.5 to 10"),
    camera_move: z.enum(STUDIO_MOVE_IDS),
    intensity: z.enum(["gentle", "normal", "dramatic"]),
    transition: z.enum(TRANSITIONS).describe("Transition into this scene"),
    reason: z.string().describe("One short sentence: why this photo here"),
  })),
  text_overlays: z.array(z.object({
    scene: z.number().int().describe("0-based index into scenes"),
    text: z.string().describe("Short on-screen text, at most 2 lines"),
    style: z.enum(TEXT_STYLES),
    position: z.enum(TEXT_POSITIONS),
    kind: z.enum(["hook", "room_label", "fact", "highlight", "cta"]),
    fact_keys: z.array(z.enum(FACT_KEYS)).describe("Listing facts this text states; empty if none"),
  })),
  music_mood: z.enum(MUSIC_MOODS),
  call_to_action: z.string().describe("Ending call to action using only the contact facts provided"),
  highlights: z.array(z.string()).describe("3-6 listing highlights, each grounded in the facts or visible in a photo"),
  captions: z.object({
    instagram: z.string(),
    facebook: z.string(),
    short: z.string().describe("Under 150 characters"),
  }),
});
export type Storyboard = z.infer<typeof storyboardSchema>;
