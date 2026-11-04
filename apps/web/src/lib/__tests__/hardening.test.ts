/* Stage 14 hardening: content sniffing of uploads, password re-check rules, rate limit, HEIC refusal. */
import { describe, expect, it } from "vitest";
import { expectedKinds, sniffMedia } from "@lvs/render-worker/sniff";
import { isRealPhoto } from "../../../../../packages/ai-motion/src/process-job";
import { sessionMethod } from "@/lib/auth/reauth";
import { allow } from "@/lib/rate-limit";
import { checkPhotoFile } from "@/lib/storage";

const bytes = (...parts: (number[] | string)[]) => new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)).concat(Array(16).fill(0)));

describe("what a file really is", () => {
  it("recognises photos and audio by their first bytes", () => {
    expect(sniffMedia(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg");
    expect(sniffMedia(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("png");
    expect(sniffMedia(bytes("RIFF", [1, 2, 3, 4], "WEBP"))).toBe("webp");
    expect(sniffMedia(bytes("RIFF", [1, 2, 3, 4], "WAVE"))).toBe("wav");
    expect(sniffMedia(bytes([0, 0, 0, 0x20], "ftypM4A "))).toBe("mp4");
    expect(sniffMedia(bytes("ID3", [4, 0]))).toBe("mp3");
    expect(sniffMedia(bytes([0xff, 0xfb, 0x90]))).toBe("mp3");
    expect(sniffMedia(bytes([0xff, 0xf1, 0x50]))).toBe("aac");
  });
  it("refuses playlists, scripts, SVG and HEIC whatever they are called", () => {
    for (const fake of [bytes("#EXTM3U\n#EXT-X-VERSION:3\n"), bytes("<svg xmlns="), bytes("<!DOCTYPE html>"), bytes([0, 0, 0, 0x18], "ftypheic"), bytes("hello")]) {
      const k = sniffMedia(fake);
      expect(k === null || k === "mp4").toBe(true);
    }
    // HEIC and AVIF use the MP4 container but are refused
    expect(sniffMedia(bytes([0, 0, 0, 0x18], "ftypheic"))).toBeNull();
    expect(sniffMedia(bytes([0, 0, 0, 0x18], "ftypmif1"))).toBeNull();
    expect(sniffMedia(bytes("#EXTM3U"))).toBeNull();
    expect(expectedKinds("x.heic")).toBeNull();
    expect(expectedKinds("x.m4a")).toContain("mp4");
  });
  it("the AI worker decodes only real photos", () => {
    expect(isRealPhoto(bytes([0xff, 0xd8, 0xff, 0xe1]))).toBe(true);
    expect(isRealPhoto(bytes("#EXTM3U\n"))).toBe(false);
    expect(isRealPhoto(bytes([0, 0, 0, 0x18], "ftypheic"))).toBe(false);
  });
});

describe("changing a password", () => {
  const token = (amr: unknown) => `x.${Buffer.from(JSON.stringify({ amr })).toString("base64url")}.y`;
  it("reads how the session was opened (latest method wins)", () => {
    expect(sessionMethod(token([{ method: "password", timestamp: 10 }]))).toBe("password");
    expect(sessionMethod(token([{ method: "password", timestamp: 10 }, { method: "recovery", timestamp: 20 }]))).toBe("recovery");
    expect(sessionMethod(token([{ method: "invite", timestamp: 5 }]))).toBe("invite");
    expect(sessionMethod("garbage")).toBeNull();
    expect(sessionMethod(null)).toBeNull();
  });
  it("limits repeated tries per person", () => {
    const key = `t-${Math.random()}`;
    expect([1, 2, 3].map(() => allow(key, 2, 60_000))).toEqual([true, true, false]);
  });
});

describe("photo uploads", () => {
  it("HEIC is refused with plain instructions", () => {
    const r = checkPhotoFile({ type: "image/heic", size: 10 });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/iPhone/);
  });
});

describe("job errors people see", () => {
  it("keeps our own plain messages and hides technical ones", async () => {
    const { jobErrorForPeople } = await import("@/lib/video/job-errors");
    expect(jobErrorForPeople("A photo in this video is in Apple's HEIC format, which videos can't use. Replace it with a JPG.")).toMatch(/HEIC/);
    expect(jobErrorForPeople("FableCut stopped while starting:\n[chrome] crashpad … SIGTRAP")).toMatch(/^Something went wrong/);
    expect(jobErrorForPeople("AI request failed (429): rate limit reached")).toMatch(/busy or out of credit/);
    expect(jobErrorForPeople("The AI clip stopped responding too many times")).toMatch(/stopped responding/);
    expect(jobErrorForPeople(null)).toMatch(/^Something went wrong/);
  });
});
