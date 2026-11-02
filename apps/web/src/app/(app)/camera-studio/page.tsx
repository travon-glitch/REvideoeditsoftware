import { requirePermission } from "@/lib/auth/session";
import { PageHeader } from "@/components/page-header";
import { ComingSoonNote } from "@/components/coming-soon";
import { MovePicker } from "./move-picker";

export const metadata = { title: "Camera Studio" };

export default async function CameraStudioPage() {
  const ctx = await requirePermission("camera.use");
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Camera Studio" description="Make still photos feel like video. Pick a camera move to see how it looks." />
      <MovePicker advanced={ctx.profile.ui_mode === "advanced"} />
      <ComingSoonNote>
        Applying AI moves to your own photos is switched on once your administrator approves an AI video service. Free moves are already used in every new video.
      </ComingSoonNote>
    </div>
  );
}
