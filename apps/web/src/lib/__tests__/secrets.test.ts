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
  it("works without LVS_SECRETS_KEY, using a key derived from the service-role key; the AI worker reads it", async () => {
    const k = process.env.LVS_SECRETS_KEY; delete process.env.LVS_SECRETS_KEY;
    const sr = process.env.SUPABASE_SERVICE_ROLE_KEY; process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-" + randomBytes(24).toString("hex");
    const blob = encryptSecret("sk-ant-api03-typed-in-the-panel");
    expect(blob.startsWith("v2s:")).toBe(true);
    expect(decryptSecret(blob)).toBe("sk-ant-api03-typed-in-the-panel");
    const worker = await import("../../../../../packages/ai-motion/src/secrets");
    expect(worker.decryptSecret(blob)).toBe("sk-ant-api03-typed-in-the-panel");
    // keys saved earlier with LVS_SECRETS_KEY keep working when it's set again
    process.env.LVS_SECRETS_KEY = k;
    const v1 = encryptSecret("old-style");
    expect(v1.startsWith("v1:")).toBe(true);
    expect(decryptSecret(blob)).toBe("sk-ant-api03-typed-in-the-panel");
    // with neither key the server refuses to store
    delete process.env.LVS_SECRETS_KEY; delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(() => encryptSecret("x")).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
    process.env.LVS_SECRETS_KEY = k;
    if (sr) process.env.SUPABASE_SERVICE_ROLE_KEY = sr;
  });
});
