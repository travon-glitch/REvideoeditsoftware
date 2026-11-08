/* The server flow of AI Camera Control, with the database and Claude replaced by fakes. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const updates: Record<string, unknown>[] = [];
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => ({ update: (v: Record<string, unknown>) => ({ eq: async () => { updates.push(v); return {}; } }) }) }),
}));
vi.mock("@/lib/director/run", () => ({ claudeForOrg: async () => null }));

const { interpretCameraPrompt } = await import("./ai-camera-store");

const PHOTO = { id: "p1", listing_id: "l1", kind: "photo", storage_path: "o/l1/p1.jpg", thumbnail_path: "o/l1/p1-thumb.jpg", mime_type: "image/jpeg", size_bytes: 1000, width: 1920, height: 1080 };
function fakeDb(opts: { photo?: unknown; rpcError?: string }) {
  const rpc = vi.fn(async () => (opts.rpcError ? { data: null, error: { message: opts.rpcError } } : { data: { id: "ev1", model: "claude-sonnet-5-5" }, error: null }));
  const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: opts.photo ?? null }) };
  return {
    rpc,
    from: () => q,
    storage: { from: () => ({ download: async () => ({ data: new Blob([new Uint8Array([1, 2, 3])]) }) }) },
  } as unknown as Parameters<typeof interpretCameraPrompt>[0];
}
const ctx = { organization: { id: "o1" }, userId: "u1" } as unknown as Parameters<typeof interpretCameraPrompt>[1];
const input = { assetId: "p1", prompt: "Move slowly from left to right while showing the entire house.", aspect: "9:16" as const, duration: 5, preserveEntireImage: true, current: null };
const answer = {
  movement: "move_right", framing: "contain", preserveEntireImage: true, duration: 7, intensity: "gentle", aspectRatio: "9:16", background: "blur",
  easing: "easeInOut", feel: "gimbal", focus: null, suggestedMethod: "standard", explanation: "Glides left to right.", conflicts: [],
};
const claude = vi.fn(async () => ({
  model: "claude-sonnet-5-5", stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(answer) }],
  usage: { input_tokens: 2000, output_tokens: 300, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
}));

beforeEach(() => { updates.length = 0; claude.mockClear(); });

describe("interpretCameraPrompt", () => {
  it("uses Claude after the database allows it, sends the photo, and records the cost", async () => {
    const db = fakeDb({ photo: PHOTO });
    const r = await interpretCameraPrompt(db, ctx, input, { call: claude as never });
    expect(r.ok && r.value.source).toBe("claude");
    expect((db.rpc as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual(["start_camera_prompt", { p_listing: "l1" }]);
    const req = (claude.mock.calls[0] as unknown as [{ model: string; messages: { content: { type: string }[] }[] }])[0];
    expect(req.model).toBe("claude-sonnet-5-5");
    expect(req.messages[0]!.content[0]!.type).toBe("image");
    expect(updates[0]).toMatchObject({ status: "succeeded" });
    expect(Number(updates[0]!.cost_cents)).toBeGreaterThan(0);
    expect(r.ok && r.value.spec.fit).toBe("contain");
  });

  it("falls back to basic understanding (and says why) when the database refuses AI", async () => {
    const r = await interpretCameraPrompt(fakeDb({ photo: PHOTO, rpcError: "AI isn't switched on for your account" }), ctx, input, { call: claude as never });
    expect(claude).not.toHaveBeenCalled();
    expect(r.ok && r.value.source).toBe("basic");
    expect(r.ok && r.value.notes[0]).toMatch(/AI isn't switched on for your account/);
    expect(r.ok && r.value.instructions.movement).toBe("move_right");
  });

  it("without a Claude key, answers with basic understanding", async () => {
    const r = await interpretCameraPrompt(fakeDb({ photo: PHOTO }), ctx, input, { call: null });
    expect(r.ok && r.value.source).toBe("basic");
    expect(r.ok && r.value.notes[0]).toMatch(/Claude isn't connected/);
  });

  it("a photo the person can't see (other company, other listing) is not found, and Claude is never called", async () => {
    const r = await interpretCameraPrompt(fakeDb({ photo: null }), ctx, input, { call: claude as never });
    expect(r).toEqual({ ok: false, status: 404, message: "We couldn't find that photo." });
    expect(claude).not.toHaveBeenCalled();
  });

  it("a bad answer from Claude is logged as failed and basic understanding is used", async () => {
    claude.mockResolvedValueOnce({ model: "x", stop_reason: "end_turn", content: [{ type: "text", text: "{}" }], usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } });
    const r = await interpretCameraPrompt(fakeDb({ photo: PHOTO }), ctx, input, { call: claude as never });
    expect(updates[0]).toMatchObject({ status: "failed" });
    expect(r.ok && r.value.source).toBe("basic");
  });
});
