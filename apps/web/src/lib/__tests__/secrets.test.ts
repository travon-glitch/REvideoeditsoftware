import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "@/lib/secrets";

beforeAll(() => { process.env.LVS_SECRETS_KEY = randomBytes(32).toString("base64"); });

describe("secret encryption", () => {
  it("round-trips, never stores the plain key, and detects tampering", () => {
    const blob = encryptSecret("sk-ant-api03-example-key-ab12");
    expect(blob).not.toContain("sk-ant");
    expect(decryptSecret(blob)).toBe("sk-ant-api03-example-key-ab12");
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
    const parts = blob.split(":"); parts[3] = Buffer.from("tampered").toString("base64");
    expect(() => decryptSecret(parts.join(":"))).toThrow();
  });
  it("needs the server key", () => {
    const k = process.env.LVS_SECRETS_KEY; delete process.env.LVS_SECRETS_KEY;
    expect(() => encryptSecret("x")).toThrow(/LVS_SECRETS_KEY/);
    process.env.LVS_SECRETS_KEY = k;
  });
});
