import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";

/* Every page under /admin requires an administrator (checked on the server, and again by the database). */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requirePermission("admin.access");
  const tabs = [
    { href: "/admin", label: "Dashboard" },
    { href: "/admin/users", label: "People" },
    { href: "/admin/library", label: "Video library" },
    ...(can(ctx.profile.role, "settings.manage") ? [{ href: "/admin/ai", label: "AI control panel" }] : []),
    { href: "/admin/health", label: "System health" },
    { href: "/admin/audit", label: "Activity log" },
    ...(can(ctx.profile.role, "branding.manage") ? [{ href: "/admin/branding", label: "Brand kit" }] : []),
    { href: "/admin/templates", label: "Templates" },
    { href: "/admin/agents", label: "Agent profiles" },
    { href: "/admin/music", label: "Music library" },
    ...(can(ctx.profile.role, "settings.manage") ? [{ href: "/admin/settings", label: "System settings" }] : []),
  ];
  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Admin sections" className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <Link key={t.href} href={t.href} className="inline-flex min-h-11 items-center rounded-lg border bg-card px-4 text-base font-medium hover:border-primary/40 hover:bg-accent">
            {t.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
