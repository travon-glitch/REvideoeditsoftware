/*
 * STAGE 9 (database layer): AI Director — settings, secret key protection, run limits, spending ceiling, cost records.
 */
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { company, freshDatabase, rejects, server, signedIn, type Session } from "./helpers";

let db: PGlite;
let org = "";
let ids: Record<string, string> = {};
let alice: Session, bob: Session, vera: Session, adam: Session, owner: Session, worker: Session;
let listing = "";

const start = (as: Session, l = listing) => as((tx) => tx.query<{ id: string; model: string }>(`select (r).id, (r).model from (select public.start_director_run($1, 'luxury', 20) r) s`, [l]));
const settings = (sql: string) => worker((tx) => tx.query(`update public.organization_settings set ${sql} where organization_id = $1`, [org]));

beforeAll(async () => {
  db = await freshDatabase();
  const c = await company(db, { adam: "admin", alice: "editor", bob: "editor", vera: "viewer" });
  org = c.org; ids = c.ids;
  alice = signedIn(db, ids.alice!); bob = signedIn(db, ids.bob!); vera = signedIn(db, ids.vera!); adam = signedIn(db, ids.adam!); owner = signedIn(db, ids.superAdmin!);
  worker = server(db);
  listing = (await alice((tx) => tx.query<{ id: string }>(`insert into public.listings (organization_id, created_by) values ($1, auth.uid()) returning id`, [org]))).rows[0]!.id;
});

describe("Claude API key", () => {
  it("is stored only by the server and can't be read back by anyone", async () => {
    await worker((tx) => tx.query(`insert into public.organization_secrets (organization_id, name, ciphertext, last4) values ($1, 'anthropic_api_key', 'v1:ciphertext-not-the-key-000', 'ab12')`, [org]));
    for (const as of [owner, adam, alice]) await rejects(as((tx) => tx.query(`select ciphertext from public.organization_secrets`)), /permission denied/);
    await rejects(owner((tx) => tx.query(`insert into public.organization_secrets (organization_id, name, ciphertext, last4) values ($1, 'anthropic_api_key', 'v1:xxxxxxxxxxxxxxxxxxxxxx', 'zz99')`, [org])), /permission denied/);
    const st = await owner((tx) => tx.query<{ s: { configured: boolean; last4: string } }>(`select public.claude_key_status() s`));
    expect(st.rows[0]!.s).toMatchObject({ configured: true, last4: "ab12" });
    expect((await alice((tx) => tx.query<{ s: unknown }>(`select public.claude_key_status() s`))).rows[0]!.s).toBeNull();
  });
  it("only the Super Admin changes the Claude settings", async () => {
    expect((await adam((tx) => tx.query(`update public.organization_settings set claude_enabled = true returning 1`))).rows).toHaveLength(0);
    expect((await owner((tx) => tx.query(`update public.organization_settings set claude_enabled = false, claude_model = 'claude-sonnet-5-5' where organization_id = $1 returning 1`, [org]))).rows).toHaveLength(1);
    await rejects(owner((tx) => tx.query(`update public.organization_settings set claude_model = 'gpt-4' where organization_id = $1`, [org])));
  });
});

describe("starting a Director run", () => {
  it("needs the Director switched on, AI access and edit access to the listing", async () => {
    await rejects(start(alice), /isn't switched on for your company/);
    await settings("claude_enabled = true, claude_model = 'claude-opus-5-5'");
    const r = await start(alice);
    expect(r.rows[0]!.model).toBe("claude-opus-5-5");
    await rejects(start(vera), /AI isn't switched on for your account/);
    await rejects(start(bob), /can't make videos from this listing/);
    await rejects(alice((tx) => tx.query(`insert into public.director_runs (organization_id, style, model, photo_count, created_by) values ($1, 'luxury', 'x', 1, auth.uid())`, [org])), /permission denied/);
    await rejects(alice((tx) => tx.query(`update public.director_runs set cost_cents = 0`)), /permission denied/);
  });
  it("enforces the daily per-person and monthly company limits", async () => {
    await settings("claude_daily_runs_per_user = 2");
    await start(alice);
    await rejects(start(alice), /daily AI Director limit is reached \(2 runs\)/);
    await settings("claude_daily_runs_per_user = null, claude_monthly_run_limit = 3");
    await start(alice);
    await rejects(start(alice), /monthly AI Director limit is reached \(3 runs\)/);
    await settings("claude_monthly_run_limit = null");
  });
  it("records cost (server only) and stops at the AI spending ceiling, which also covers paid AI jobs", async () => {
    const { rows: [run] } = await start(alice);
    await worker((tx) => tx.query(`update public.director_runs set status = 'succeeded', cost_cents = 412.5, usage = '{"input_tokens":30000}' where id = $1`, [run!.id]));
    const mine = await alice((tx) => tx.query<{ cost_cents: string }>(`select cost_cents from public.director_runs where id = $1`, [run!.id]));
    expect(Number(mine.rows[0]!.cost_cents)).toBe(412.5);
    await settings("monthly_ai_budget_cents = 400");
    await rejects(start(alice), /Monthly AI spending limit reached/);
    await settings("monthly_ai_budget_cents = 100000");
    expect((await start(alice)).rows).toHaveLength(1);
    // admins see everyone's runs (cost tracking); other editors don't
    expect(Number((await adam((tx) => tx.query<{ n: string }>(`select count(*) n from public.director_runs`))).rows[0]!.n)).toBeGreaterThan(0);
    expect((await bob((tx) => tx.query(`select id from public.director_runs`))).rows).toHaveLength(0);
  });
});
