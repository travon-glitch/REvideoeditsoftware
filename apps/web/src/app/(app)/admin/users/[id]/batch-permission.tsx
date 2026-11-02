"use client";
import { useState, useTransition } from "react";
import { setBatchPermission } from "../../actions";

export function BatchPermissionToggle({ userId, allowed }: { userId: string; allowed: boolean }) {
  const [on, setOn] = useState(allowed);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-2">
      <label className="flex min-h-12 cursor-pointer items-center gap-3 text-base">
        <input type="checkbox" className="size-6 accent-[hsl(var(--primary))]" checked={on} disabled={pending}
          onChange={(e) => {
            const next = e.target.checked;
            setOn(next); setMsg(null);
            start(async () => {
              const r = await setBatchPermission(userId, next);
              if (!r.ok) setOn(!next);
              setMsg(r.ok ? (next ? "Allowed." : "Turned off.") : r.message);
            });
          }} />
        May use Generate 6 Videos
      </label>
      {msg ? <p role="status" className="text-sm text-muted-foreground">{msg}</p> : null}
    </div>
  );
}
