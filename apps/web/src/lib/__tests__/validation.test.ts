import { describe, expect, it } from "vitest";
import {
  createVideoSchema, createUserSchema, editUserSchema, formDataToObject, userStatusSchema, listingSchema, passwordSchema, setupSchema, brandKitSchema, fieldErrors,
} from "@/lib/validation";
import { generateSetupCode } from "@/lib/bootstrap";
import { hexToHslTriplet } from "@/lib/utils";

describe("forms", () => {
  it("parse listing numbers the way people type them", () => {
    const r = listingSchema.parse({ address_line: " 12 Oak Lane ", price: "$450,000", bedrooms: "3", bathrooms: "2.5", square_feet: "", city: "" });
    expect(r).toMatchObject({ address_line: "12 Oak Lane", price: 450000, bedrooms: 3, bathrooms: 2.5, square_feet: null, city: null, status: "for_sale" });
    const bad = listingSchema.safeParse({ address_line: "12 Oak", square_feet: "12.5", price: "lots" });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(Object.keys(fieldErrors(bad.error)).sort()).toEqual(["price", "square_feet"]);
  });

  it("require strong passwords", () => {
    expect(passwordSchema.safeParse("short").success).toBe(false);
    expect(passwordSchema.safeParse("alllowercase123").success).toBe(false);
    expect(passwordSchema.safeParse("Good-Password-2026").success).toBe(true);
  });

  it("check the setup form", () => {
    const base = { code: generateSetupCode().toLowerCase(), companyName: "Acme", fullName: "Sam Lee", email: "SAM@acme.test", password: "Good-Password-2026", confirm: "Good-Password-2026" };
    const ok = setupSchema.parse(base);
    expect(ok.email).toBe("sam@acme.test");
    expect(ok.code).toMatch(/^[A-Z0-9-]+$/);
    expect(setupSchema.safeParse({ ...base, confirm: "different" }).success).toBe(false);
    expect(setupSchema.safeParse({ ...base, code: "12345" }).success).toBe(false);
  });

  it("check the Create User form and refuse creating a Super Admin", () => {
    const base = { email: " Al@B.co ", first_name: "Al", last_name: "Baker", role: "editor" };
    const ok = createUserSchema.parse({ ...base, job_title: "", can_download: "on", max_videos_per_month: "10", max_ai_generations_per_month: "" });
    expect(ok).toMatchObject({ email: "al@b.co", job_title: null, can_download: true, can_use_ai: false, max_videos_per_month: 10, max_ai_generations_per_month: null });
    expect(createUserSchema.safeParse({ ...base, role: "super_admin" }).success).toBe(false);
    expect(createUserSchema.safeParse({ ...base, role: "creator" }).success).toBe(false);
    expect(createUserSchema.safeParse({ ...base, first_name: " " }).success).toBe(false);
    expect(createUserSchema.safeParse({ ...base, max_videos_per_month: "-1" }).success).toBe(false);
    expect(createUserSchema.safeParse({ ...base, max_videos_per_month: "2.5" }).success).toBe(false);
    expect(createUserSchema.safeParse({ ...base, password: "x" }).success).toBe(true); // extra fields are dropped, never used
    expect("password" in createUserSchema.parse({ ...base, password: "x" })).toBe(false);
  });

  it("check edit and status changes", () => {
    const id = "33333333-3333-4333-8333-333333333333";
    expect(editUserSchema.safeParse({ user_id: id, first_name: "A", last_name: "B", role: "viewer" }).success).toBe(true);
    expect(editUserSchema.safeParse({ user_id: "nope", first_name: "A", last_name: "B", role: "viewer" }).success).toBe(false);
    expect(userStatusSchema.safeParse({ user_id: id, status: "suspended" }).success).toBe(true);
    expect(userStatusSchema.safeParse({ user_id: id, status: "invited" }).success).toBe(false);
  });

  it("need at least one video shape", () => {
    const ids = { listing_id: "33333333-3333-4333-8333-333333333333", template_id: "44444444-4444-4444-8444-444444444444" };
    expect(createVideoSchema.safeParse({ ...ids, aspect_ratios: [] }).success).toBe(false);
    expect(createVideoSchema.safeParse({ ...ids, aspect_ratios: ["16:9", "3:2"] }).success).toBe(false);
    expect(createVideoSchema.parse({ ...ids, aspect_ratios: ["9:16"], title: "" }).title).toBeNull();
  });

  it("accept only hex brand colors", () => {
    const base = { primary_color: "#1D4ED8", secondary_color: "#0F172A", accent_color: "#F59E0B", heading_font: "Inter", body_font: "Inter" };
    expect(brandKitSchema.safeParse(base).success).toBe(true);
    expect(brandKitSchema.safeParse({ ...base, primary_color: "red;background:url(x)" }).success).toBe(false);
    expect(hexToHslTriplet("#1D4ED8")).toBe("224 76% 48%");
    expect(hexToHslTriplet("blue")).toBeNull();
  });

  it("read FormData, including repeated fields", () => {
    const fd = new FormData();
    fd.append("aspect_ratios", "16:9");
    fd.append("aspect_ratios", "9:16");
    fd.append("title", "Hi");
    fd.append("$ACTION_ID_abc", "");
    expect(formDataToObject(fd, ["aspect_ratios", "missing"])).toEqual({ aspect_ratios: ["16:9", "9:16"], title: "Hi", missing: [] });
  });
});
