"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera, LoaderCircle, Plus, Trash2, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { BUCKETS } from "@/lib/storage";
import { deleteAgent, saveAgent, setAgentHeadshot, type AgentInput } from "./actions";

export interface AgentView {
  id: string; name: string; title: string | null; phone: string | null; email: string | null; brokerage: string | null; license: string | null;
  user_id: string | null; is_active: boolean; listings: number; headshot: string | null;
}

const EMPTY: AgentInput = { name: "", title: "", phone: "", email: "", brokerage: "", license: "", user_id: "", is_active: true };

export function AgentManager({ orgId, agents, people, defaultBrokerage }: { orgId: string; agents: AgentView[]; people: { id: string; label: string }[]; defaultBrokerage: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | "new" | null>(agents.length ? null : "new");
  const [form, setForm] = useState<AgentInput>({ ...EMPTY, brokerage: defaultBrokerage });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [uploading, setUploading] = useState<string | null>(null);

  const open = (a: AgentView | null) => {
    setMsg(null);
    setEditing(a ? a.id : "new");
    setForm(a ? { id: a.id, name: a.name, title: a.title ?? "", phone: a.phone ?? "", email: a.email ?? "", brokerage: a.brokerage ?? "", license: a.license ?? "", user_id: a.user_id ?? "", is_active: a.is_active }
      : { ...EMPTY, brokerage: defaultBrokerage });
  };
  const save = () => start(async () => {
    const r = await saveAgent(form);
    setMsg({ ok: r.ok, text: r.message ?? "" });
    if (r.ok) { setEditing(null); router.refresh(); }
  });
  const remove = (id: string) => start(async () => {
    const r = await deleteAgent(id);
    setMsg({ ok: r.ok, text: r.message ?? "" });
    if (r.ok) router.refresh();
  });
  async function upload(agentId: string, file: File | undefined) {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 10_000_000) { setMsg({ ok: false, text: "Use a JPG, PNG or WebP photo up to 10 MB." }); return; }
    setUploading(agentId); setMsg(null);
    const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const path = `${orgId}/agents/${crypto.randomUUID()}.${ext}`;
    const { error } = await createClient().storage.from(BUCKETS.brandAssets).upload(path, file, { contentType: file.type });
    if (error) { setUploading(null); setMsg({ ok: false, text: "The photo couldn't be uploaded." }); return; }
    const r = await setAgentHeadshot(agentId, path);
    setUploading(null);
    setMsg({ ok: r.ok, text: r.message ?? "" });
    if (r.ok) router.refresh();
  }
  const field = (k: keyof AgentInput, label: string, type = "text") => (
    <label className="flex flex-col gap-1 text-sm font-medium">
      {label}
      <Input type={type} value={String(form[k] ?? "")} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
    </label>
  );

  return (
    <div className="flex flex-col gap-4">
      {msg ? <Alert variant={msg.ok ? "success" : "destructive"}><AlertDescription className="text-base">{msg.text}</AlertDescription></Alert> : null}
      <div className="flex justify-end"><Button onClick={() => open(null)}><Plus aria-hidden="true" />New agent profile</Button></div>
      {editing ? (
        <Card>
          <CardContent className="grid gap-4 pt-6 sm:grid-cols-2">
            <h2 className="text-lg font-semibold sm:col-span-2">{editing === "new" ? "New agent profile" : `Edit ${form.name}`}</h2>
            {field("name", "Name")}
            {field("title", "Title (e.g. Listing Agent)")}
            {field("phone", "Phone", "tel")}
            {field("email", "Email", "email")}
            {field("brokerage", "Brokerage")}
            {field("license", "Licence number")}
            <label className="flex flex-col gap-1 text-sm font-medium">
              Linked person (they can update their own contact details)
              <NativeSelect value={String(form.user_id ?? "")} onChange={(e) => setForm({ ...form, user_id: e.target.value })}>
                <option value="">Not linked</option>
                {people.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </NativeSelect>
            </label>
            <label className="flex items-center gap-3 self-end text-base">
              <input type="checkbox" className="size-5" checked={form.is_active !== false} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
              Active (can be assigned to listings)
            </label>
            <div className="flex gap-2 sm:col-span-2">
              <Button disabled={pending || !String(form.name).trim()} onClick={save}>{pending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}Save</Button>
              <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
      {agents.length === 0 ? <p className="text-base text-muted-foreground">No agent profiles yet.</p> : (
        <ul className="grid gap-4 md:grid-cols-2">
          {agents.map((a) => (
            <li key={a.id} className="flex gap-4 rounded-xl border bg-card p-4">
              <div className="relative size-24 shrink-0 overflow-hidden rounded-full bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {a.headshot ? <img src={a.headshot} alt={`${a.name} headshot`} className="size-full object-cover" /> : <UserRound className="m-6 size-12 text-muted-foreground" aria-hidden="true" />}
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p className="text-lg font-semibold">{a.name}{!a.is_active ? <span className="ml-2 text-sm font-normal text-muted-foreground">(inactive)</span> : null}</p>
                <p className="text-sm text-muted-foreground">{[a.title, a.brokerage].filter(Boolean).join(" · ")}</p>
                <p className="text-sm">{[a.phone, a.email].filter(Boolean).join(" · ")}</p>
                <p className="text-xs text-muted-foreground">{a.listings} listing{a.listings === 1 ? "" : "s"}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => open(a)}>Edit</Button>
                  <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm font-medium hover:bg-accent">
                    {uploading === a.id ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Camera className="size-4" aria-hidden="true" />}
                    {a.headshot ? "Replace headshot" : "Add headshot"}
                    <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => void upload(a.id, e.target.files?.[0])} />
                  </label>
                  <Button size="sm" variant="ghost" className="text-destructive" disabled={pending} onClick={() => remove(a.id)}><Trash2 aria-hidden="true" />Remove</Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
