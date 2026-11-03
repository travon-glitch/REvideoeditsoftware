import { requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { signedUrlMap } from "@/lib/storage-server";
import { BUCKETS } from "@/lib/storage";
import { PageHeader } from "@/components/page-header";
import { AgentManager, type AgentView } from "./agent-manager";

export const metadata = { title: "Agent profiles" };

export default async function AgentsPage() {
  const ctx = await requirePermission("agents.manage");
  const db = await createClient();
  const [{ data: agents }, { data: people }, { data: listings }] = await Promise.all([
    db.from("agent_profiles").select("*").order("name"),
    db.from("profiles").select("id,first_name,last_name,email").eq("status", "active").order("first_name"),
    db.from("listings").select("agent_profile_id").not("agent_profile_id", "is", null),
  ]);
  const shotIds = (agents ?? []).flatMap((a) => (a.headshot_asset_id ? [a.headshot_asset_id] : []));
  const { data: shots } = shotIds.length ? await db.from("media_assets").select("id,storage_path").in("id", shotIds) : { data: [] };
  const urls = await signedUrlMap(BUCKETS.brandAssets, (shots ?? []).map((s) => s.storage_path), 3600);
  const used = new Map<string, number>();
  for (const l of listings ?? []) if (l.agent_profile_id) used.set(l.agent_profile_id, (used.get(l.agent_profile_id) ?? 0) + 1);
  const views: AgentView[] = (agents ?? []).map((a) => ({
    id: a.id, name: a.name, title: a.title, phone: a.phone, email: a.email, brokerage: a.brokerage, license: a.license, user_id: a.user_id,
    is_active: a.is_active, listings: used.get(a.id) ?? 0,
    headshot: (() => { const s = (shots ?? []).find((x) => x.id === a.headshot_asset_id); return s ? urls[s.storage_path] ?? null : null; })(),
  }));
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Agent profiles" description="Assign an agent to a listing and their name, phone, email, headshot and brokerage appear on its videos automatically." />
      <AgentManager orgId={ctx.organization.id} agents={views}
        people={(people ?? []).map((p) => ({ id: p.id, label: [p.first_name, p.last_name].filter(Boolean).join(" ") || p.email }))}
        defaultBrokerage={ctx.brandKit?.brokerage_name ?? ctx.brandKit?.company_name ?? ""} />
    </div>
  );
}
