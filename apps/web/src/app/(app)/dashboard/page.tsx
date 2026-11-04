import Link from "next/link";
import { ArrowRight, Clapperboard, House, PartyPopper } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/roles";
import { navForRole } from "@/lib/nav";
import { formatDate } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CreateVideoButton } from "@/components/app/create-video-button";
import { VideoStatusBadge } from "@/components/status-badge";
import { NAV_ICONS } from "@/components/icons";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireSession();
  const { welcome } = await searchParams;
  const supabase = await createClient();

  const [listings, videos, inProgress, recent] = await Promise.all([
    supabase.from("listings").select("id", { count: "exact", head: true }),
    supabase.from("video_projects").select("id", { count: "exact", head: true }).eq("status", "completed"),
    supabase.from("video_projects").select("id", { count: "exact", head: true }).in("status", ["draft", "generating", "ready_for_review", "rendering"]),
    supabase.from("video_projects").select("id,title,status,updated_at").is("archived_at", null).order("updated_at", { ascending: false }).limit(5),
  ]);

  const firstName = ctx.profile.full_name.split(" ")[0] || "there";
  const shortcuts = navForRole(ctx.profile.role, ctx.profile.ui_mode).filter((n) => !["/dashboard", "/create"].includes(n.href));
  const stats = [
    { label: "Listings", value: listings.count ?? 0, href: "/listings" },
    { label: "Videos in progress", value: inProgress.count ?? 0, href: "/videos" },
    { label: "Finished videos", value: videos.count ?? 0, href: "/videos" },
  ];

  return (
    <div className="flex flex-col gap-8">
      {welcome ? (
        <Alert variant="success">
          <PartyPopper aria-hidden="true" />
          <AlertDescription className="text-base">
            Setup is complete. Next, add your logo in <Link className="font-semibold underline" href="/admin/branding">Branding</Link> and invite your team in <Link className="font-semibold underline" href="/admin/team">Team</Link>.
          </AlertDescription>
        </Alert>
      ) : null}

      <section className="flex flex-col gap-6 rounded-2xl bg-sidebar p-6 text-white sm:p-10 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold sm:text-4xl">Hi {firstName}!</h1>
          <p className="max-w-xl text-lg text-sidebar-muted">
            Turn listing photos into a polished video in a few simple steps.
          </p>
        </div>
        {can(ctx.profile.role, "videos.create") ? <CreateVideoButton size="xl" /> : null}
      </section>

      <section aria-label="Summary" className="grid gap-4 sm:grid-cols-3">
        {stats.map((s) => (
          <Link key={s.label} href={s.href} className="rounded-xl border bg-card p-5 transition-colors hover:border-primary/40">
            <p className="text-base text-muted-foreground">{s.label}</p>
            <p className="text-3xl font-bold">{s.value}</p>
          </Link>
        ))}
      </section>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Recent videos</CardTitle>
            <Button variant="ghost" asChild><Link href="/videos">See all <ArrowRight aria-hidden="true" /></Link></Button>
          </CardHeader>
          <CardContent>
            {recent.data && recent.data.length > 0 ? (
              <ul className="divide-y">
                {recent.data.map((v) => (
                  <li key={v.id}>
                    <Link href={`/videos/${v.id}`} className="flex min-h-14 items-center gap-4 py-3 hover:text-primary">
                      <Clapperboard className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate font-medium">{v.title}</span>
                      <VideoStatusBadge status={v.status} />
                      <span className="hidden text-sm text-muted-foreground sm:inline">{formatDate(v.updated_at)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex flex-col items-start gap-3 py-4">
                <p className="text-base text-muted-foreground">No videos yet. Your first one takes just a few minutes.</p>
                <Button variant="outline" asChild><Link href="/listings/new"><House aria-hidden="true" />Add a listing first</Link></Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Go to</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-2">
            {shortcuts.map((s) => {
              const Icon = NAV_ICONS[s.icon];
              return (
                <Link key={s.href} href={s.href} className="flex min-h-14 items-center gap-3 rounded-lg border px-4 hover:border-primary/40 hover:bg-accent">
                  <Icon className="size-5 text-primary" aria-hidden="true" />
                  <span className="flex-1">
                    <span className="block font-semibold">{s.label}</span>
                    <span className="block text-sm text-muted-foreground">{s.hint}</span>
                  </span>
                </Link>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
