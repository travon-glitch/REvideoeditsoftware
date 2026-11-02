import { describe, expect, it } from "vitest";
import { generateSetupCode, hashSetupCode, normalizeSetupCode, setupCodeMatches, slugify } from "@/lib/bootstrap";

describe("setup codes", () => {
  it("are long, readable and unique", () => {
    const a = generateSetupCode();
    const b = generateSetupCode();
    expect(a).toMatch(/^([A-HJ-NP-Z2-9]{5}-){5}[A-HJ-NP-Z2-9]{5}$/);
    expect(a).not.toBe(b);
  });

  it("accept the way people type them", () => {
    const code = generateSetupCode();
    const typed = ` ${code.toLowerCase().replace(/-/g, " ")} `;
    expect(normalizeSetupCode(typed)).toBe(code);
    expect(hashSetupCode(typed)).toBe(hashSetupCode(code));
    expect(setupCodeMatches(typed, hashSetupCode(code))).toBe(true);
  });

  it("reject wrong or malformed codes", () => {
    const code = generateSetupCode();
    expect(setupCodeMatches(generateSetupCode(), hashSetupCode(code))).toBe(false);
    expect(normalizeSetupCode("too-short")).toBeNull();
    expect(normalizeSetupCode("O".repeat(30))).toBeNull(); // ambiguous letters are not in the alphabet
    expect(() => hashSetupCode("nope")).toThrow();
    expect(setupCodeMatches(code, "not-a-hash")).toBe(false);
  });

  it("store only a SHA-256 hex hash", () => {
    expect(hashSetupCode(generateSetupCode())).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("slugify", () => {
  it("makes database-safe company slugs", () => {
    expect(slugify("Acme Realty, LLC")).toBe("acme-realty-llc");
    expect(slugify("Café Homes")).toBe("cafe-homes");
    expect(slugify("!")).toBe("company-hq");
    expect(slugify("x".repeat(80))).toHaveLength(48);
    for (const s of ["Acme Realty, LLC", "A", "--x--", "日本"]) {
      expect(slugify(s)).toMatch(/^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/);
    }
  });
});
