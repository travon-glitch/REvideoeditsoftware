import Link from "next/link";
import { Clapperboard, IdCard, LayoutTemplate, Palette, ScrollText, Settings, Users, Music } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "Admin Panel" };

export default async function AdminPage() {
  const ctx = await requirePermission("admin.access");
  const supabase = await createClient();
  const [{ count: members }, { count: active }] = await Promise.all([
    supabase.from("profiles").select("id", { count: "exact", head: true }),
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("status", "active"),
  ]);
  const cards = [
    { href: "/admin/users", icon: Users, title: "Users", text: `${active ?? 0} active of ${members ?? 0} people. Create accounts, set roles and assign projects.` },
    { href: "/admin/projects", icon: Clapperboard, title: "Company videos", text: "Every project, who owns it and who it's shared with." },
    ...(can(ctx.profile.role, "branding.manage")
      ? [{ href: "/admin/branding", icon: Palette, title: "Brand kit", text: "Logos, colours, fonts, intro and outro animation, agent card, disclosures and music." }]
      : []),
    { href: "/admin/templates", icon: LayoutTemplate, title: "Templates", text: "Create, edit, approve and disable templates, set defaults and branding rules." },
    { href: "/admin/agents", icon: IdCard, title: "Agent profiles", text: "Agent names, phone numbers, emails, headshots and brokerage details for videos." },
    { href: "/admin/audit", icon: ScrollText, title: "Activity log", text: "Who changed what, and when." },
    { href: "/admin/music", icon: Music, title: "Music library", text: "Licensed background music. Only tracks verified for commercial use are offered." },
    ...(can(ctx.profile.role, "settings.manage")
      ? [{ href: "/admin/settings", icon: Settings, title: "System settings", text: "AI services, budget and default limits." }]
      : []),
  ];
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Admin Panel" description={`Settings for ${ctx.organization.name}.`} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <Link key={c.href} href={c.href} className="flex flex-col gap-3 rounded-xl border bg-card p-6 hover:border-primary/40">
            <c.icon className="size-7 text-primary" aria-hidden="true" />
            <span className="text-lg font-semibold">{c.title}</span>
            <span className="text-base text-muted-foreground">{c.text}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
