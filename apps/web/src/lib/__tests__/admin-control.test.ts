/* Stage 13: admin control center rules, display helpers, and server-side authorization of every admin action. */
import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  activityLabel, aiControlsSchema, formatBytes, formatCents, librarySearchSchema, maskSecret, percentOf, queueLevel, quickUserSchema,
  safeSearch, workerLevel,
} from "@/lib/admin/control";

// ── the signed-in person for the server-action tests ──
const session = vi.hoisted(() => ({ role: "editor" as string, rpc: vi.fn(), from: vi.fn(), admin: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), notFound: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: session.rpc, from: session.from }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => { session.admin(); throw new Error("the service-role client must not be reached"); } }));
vi.mock("@/lib/auth/session", async () => {
  const { can } = await import("@/lib/auth/roles");
  return {
    authorizeAction: async (permission: Parameters<typeof can>[1]) => can(session.role as never, permission)
      ? { ok: true, ctx: { userId: "u1", profile: { role: session.role }, organization: { id: "o1" } } }
      : { ok: false, result: { ok: false, message: "You don't have permission to do that." } },
  };
});

describe("AI controls form", () => {
  const base = { ai_enabled: "on", ai_voiceover_enabled: "on", video_ai_model: "kling-v2.1-standard-i2v", video_ai_clip_cost_dollars: "0.45", monthly_ai_budget_dollars: "$1,000", daily_ai_budget_dollars: "50", ai_budget_alert_percent: "80" };
  it("reads switches, dollars and limits", () => {
    const r = aiControlsSchema.parse(base);
    expect(r).toMatchObject({ ai_enabled: true, ai_depth_motion_enabled: false, ai_voiceover_enabled: true, ai_captions_enabled: false,
      video_ai_clip_cost_dollars: 45, monthly_ai_budget_dollars: 100000, daily_ai_budget_dollars: 5000, ai_budget_alert_percent: 80, default_max_ai_generations_per_month: null });
  });
  it("refuses a daily ceiling above the monthly one, bad model ids and bad percentages", () => {
    expect(aiControlsSchema.safeParse({ ...base, daily_ai_budget_dollars: "2000" }).success).toBe(false);
    expect(aiControlsSchema.safeParse({ ...base, video_ai_model: "../../etc" }).success).toBe(false);
    expect(aiControlsSchema.safeParse({ ...base, ai_budget_alert_percent: "5" }).success).toBe(false);
    expect(aiControlsSchema.safeParse({ ...base, monthly_ai_budget_dollars: "-3" }).success).toBe(false);
  });
});

describe("quick user changes", () => {
  it("accepts one change at a time, never Super Admin, never unknown fields", () => {
    expect(quickUserSchema.parse({ max_videos_per_month: "" })).toEqual({ max_videos_per_month: null });
    expect(quickUserSchema.parse({ max_ai_generations_per_month: 12 })).toEqual({ max_ai_generations_per_month: 12 });
    expect(quickUserSchema.safeParse({ role: "super_admin" }).success).toBe(false);
    expect(quickUserSchema.safeParse({ status: "active" }).success).toBe(false);
    expect(quickUserSchema.safeParse({ max_videos_per_month: 1.5 }).success).toBe(false);
  });
});

describe("library search", () => {
  it("drops bad filters instead of passing them to the database", () => {
    expect(librarySearchSchema.parse({ owner: "not-a-uuid", from: "2026-13", page: "-4", show: "deleted" })).toMatchObject({ owner: undefined, from: undefined, page: 1, show: "active" });
    expect(safeSearch("12 Oak),title.eq.x%_*")).toBe("12 Oak title eq x");
  });
});

describe("display helpers", () => {
  it("formats bytes, money, percentages and secrets", () => {
    expect([formatBytes(512), formatBytes(2300000), formatBytes(5 * 1024 ** 3)]).toEqual(["512 B", "2.2 MB", "5.0 GB"]);
    expect(formatCents(123456)).toBe("$1,234.56");
    expect([percentOf(50, 200), percentOf(300, 200), percentOf(1, null), percentOf(0, 0)]).toEqual([25, 100, null, 100]);
    expect(maskSecret("abcd")).toBe("•••• •••• abcd");
    expect(maskSecret(null)).toBe("Not set");
    expect(activityLabel("project.reassigned")).toBe("Reassigned a video");
  });
  it("judges workers and queues", () => {
    expect([workerLevel(20), workerLevel(200), workerLevel(4000)]).toEqual(["ok", "warn", "down"]);
    const q = { queued: 0, stuck: 0, oldest_queued_seconds: 0, failed_24h: 0 };
    expect(queueLevel(q, 0)).toBe("ok");
    expect(queueLevel({ ...q, queued: 2 }, 0)).toBe("down");
    expect(queueLevel({ ...q, queued: 2, oldest_queued_seconds: 900 }, 1)).toBe("warn");
    expect(queueLevel({ ...q, stuck: 1 }, 3)).toBe("down");
  });
});

describe("provider keys saved in the admin panel can be used by the AI worker", () => {
  it("the web app's encryption and the worker's decryption match", async () => {
    process.env.LVS_SECRETS_KEY = randomBytes(32).toString("base64");
    const { encryptSecret } = await import("@/lib/secrets");
    const { decryptSecret, secretsKey } = await import("../../../../../packages/ai-motion/src/secrets");
    const blob = encryptSecret("muapi-test-key-1234567890");
    expect(blob).not.toContain("1234567890");
    expect(decryptSecret(blob, secretsKey()!)).toBe("muapi-test-key-1234567890");
    expect(() => decryptSecret(blob, randomBytes(32))).toThrow();
  });
});

describe("admin actions are authorized on the server", () => {
  beforeEach(() => { session.rpc.mockReset(); session.from.mockReset(); session.admin.mockReset(); });
  const uuid = "6f1c2b0e-8a7d-4c1e-9b8a-3d2f1e0c9b7a";

  it("ordinary employees are refused before anything reaches the database", async () => {
    const a = await import("@/app/(app)/admin/control-actions");
    const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
    for (const role of ["editor", "viewer"]) {
      session.role = role;
      const results = await Promise.all([
        a.quickUpdateUser(uuid, { max_videos_per_month: null }),
        a.quickUpdateUser(uuid, { role: "admin" }),
        a.quickSetStatus(uuid, "suspended"),
        a.saveAiControls(null, fd({ ai_enabled: "on", video_ai_model: "kling-v2.1-standard-i2v", ai_budget_alert_percent: "80" })),
        a.saveProviderKey(null, fd({ provider: "muapi", api_key: "x".repeat(40) })),
        a.removeProviderKey("muapi"),
        a.setVideoArchived(uuid, true),
        a.reassignVideo(uuid, uuid),
        a.setVideoAccess(uuid, true, true),
        a.deleteVideo(uuid, "anything"),
      ]);
      for (const r of results) expect(r).toEqual({ ok: false, message: "You don't have permission to do that." });
    }
    expect(session.rpc).not.toHaveBeenCalled();
    expect(session.from).not.toHaveBeenCalled();
    expect(session.admin).not.toHaveBeenCalled();
  });

  it("administrators can't reach Super Admin actions", async () => {
    const a = await import("@/app/(app)/admin/control-actions");
    session.role = "admin";
    const f = new FormData(); f.set("provider", "muapi"); f.set("api_key", "y".repeat(40));
    for (const r of await Promise.all([a.saveProviderKey(null, f), a.removeProviderKey("muapi"), a.setVideoArchived(uuid, true), a.reassignVideo(uuid, uuid), a.deleteVideo(uuid, "t")])) {
      expect(r.ok).toBe(false);
    }
    expect(session.admin).not.toHaveBeenCalled();
  });

  it("a provider key is only stored after the database confirms the Super Admin", async () => {
    const a = await import("@/app/(app)/admin/control-actions");
    session.role = "super_admin";
    process.env.LVS_SECRETS_KEY = randomBytes(32).toString("base64");
    session.rpc.mockResolvedValue({ error: { message: "Only the Super Admin can do this" } });
    const f = new FormData(); f.set("provider", "muapi"); f.set("api_key", "z".repeat(40));
    expect(await a.saveProviderKey(null, f)).toEqual({ ok: false, message: "Only the Super Admin can save provider keys." });
    expect(session.rpc).toHaveBeenCalledWith("record_admin_action", { p_action: "provider.key_set", p_meta: { provider: "muapi", last4: "zzzz" } });
    expect(session.admin).not.toHaveBeenCalled();
  });

  it("deleting removes only files in the company's own folder", async () => {
    const a = await import("@/app/(app)/admin/control-actions");
    session.role = "super_admin";
    session.rpc.mockResolvedValue({ data: [{ bucket: "video-exports", path: "o1/projects/p/a.mp4" }, { bucket: "video-exports", path: "other/projects/p/b.mp4" }, { bucket: "project-media", path: "o1/../x" }], error: null });
    const removed: string[][] = [];
    const admin = await import("@/lib/supabase/admin");
    vi.spyOn(admin, "createAdminClient").mockReturnValue({ storage: { from: () => ({ remove: async (p: string[]) => { removed.push(p); return { error: null }; } }) } } as never);
    const r = await a.deleteVideo(uuid, "12 Oak Lane tour");
    expect(r.ok).toBe(true);
    expect(removed).toEqual([["o1/projects/p/a.mp4"]]);
  });
});
