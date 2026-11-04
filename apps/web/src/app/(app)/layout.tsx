import type { CSSProperties } from "react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { navForRole } from "@/lib/nav";
import { can } from "@/lib/auth/roles";
import { hexToHslTriplet } from "@/lib/utils";
import { BUCKETS } from "@/lib/storage";
import { SidebarNav } from "@/components/app/sidebar-nav";
import { MobileNav } from "@/components/app/mobile-nav";
import { BrandMark } from "@/components/app/brand-mark";
import { UserMenu } from "@/components/app/user-menu";
import { ModeToggle } from "@/components/app/mode-toggle";
import { CreateVideoButton } from "@/components/app/create-video-button";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireSession();
  const items = navForRole(ctx.profile.role, ctx.profile.ui_mode);
  const companyName = ctx.brandKit?.company_name || ctx.organization.name;

  let logoUrl: string | null = null;
  if (ctx.brandKit?.logo_path) {
    const supabase = await createClient();
    const { data } = await supabase.storage.from(BUCKETS.brandAssets).createSignedUrl(ctx.brandKit.logo_path, 3600);
    logoUrl = data?.signedUrl ?? null;
  }
  const brand = hexToHslTriplet(ctx.brandKit?.primary_color ?? "");
  const style = (brand ? { "--brand": brand } : {}) as CSSProperties;

  const mark = <BrandMark companyName={companyName} logoUrl={logoUrl} />;
  const canCreate = can(ctx.profile.role, "videos.create");

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[272px_1fr]" style={style}>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-background focus:px-4 focus:py-2">
        Skip to content
      </a>
      <aside className="sticky top-0 hidden h-screen flex-col gap-6 overflow-y-auto bg-sidebar p-5 text-sidebar-foreground lg:flex">
        {mark}
        {canCreate ? <CreateVideoButton className="w-full" /> : null}
        <SidebarNav items={items} />
        <div className="mt-auto">
          <UserMenu name={ctx.profile.full_name} email={ctx.email} role={ctx.profile.role} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex flex-wrap items-center gap-3 border-b bg-background/95 px-4 py-3 backdrop-blur sm:px-6">
          <MobileNav items={items} header={mark} />
          <div className="ml-auto flex flex-wrap items-center gap-3">
            <ModeToggle mode={ctx.profile.ui_mode} />
            {canCreate ? <CreateVideoButton /> : null}
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
          {children}
        </main>
        <footer className="px-6 pb-6 text-center text-sm text-muted-foreground">
          Private company system — for {ctx.organization.name} staff only.
        </footer>
      </div>
    </div>
  );
}
