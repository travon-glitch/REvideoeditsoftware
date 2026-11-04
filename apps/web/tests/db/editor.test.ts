/* Stage 5 database rules: project music, render queue, and who can export / download. */
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { company, freshDatabase, rejects, server, signedIn, type Session } from "./helpers";

let db: PGlite;
let org = "";
let ids: Record<string, string> = {};
let alice: Session, bob: Session, vera: Session, admin: Session, svc: Session;
let projectA = "";

const doc = { width: 1920, height: 1080, fps: 30, media: [], clips: [{ id: "c1", kind: "text", start: 0, duration: 2, track: "V1" }] };

beforeAll(async () => {
  db = await freshDatabase();
  ({ org, ids } = await company(db, { adam: "admin", alice: "editor", bob: "editor", vera: "viewer" }));
  alice = signedIn(db, ids.alice!); bob = signedIn(db, ids.bob!); vera = signedIn(db, ids.vera!); admin = signedIn(db, ids.adam!);
  svc = server(db);
  projectA = (await alice((tx) => tx.query<{ id: string }>(
    `insert into public.video_projects (organization_id, created_by, title) values ($1, auth.uid(), 'Alice video') returning id`, [org]))).rows[0]!.id;
});

describe("project music", () => {
  const musicPath = () => `${org}/projects/${projectA}/${randomUUID()}.m4a`;

  it("only people who can edit the project may upload and register music", async () => {
    const path = musicPath();
    await alice((tx) => tx.query(`insert into storage.objects (bucket_id, name, owner_id) values ('project-media', $1, auth.uid()::text)`, [path]));
    await alice((tx) => tx.query(
      `insert into public.media_assets (organization_id, project_id, uploaded_by, kind, bucket, storage_path, file_name, mime_type, size_bytes)
       values ($1, $2, auth.uid(), 'audio', 'project-media', $3, 'song.m4a', 'audio/mp4', 1000)`, [org, projectA, path]));
    await rejects(bob((tx) => tx.query(`insert into storage.objects (bucket_id, name, owner_id) values ('project-media', $1, auth.uid()::text)`, [musicPath()])), /row-level security/);
    expect((await bob((tx) => tx.query(`select name from storage.objects where bucket_id = 'project-media'`))).rows).toEqual([]);
    await rejects(alice((tx) => tx.query(
      `insert into public.media_assets (organization_id, project_id, uploaded_by, kind, bucket, storage_path, file_name, mime_type, size_bytes)
       values ($1, $2, auth.uid(), 'audio', 'project-media', $3, 'x.m4a', 'audio/mp4', 1)`, [org, projectA, `${org}/projects/${randomUUID()}/${randomUUID()}.m4a`])), /media_assets_project_folder/);
  });

  it("assigned viewers can hear it but not change it", async () => {
    await admin((tx) => tx.query(`select public.admin_assign_project($1, $2, 'viewer')`, [projectA, ids.vera]));
    expect((await vera((tx) => tx.query(`select name from storage.objects where bucket_id = 'project-media'`))).rows.length).toBe(1);
    await rejects(vera((tx) => tx.query(`insert into storage.objects (bucket_id, name, owner_id) values ('project-media', $1, auth.uid()::text)`, [musicPath()])), /row-level security/);
  });
});

describe("render queue", () => {
  let jobId = "";

  it("renders are queued only by the app server, within size limits; people can't insert them directly", async () => {
    // even the project's owner can't write a render job straight to the database (the server applies branding first)
    for (const who of [alice, bob, vera]) {
      await rejects(who((tx) => tx.query(
        `insert into public.render_jobs (organization_id, project_id, revision, preset, aspect, document, requested_by)
         values ($1, $2, 1, 'master-1080p', '9:16', $3, auth.uid())`, [org, projectA, JSON.stringify(doc)])), /permission denied/);
    }
    jobId = (await svc((tx) => tx.query<{ id: string }>(
      `insert into public.render_jobs (organization_id, project_id, revision, preset, aspect, document, requested_by)
       values ($1, $2, 1, 'master-1080p', '9:16', $3, $4) returning id`, [org, projectA, JSON.stringify(doc), ids.alice]))).rows[0]!.id;
    await rejects(svc((tx) => tx.query(
      `insert into public.render_jobs (organization_id, project_id, revision, preset, aspect, document, requested_by)
       values ($1, $2, 1, 'x', '5:4', $3, $4)`, [org, projectA, JSON.stringify(doc), ids.alice])), /check constraint/);
    // size limits hold for every render, whoever queues it
    await rejects(svc((tx) => tx.query(
      `insert into public.render_jobs (organization_id, project_id, revision, preset, aspect, document, requested_by)
       values ($1, $2, 1, 'x', '16:9', $3, $4)`, [org, projectA, JSON.stringify({ ...doc, width: 4096, height: 4096 }), ids.alice])), /too large/);
    await rejects(svc((tx) => tx.query(
      `insert into public.render_jobs (organization_id, project_id, revision, preset, aspect, document, requested_by)
       values ($1, $2, 1, 'x', '16:9', $3, $4)`, [org, projectA, JSON.stringify({ ...doc, fps: 120 }), ids.alice])), /too large/);
    await rejects(svc((tx) => tx.query(
      `insert into public.render_jobs (organization_id, project_id, revision, preset, aspect, document, requested_by)
       values ($1, $2, 1, 'x', '16:9', $3, $4)`, [org, projectA, JSON.stringify({ ...doc, clips: [{ id: "c", kind: "text", start: 0, duration: 900, track: "V1" }] }), ids.alice])), /too long/);
  });

  it("only the worker (service role) can claim jobs, oldest first, one at a time", async () => {
    await rejects(alice((tx) => tx.query(`select public.claim_render_job('me')`)), /permission denied/);
    const claimed = await svc((tx) => tx.query<{ id: string; status: string; attempts: number }>(`select id, status, attempts from public.claim_render_job('worker-1')`));
    expect(claimed.rows[0]).toMatchObject({ id: jobId, status: "running", attempts: 1 });
    const none = await svc((tx) => tx.query<{ id: string | null }>(`select id from public.claim_render_job('worker-2')`));
    expect(none.rows[0]?.id ?? null).toBeNull();
    await rejects(alice((tx) => tx.query(`update public.render_jobs set status = 'succeeded'`)), /permission denied/);
  });

  it("stuck jobs go back to the queue, then fail after 3 attempts", async () => {
    await db.query(`update public.render_jobs set started_at = now() - interval '1 hour' where id = $1`, [jobId]);
    await svc((tx) => tx.query(`select public.requeue_stale_render_jobs(15)`));
    expect((await db.query<{ status: string }>(`select status from public.render_jobs where id = $1`, [jobId])).rows[0]!.status).toBe("queued");
    await db.query(`update public.render_jobs set status = 'running', attempts = 3, started_at = now() - interval '1 hour' where id = $1`, [jobId]);
    await svc((tx) => tx.query(`select public.requeue_stale_render_jobs(15)`));
    expect((await db.query<{ status: string }>(`select status from public.render_jobs where id = $1`, [jobId])).rows[0]!.status).toBe("failed");
  });

  it("a finished render is recorded, marks the project complete, and is audited", async () => {
    const id = (await svc((tx) => tx.query<{ id: string }>(
      `insert into public.render_jobs (organization_id, project_id, revision, preset, aspect, document, requested_by)
       values ($1, $2, 1, 'master-1080p', '16:9', $3, $4) returning id`, [org, projectA, JSON.stringify(doc), ids.alice]))).rows[0]!.id;
    await svc((tx) => tx.query(`select public.claim_render_job('worker-1')`));
    const path = `${org}/projects/${projectA}/${id}.mp4`;
    await svc(async (tx) => {
      await tx.query(`insert into storage.objects (bucket_id, name) values ('video-exports', $1)`, [path]);
      await tx.query(`update public.render_jobs set status = 'succeeded', output_path = $2, progress = 1 where id = $1`, [id, path]);
    });
    expect((await alice((tx) => tx.query<{ status: string }>(`select status from public.video_projects where id = $1`, [projectA]))).rows[0]!.status).toBe("completed");
    const audit = await admin((tx) => tx.query<{ action: string }>(`select action from public.audit_log where target_id = $1`, [projectA]));
    expect(audit.rows.map((a) => a.action)).toContain("render.succeeded");
  });

  it("downloads need project access AND download permission", async () => {
    const files = (s: Session) => s((tx) => tx.query(`select name from storage.objects where bucket_id = 'video-exports'`)).then((r) => r.rows.length);
    expect(await files(alice)).toBe(1);
    expect(await files(bob)).toBe(0);                 // not his project
    await admin((tx) => tx.query(`select public.admin_update_user($1, 'vera', 'Test', null, 'viewer', false, false, null, null)`, [ids.vera]));
    expect(await files(vera)).toBe(0);                // assigned, but downloads are off
    await admin((tx) => tx.query(`select public.admin_update_user($1, 'vera', 'Test', null, 'viewer', true, false, null, null)`, [ids.vera]));
    expect(await files(vera)).toBe(1);
  });
});
