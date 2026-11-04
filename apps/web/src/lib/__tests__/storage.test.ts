import { describe, expect, it } from "vitest";
import {
  brandLogoPath, checkLogoFile, checkPhotoFile, cleanFileName, isBrandLogoPathFor, isListingPhotoPathFor, listingPhotoPath,
} from "@/lib/storage";

const org = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const listing = "33333333-3333-4333-8333-333333333333";
const obj = "44444444-4444-4444-8444-444444444444";

describe("storage paths", () => {
  it("put files in the company folder with random names", () => {
    expect(listingPhotoPath(org, listing, obj, "image/jpeg")).toBe(`${org}/listings/${listing}/${obj}.jpg`);
    expect(brandLogoPath(org, obj, "image/png")).toBe(`${org}/brand/${obj}.png`);
    expect(() => listingPhotoPath(org, listing, "../../x", "image/jpeg")).toThrow();
    expect(() => listingPhotoPath(org, listing, obj, "image/svg+xml")).toThrow();
  });

  it("accept only paths for the caller's company and listing", () => {
    const p = listingPhotoPath(org, listing, obj, "image/webp");
    expect(isListingPhotoPathFor(p, org, listing)).toBe(true);
    expect(isListingPhotoPathFor(p, other, listing)).toBe(false);
    expect(isListingPhotoPathFor(p.replace(listing, other), org, listing)).toBe(false);
    expect(isListingPhotoPathFor(`${org}/listings/${listing}/../${obj}.jpg`, org, listing)).toBe(false);
    expect(isListingPhotoPathFor(`${org}/listings/${listing}/${obj}.svg`, org, listing)).toBe(false);
    expect(isBrandLogoPathFor(brandLogoPath(org, obj, "image/png"), org)).toBe(true);
    expect(isBrandLogoPathFor(brandLogoPath(org, obj, "image/png"), other)).toBe(false);
  });
});

describe("file checks", () => {
  it("allow photos, refuse SVG, empty and huge files", () => {
    expect(checkPhotoFile({ type: "image/webp", size: 1000 }).ok).toBe(true);
    // HEIC can't be shown by the renderer (Chrome): refused with instructions to send JPG
    const heic = checkPhotoFile({ type: "image/heic", size: 1000 });
    expect(heic.ok).toBe(false);
    expect(!heic.ok && heic.reason).toMatch(/JPG/);
    expect(checkPhotoFile({ type: "image/svg+xml", size: 1000 }).ok).toBe(false);
    expect(checkPhotoFile({ type: "image/jpeg", size: 0 }).ok).toBe(false);
    expect(checkPhotoFile({ type: "image/jpeg", size: 51 * 1024 * 1024 }).ok).toBe(false);
    expect(checkLogoFile({ type: "image/svg+xml", size: 10 }).ok).toBe(false);
  });

  it("clean file names kept as metadata", () => {
    expect(cleanFileName("C:\\Users\\me\\<script>.jpg")).toBe("_script_.jpg");
    expect(cleanFileName("../../etc/passwd")).toBe("passwd");
    expect(cleanFileName("")).toBe("file");
  });
});
