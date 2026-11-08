/*
 * AI Camera Control (database layer): who may ask Claude for a camera move, the spending ceilings,
 * and that the cost is written only by the server and counts toward the company's AI spending.
 */
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { company, freshDatabase, rejects, server, signedIn, type Session } from "./helpers";

let db: PGlite;
let org = "";
let alice: Session, bob: Session, vera: Session, owner: Session, worker: Session;
let listing = "", otherListing = "";

const start = (as: Session, l: string) => as((tx) => tx.query<{ r: { id: string; model: string } }>(`select public.start_camera_prompt($1) r`, [l]));
const settings = (sql: string) => worker((tx) => tx.query(`update public.organization_settings set ${sql} where organization_id = $1`, [org]));

beforeAll(async () => {
  db = await freshDatabase();
  const c = await company(db, { adam: "admin", alice: "editor", bob: "editor", vera: "viewer" });
  org = c.org;
  alice = signedIn(db, c.ids.alice!); bob = signedIn(db, c.ids.bob!); vera = signedIn(db, c.ids.vera!); owner = signedIn(db, c.ids.superAdmin!);
  worker = server(db);
  listing = (await alice((tx) => tx.query<{ id: string }>(`insert into public.listings (organization_id, created_by) values ($1, auth.uid()) returning id`, [org]))).rows[0]!.id;
  otherListing = (await bob((tx) => tx.query<{ id: string }>(`insert into public.listings (organization_id, created_by) values ($1, auth.uid()) returning id`, [org]))).rows[0]!.id;
});

describe("starting an AI camera request", () => {
  it("needs Claude switched on, AI access and edit access to the photo's listing", async () => {
    await rejects(start(alice, listing), /Claude isn't switched on for your company/);
    await settings("claude_enabled = true, claude_model = 'claude-sonnet-5-5'");
    const r = await start(alice, listing);
    expect(r.rows[0]!.r.model).toBe("claude-sonnet-5-5");
    await rejects(start(vera, listing), /AI isn't switched on for your account/);
    // another person's listing (unauthorized photos) is refused
    await rejects(start(alice, otherListing), /can't edit this listing/);
    await rejects(start(alice, "00000000-0000-0000-0000-000000000000"), /can't edit this listing/);
  });

  it("can't be logged, finished or priced by the person themselves", async () => {
    await rejects(alice((tx) => tx.query(`insert into public.ai_usage_events (organization_id, user_id, kind, model) values ($1, auth.uid(), 'camera_prompt', 'x')`, [org])), /permission denied/);
    await rejects(alice((tx) => tx.query(`update public.ai_usage_events set cost_cents = 0`)), /permission denied/);
  });

  it("counts its cost toward the AI spending ceilings and stops at them", async () => {
    const id = (await start(alice, listing)).rows[0]!.r.id;
    // the server records what the Claude call cost
    await worker((tx) => tx.query(`update public.ai_usage_events set status = 'succeeded', cost_cents = 150 where id = $1`, [id]));
    const spent = await worker((tx) => tx.query<{ m: string; d: string }>(`select private.ai_spent_this_month($1) m, private.ai_spent_today($1) d`, [org]));
    expect(Number(spent.rows[0]!.m)).toBeGreaterThanOrEqual(150);
    expect(Number(spent.rows[0]!.d)).toBeGreaterThanOrEqual(150);
    await settings("daily_ai_budget_cents = 100");
    await rejects(start(alice, listing), /Daily AI spending limit reached/);
    await settings("daily_ai_budget_cents = null");
    await start(alice, listing);
  });

  it("shows in the Super Admin's AI usage log with its cost and listing", async () => {
    const log = await owner((tx) => tx.query<{ kind: string; cost_cents: string; listing_id: string }>(`select * from public.admin_ai_usage('camera_prompt')`));
    expect(log.rows.length).toBeGreaterThanOrEqual(3);
    expect(log.rows.some((r) => Number(r.cost_cents) === 150 && r.listing_id === listing)).toBe(true);
    await rejects(alice((tx) => tx.query(`select * from public.admin_ai_usage('camera_prompt')`)));
  });
});
