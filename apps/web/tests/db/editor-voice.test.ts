/* Stage 12 database rules: narration audio in the project's folder, the authorisation record, portrait 4:5 renders. */
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { company, freshDatabase, rejects, server, signedIn, type Session } from "./helpers";

let db: PGlite;
let org = "", project = "";
let ids: Record<string, string> = {};
let alice: Session, bob: Session;
const doc = { width: 1080, height: 1350, fps: 30, media: [], clips: [{ id: "c1", kind: "text", start: 0, duration: 2, track: "V1" }] };

beforeAll(async () => {
  db = await freshDatabase();
  ({ org, ids } = await company(db, { adam: "admin", alice: "editor", bob: "editor" }));
  alice = signedIn(db, ids.alice!); bob = signedIn(db, ids.bob!);
  project = (await alice((tx) => tx.query<{ id: string }>(`insert into public.video_projects (organization_id, created_by, title) values ($1, auth.uid(), 'Narrated') returning id`, [org]))).rows[0]!.id;
});

describe("Stage 12", () => {
  it("narration is stored like project audio and its 'authorised' confirmation is logged for its uploader only", async () => {
    const path = `${org}/projects/${project}/${randomUUID()}.m4a`;
    await alice((tx) => tx.query(`insert into storage.objects (bucket_id, name, owner_id) values ('project-media', $1, auth.uid()::text)`, [path]));
    const asset = (await alice((tx) => tx.query<{ id: string }>(`insert into public.media_assets (organization_id, project_id, uploaded_by, kind, bucket, storage_path, file_name, mime_type, size_bytes, duration_seconds)
      values ($1, $2, auth.uid(), 'audio', 'project-media', $3, 'Narration (Heart).m4a', 'audio/mp4', 1000, 21.4) returning id`, [org, project, path]))).rows[0]!.id;
    await rejects(bob((tx) => tx.query(`select public.record_audio_authorization($1, 'music')`, [asset])), /Audio not found/);
    await alice((tx) => tx.query(`select public.record_audio_authorization($1, 'narration')`, [asset]));
    const log = await db.query<{ action: string; actor_id: string }>(`select action, actor_id from public.audit_log where target_id = $1`, [asset]);
    expect(log.rows).toEqual([{ action: "narration.upload", actor_id: ids.alice }]);
  });
  it("portrait 4:5 renders can be queued; other shapes can't", async () => {
    const svc = server(db);
    await svc((tx) => tx.query(`insert into public.render_jobs (organization_id, project_id, revision, preset, aspect, document, requested_by) values ($1, $2, 1, 'master-1080p', '4:5', $3, $4)`, [org, project, JSON.stringify(doc), ids.alice]));
    await rejects(svc((tx) => tx.query(`insert into public.render_jobs (organization_id, project_id, revision, preset, aspect, document, requested_by) values ($1, $2, 1, 'master-1080p', '3:2', $3, $4)`, [org, project, JSON.stringify(doc), ids.alice])), /check constraint/);
  });
});
