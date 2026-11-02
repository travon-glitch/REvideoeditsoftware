/* Shared harness: real migrations on PGlite, requests simulated like Supabase/PostgREST. */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { expect } from "vitest";

const MIGRATIONS = join(__dirname, "..", "..", "..", "..", "supabase", "migrations");

export async function freshDatabase(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(readFileSync(join(__dirname, "supabase-stub.sql"), "utf8"));
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(join(MIGRATIONS, f), "utf8"));
  }
  return db;
}

export type Session = <T>(fn: (tx: Transaction) => Promise<T>) => Promise<T>;

/** One request as a signed-in person (a fresh transaction = a fresh request). */
export function signedIn(db: PGlite, userId: string): Session {
  return (fn) => db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId]);
    await tx.exec(`set local role authenticated`);
    return fn(tx);
  });
}

export function server(db: PGlite): Session {
  return (fn) => db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claim.sub', '', true)`);
    await tx.exec(`set local role service_role`);
    return fn(tx);
  });
}

export async function rejects(p: Promise<unknown>, pattern?: RegExp) {
  let error: unknown = null;
  try { await p; } catch (e) { error = e; }
  expect(error, "expected the database to refuse").not.toBeNull();
  if (pattern) expect(String((error as Error).message)).toMatch(pattern);
}

/** Bootstraps a company + Super Admin, then creates the given people through the admin backend function. */
export async function company(db: PGlite, people: Record<string, "admin" | "editor" | "viewer">) {
  const ids: Record<string, string> = { superAdmin: randomUUID() };
  const code = createHash("sha256").update(randomUUID()).digest("hex");
  await db.query(`insert into auth.users (id, email) values ($1, 'owner@acme.test')`, [ids.superAdmin]);
  await server(db)((tx) => tx.query(`select public.bootstrap_create_token($1, 60)`, [code]));
  const org = (await server(db)((tx) => tx.query<{ o: string }>(
    `select public.bootstrap_complete($1, $2, 'owner@acme.test', 'Olivia Owner', 'Acme Realty', 'acme') o`, [code, ids.superAdmin]))).rows[0]!.o;

  // admins first, so they can create everyone else
  const order = Object.entries(people).sort(([, a], [, b]) => (a === "admin" ? -1 : 0) - (b === "admin" ? -1 : 0));
  for (const [name, role] of order) {
    const id = randomUUID();
    ids[name] = id;
    const actor = role === "admin" ? ids.superAdmin! : (Object.entries(people).find(([, r]) => r === "admin")?.[0] ? ids[Object.entries(people).find(([, r]) => r === "admin")![0]]! : ids.superAdmin!);
    await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, `${name}@acme.test`]);
    await server(db)((tx) => tx.query(
      `select public.create_user_profile($1, $2, $3, $4, 'Test', null, $5::public.app_role, true, true, null, null)`,
      [actor, id, `${name}@acme.test`, name, role]));
    await signedIn(db, id)((tx) => tx.query(`select public.activate_self()`));
  }
  return { org, ids };
}
