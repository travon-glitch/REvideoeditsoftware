import { can, type Permission, type Role } from "@/lib/auth/roles";

export type NavIcon =
  | "dashboard" | "create" | "listings" | "videos" | "templates" | "camera" | "effects" | "admin";

export interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
  permission: Permission;
  /** Short helper text shown in Easy Mode tooltips and the dashboard. */
  hint: string;
}

/** Main navigation, in the order people see it. */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard", permission: "videos.view", hint: "Your home page" },
  { href: "/create", label: "Create Video", icon: "create", permission: "videos.create", hint: "Make a new listing video" },
  { href: "/listings", label: "My Listings", icon: "listings", permission: "listings.view", hint: "Homes and their photos" },
  { href: "/videos", label: "My Videos", icon: "videos", permission: "videos.view", hint: "Drafts and finished videos" },
  { href: "/templates", label: "Templates", icon: "templates", permission: "templates.view", hint: "Ready-made video styles" },
  { href: "/camera-studio", label: "Camera Studio", icon: "camera", permission: "camera.use", hint: "Add camera motion to photos" },
  { href: "/ai-effects", label: "AI Effects", icon: "effects", permission: "effects.use", hint: "Enhance photos with AI" },
  { href: "/admin", label: "Admin Panel", icon: "admin", permission: "admin.access", hint: "Team, branding and settings" },
];

export function navForRole(role: Role | null | undefined): NavItem[] {
  return NAV_ITEMS.filter((item) => can(role, item.permission));
}

export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
