import { Clapperboard } from "lucide-react";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-sidebar px-4 py-12">
      <div className="flex items-center gap-3 text-white">
        <div className="flex size-11 items-center justify-center rounded-xl bg-brand">
          <Clapperboard className="size-6" aria-hidden="true" />
        </div>
        <div className="leading-tight">
          <p className="text-lg font-bold">Video Studio</p>
          <p className="text-sm text-sidebar-muted">Private company workspace</p>
        </div>
      </div>
      <div className="w-full max-w-md">{children}</div>
    </main>
  );
}
