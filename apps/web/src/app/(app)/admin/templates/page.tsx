import { requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { brandRules } from "@/lib/brand";
import { listTemplates } from "@/lib/video/template-store";
import { PageHeader } from "@/components/page-header";
import { TemplateAdmin } from "./template-admin";

export const metadata = { title: "Templates — Admin" };

export default async function AdminTemplatesPage() {
  const ctx = await requirePermission("templates.manage");
  const db = await createClient();
  const [templates, rules] = await Promise.all([listTemplates(db, ctx), brandRules(db)]);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Templates" description="Create, edit, approve and disable templates, assign defaults, and set the branding every video must follow." />
      <TemplateAdmin templates={templates} rules={rules} />
    </div>
  );
}
