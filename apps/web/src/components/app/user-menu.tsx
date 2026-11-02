import Link from "next/link";
import { LogOut, User } from "lucide-react";
import { ROLE_LABELS, type Role } from "@/lib/auth/roles";

export function UserMenu({ name, email, role }: { name: string; email: string; role: Role }) {
  return (
    <div className="flex flex-col gap-3 border-t border-white/10 pt-4">
      <Link href="/account" className="flex min-h-12 items-center gap-3 rounded-lg px-2 hover:bg-white/5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-white">
          <User className="size-5" aria-hidden="true" />
        </span>
        <span className="min-w-0 leading-tight">
          <span className="block truncate font-semibold text-white">{name || email}</span>
          <span className="block text-sm text-sidebar-muted">{ROLE_LABELS[role]}</span>
        </span>
      </Link>
      <form action="/auth/signout" method="post">
        <button type="submit" className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-base text-sidebar-muted hover:bg-white/5 hover:text-white">
          <LogOut className="size-5" aria-hidden="true" />
          Sign out
        </button>
      </form>
    </div>
  );
}
