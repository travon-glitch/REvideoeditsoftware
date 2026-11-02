"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Play, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/utils";

interface Item { id: string; title: string; aspect: string; duration_seconds: number | null; saved_by: string | null; saved_at: string }

export function LibraryGrid({ items, canDownload, userId, isAdmin }: { items: Item[]; canDownload: boolean; userId: string; isAdmin: boolean }) {
  const router = useRouter();
  const [playing, setPlaying] = useState<string | null>(null);
  async function remove(id: string) {
    if (!window.confirm("Remove this video from the company library? The video itself is kept.")) return;
    await fetch(`/api/library/${id}`, { method: "DELETE" }).catch(() => null);
    router.refresh();
  }
  return (
    <ul className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
      {items.map((v) => (
        <li key={v.id} className="flex flex-col overflow-hidden rounded-2xl border bg-card">
          <div className="flex aspect-video items-center justify-center bg-neutral-900">
            {playing === v.id ? (
              <video autoPlay controls playsInline className="size-full object-contain" src={`/api/library/${v.id}/download?play=1`} aria-label={v.title} />
            ) : canDownload ? (
              <button type="button" onClick={() => setPlaying(v.id)} aria-label={`Play ${v.title}`} className="flex size-16 items-center justify-center rounded-full bg-white/90 text-black"><Play className="size-8" aria-hidden="true" /></button>
            ) : <span className="text-sm text-white/70">Ask an administrator for download access to watch</span>}
          </div>
          <div className="flex flex-1 flex-col gap-2 p-4">
            <h2 className="text-base font-semibold">{v.title}</h2>
            <p className="text-sm text-muted-foreground">{v.aspect} · {v.duration_seconds ? `${Math.round(v.duration_seconds)} s` : ""} · saved {formatDateTime(v.saved_at)}</p>
            <div className="mt-auto flex flex-wrap gap-2">
              {canDownload ? <Button asChild size="sm"><a href={`/api/library/${v.id}/download`}><Download aria-hidden="true" />Download</a></Button> : null}
              {v.saved_by === userId || isAdmin ? <Button size="sm" variant="ghost" onClick={() => void remove(v.id)}><Trash2 aria-hidden="true" />Remove</Button> : null}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
