"use client";
import { useRef, useState, useTransition } from "react";
import { Archive, ArchiveRestore, Download, Lock, LockOpen, Play, Shield, ShieldOff, Trash2, UserRoundCog } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { deleteVideo, reassignVideo, setVideoAccess, setVideoArchived } from "../control-actions";

export interface LibraryItem {
  id: string; title: string; ownerId: string | null; restricted: boolean; locked: boolean; archived: boolean;
  previewUrl: string | null; downloadHref: string | null;
}

/** Preview, download, reassign, restrict/lock, archive and delete one video. Every action is re-checked on the server. */
export function LibraryActions({ item, people, superAdmin }: { item: LibraryItem; people: { id: string; name: string }[]; superAdmin: boolean }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const preview = useRef<HTMLDialogElement>(null);
  const del = useRef<HTMLDialogElement>(null);
  const [owner, setOwner] = useState(item.ownerId ?? "");
  const [confirm, setConfirm] = useState("");
  const run = (fn: () => Promise<{ ok: boolean; message?: string }>, after?: () => void) => start(async () => {
    const r = await fn();
    setMsg({ ok: r.ok, text: r.message ?? (r.ok ? "Done." : "That didn't work.") });
    if (r.ok) after?.();
  });

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap justify-end gap-1.5">
        <Button size="sm" variant="outline" disabled={!item.previewUrl} onClick={() => preview.current?.showModal()} aria-label={`Preview ${item.title}`}><Play aria-hidden="true" />Preview</Button>
        {item.downloadHref ? <Button asChild size="sm" variant="outline"><a href={item.downloadHref} aria-label={`Download ${item.title}`}><Download aria-hidden="true" />Download</a></Button>
          : <Button size="sm" variant="outline" disabled><Download aria-hidden="true" />Download</Button>}
      </div>
      {superAdmin ? (
        <form className="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); if (owner && owner !== item.ownerId) run(() => reassignVideo(item.id, owner)); }}>
          <select aria-label={`New owner for ${item.title}`} value={owner} onChange={(e) => setOwner(e.target.value)} className="h-8 max-w-44 rounded-md border bg-background px-2 text-sm">
            {!item.ownerId ? <option value="">No owner</option> : null}
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <Button type="submit" size="sm" variant="ghost" disabled={pending || !owner || owner === item.ownerId}><UserRoundCog aria-hidden="true" />Reassign</Button>
        </form>
      ) : null}
      <div className="flex flex-wrap justify-end gap-1.5">
        {superAdmin ? (
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => setVideoAccess(item.id, !item.restricted, item.locked))}
            title="Restricted videos can only be opened by their owner, the people assigned to them and the Super Admin.">
            {item.restricted ? <><ShieldOff aria-hidden="true" />Unrestrict</> : <><Shield aria-hidden="true" />Restrict</>}
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => setVideoAccess(item.id, item.restricted, !item.locked))} title="Locked videos are read-only for everyone except the Super Admin.">
          {item.locked ? <><LockOpen aria-hidden="true" />Unlock</> : <><Lock aria-hidden="true" />Lock</>}
        </Button>
        {superAdmin ? (
          <>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => setVideoArchived(item.id, !item.archived))}>
              {item.archived ? <><ArchiveRestore aria-hidden="true" />Restore</> : <><Archive aria-hidden="true" />Archive</>}
            </Button>
            <Button size="sm" variant="ghost" className="text-destructive" disabled={pending} onClick={() => { setConfirm(""); del.current?.showModal(); }}><Trash2 aria-hidden="true" />Delete</Button>
          </>
        ) : null}
      </div>
      {msg ? <p role="status" className={`max-w-xs text-right text-xs ${msg.ok ? "text-success" : "text-destructive"}`}>{msg.text}</p> : null}

      <dialog ref={preview} className="w-[min(92vw,960px)] rounded-xl border bg-card p-0 text-foreground backdrop:bg-black/60" onClose={() => preview.current?.querySelector("video")?.pause()}>
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <h3 className="font-semibold">{item.title}</h3>
          <Button size="sm" variant="ghost" onClick={() => preview.current?.close()}>Close</Button>
        </div>
        {item.previewUrl ? <video src={item.previewUrl} controls playsInline preload="none" className="max-h-[75vh] w-full bg-black" /> : null}
      </dialog>

      <dialog ref={del} className="w-[min(92vw,520px)] rounded-xl border bg-card p-0 text-left text-foreground backdrop:bg-black/60">
        <form className="flex flex-col gap-4 p-5" onSubmit={(e) => { e.preventDefault(); run(() => deleteVideo(item.id, confirm), () => del.current?.close()); }}>
          <h3 className="text-lg font-semibold text-destructive">Delete this video for good?</h3>
          <p className="text-sm">This deletes <strong>{item.title}</strong>, every render and its stored files. It can&apos;t be undone. Archive it instead to keep it.</p>
          <label className="flex flex-col gap-1.5 text-sm font-medium">Type the video&apos;s title to confirm
            <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" placeholder={item.title} />
          </label>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => del.current?.close()}>Cancel</Button>
            <Button type="submit" variant="destructive" disabled={pending || confirm.trim() !== item.title.trim()}><Trash2 aria-hidden="true" />Delete forever</Button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
