import {
  Camera, Clapperboard, House, LayoutDashboard, LayoutTemplate, PlusCircle, ShieldCheck, Sparkles,
  type LucideIcon,
} from "lucide-react";
import type { NavIcon } from "@/lib/nav";

export const NAV_ICONS: Record<NavIcon, LucideIcon> = {
  dashboard: LayoutDashboard,
  create: PlusCircle,
  listings: House,
  videos: Clapperboard,
  templates: LayoutTemplate,
  camera: Camera,
  effects: Sparkles,
  admin: ShieldCheck,
};
