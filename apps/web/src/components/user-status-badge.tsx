import { Badge, type BadgeProps } from "@/components/ui/badge";
import { STATUS_LABELS, type UserStatus } from "@/lib/auth/roles";

const STATUS_VARIANT: Record<UserStatus, BadgeProps["variant"]> = {
  invited: "warning", active: "success", suspended: "destructive", deactivated: "outline",
};

export function UserStatusBadge({ status }: { status: UserStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABELS[status]}</Badge>;
}
