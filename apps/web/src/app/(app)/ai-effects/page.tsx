import { CloudSun, Eraser, Lightbulb, Sofa, Sparkles, Wand2 } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { ComingSoonNote } from "@/components/coming-soon";

export const metadata = { title: "AI Effects" };

const EFFECTS = [
  { icon: CloudSun, name: "Blue sky", text: "Replace a grey sky with a clear one.", note: "Shown as “AI-enhanced”" },
  { icon: Lightbulb, name: "Brighten", text: "Fix dark rooms and balance window light.", note: "Keeps the room unchanged" },
  { icon: Wand2, name: "Sharpen & upscale", text: "Make small or blurry photos crisp.", note: "Keeps the room unchanged" },
  { icon: Eraser, name: "Remove clutter", text: "Clear small items like cords and papers.", note: "Shown as “AI-enhanced”" },
  { icon: Sofa, name: "Virtual staging", text: "Add furniture to empty rooms.", note: "Always labeled “Virtually staged”" },
  { icon: Sparkles, name: "Twilight look", text: "Turn a daytime exterior into an evening shot.", note: "Shown as “AI-enhanced”" },
];

export default async function AiEffectsPage() {
  await requirePermission("effects.use");
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="AI Effects" description="One-click photo improvements. Your original photos are always kept." />
      <ComingSoonNote>
        AI Effects turn on after your administrator approves an AI service. Effects that change what a home looks like are always labeled in the video.
      </ComingSoonNote>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {EFFECTS.map((e) => (
          <Card key={e.name} aria-disabled="true" className="opacity-90">
            <CardHeader>
              <e.icon className="size-7 text-primary" aria-hidden="true" />
              <CardTitle>{e.name}</CardTitle>
              <CardDescription>{e.text}</CardDescription>
              <Badge variant="secondary" className="self-start">{e.note}</Badge>
            </CardHeader>
          </Card>
        ))}
      </div>
    </div>
  );
}
