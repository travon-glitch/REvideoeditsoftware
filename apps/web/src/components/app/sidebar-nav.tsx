"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ICONS } from "@/components/icons";
import { isActivePath, type NavItem } from "@/lib/nav";
import { cn } from "@/lib/utils";

export function SidebarNav({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-col gap-1">
      {items.map((item) => {
        const Icon = NAV_ICONS[item.icon];
        const active = isActivePath(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-h-12 items-center gap-3 rounded-lg px-3 text-base font-medium transition-colors",
              active
                ? "bg-white/10 text-white"
                : "text-sidebar-muted hover:bg-white/5 hover:text-white",
            )}
          >
            <Icon className="size-5 shrink-0" aria-hidden="true" />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
