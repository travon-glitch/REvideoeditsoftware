import { Badge, type BadgeProps } from "@/components/ui/badge";
import type { VideoStatus } from "@/lib/database.types";

const VIDEO_STATUS: Record<VideoStatus, { label: string; variant: BadgeProps["variant"] }> = {
  draft: { label: "Draft", variant: "secondary" },
  generating: { label: "Being made", variant: "default" },
  ready_for_review: { label: "Ready to review", variant: "warning" },
  approved: { label: "Approved", variant: "success" },
  rendering: { label: "Finishing", variant: "default" },
  completed: { label: "Ready", variant: "success" },
  failed: { label: "Needs attention", variant: "destructive" },
  archived: { label: "Archived", variant: "outline" },
};

export function VideoStatusBadge({ status }: { status: VideoStatus }) {
  const s = VIDEO_STATUS[status];
  return <Badge variant={s.variant}>{s.label}</Badge>;
}
