import {
  Camera, Clapperboard, GalleryVerticalEnd, House, Layers, LayoutDashboard, LayoutTemplate, PlusCircle, ShieldCheck, Sparkles,
  type LucideIcon,
} from "lucide-react";
import type { NavIcon } from "@/lib/nav";

export const NAV_ICONS: Record<NavIcon, LucideIcon> = {
  dashboard: LayoutDashboard,
  create: PlusCircle,
  batch: Layers,
  library: GalleryVerticalEnd,
  listings: House,
  videos: Clapperboard,
  templates: LayoutTemplate,
  camera: Camera,
  effects: Sparkles,
  admin: ShieldCheck,
};
