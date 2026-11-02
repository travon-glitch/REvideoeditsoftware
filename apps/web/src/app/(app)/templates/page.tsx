import Link from "next/link";
import { LayoutTemplate } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/roles";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";

export const metadata = { title: "Templates" };

export default async function TemplatesPage() {
  const ctx = await requirePermission("templates.view");
  const supabase = await createClient();
  const { data: templates } = await supabase.from("video_templates").select("*").eq("is_active", true).order("sort_order");
  const canCreate = can(ctx.profile.role, "videos.create");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Templates" description="Ready-made styles. Your company colors, fonts and logo are added automatically." />
      {templates && templates.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((t) => (
            <Card key={t.id} className="flex flex-col">
              <div className="m-4 mb-0 flex aspect-video items-center justify-center rounded-lg bg-brand/10 text-brand">
                <LayoutTemplate className="size-10" aria-hidden="true" />
              </div>
              <CardHeader>
                <CardTitle>{t.name}</CardTitle>
                <CardDescription>{t.description}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {t.aspect_ratios.map((r) => <Badge key={r} variant="secondary">{r}</Badge>)}
                {t.organization_id ? <Badge>Company template</Badge> : null}
              </CardContent>
              {canCreate ? (
                <CardFooter className="mt-auto">
                  <Button asChild variant="outline" className="w-full"><Link href="/create">Use this style</Link></Button>
                </CardFooter>
              ) : null}
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState icon={LayoutTemplate} title="No templates yet" description="An administrator can add company templates." />
      )}
    </div>
  );
}
