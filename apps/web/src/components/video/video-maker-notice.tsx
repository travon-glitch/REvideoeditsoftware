/* Shown while a video is waiting to be made: says plainly whether the video maker is on its way. */
import { Clock, TriangleAlert } from "lucide-react";
import type { VideoMakerStatus } from "@/lib/video-maker";

export function VideoMakerNotice({ status, waiting }: { status: VideoMakerStatus | null | undefined; waiting: boolean }) {
  if (!waiting || !status || status.online) return null;
  if (status.onDemand) {
    return (
      <p role="status" className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
        <Clock className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
        The video maker is starting up. Your video usually begins within 2–4 minutes — you can leave this page; it keeps going.
      </p>
    );
  }
  return (
    <p role="alert" className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
      No video maker is running, so this video can&apos;t start yet. Tell your administrator: the render worker needs to be set up (docs/VERCEL.md, step 6). Your video will start as soon as it&apos;s running.
    </p>
  );
}
