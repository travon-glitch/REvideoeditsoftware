import { can, type Permission, type Role } from "@/lib/auth/roles";

export type NavIcon =
  | "dashboard" | "create" | "batch" | "listings" | "videos" | "library" | "templates" | "camera" | "effects" | "admin";

export interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
  permission: Permission;
  /** Short helper text shown in Easy Mode tooltips and the dashboard. */
  hint: string;
  /** Shown only in Advanced Mode (Easy Mode reaches the same tools from inside the video editor). */
  advanced?: boolean;
  /** Not built yet: kept out of the menu so nobody lands on an empty page. */
  hidden?: boolean;
}

/** Main navigation, in the order people see it. */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard", permission: "videos.view", hint: "Your home page" },
  { href: "/create", label: "Create Video", icon: "create", permission: "videos.create", hint: "Make a new listing video" },
  { href: "/generate", label: "Generate 6 Videos", icon: "batch", permission: "videos.create", hint: "Six marketing videos in one click" },
  { href: "/listings", label: "My Listings", icon: "listings", permission: "listings.view", hint: "Homes and their photos" },
  { href: "/videos", label: "My Videos", icon: "videos", permission: "videos.view", hint: "Drafts and finished videos" },
  { href: "/library", label: "Company Library", icon: "library", permission: "videos.view", hint: "Finished videos shared with the company" },
  { href: "/templates", label: "Templates", icon: "templates", permission: "templates.view", hint: "Ready-made video styles" },
  { href: "/camera-studio", label: "Camera Studio", icon: "camera", permission: "camera.use", hint: "Add camera motion to photos", advanced: true },
  { href: "/ai-effects", label: "AI Effects", icon: "effects", permission: "effects.use", hint: "Enhance photos with AI", hidden: true },
  { href: "/admin", label: "Admin Panel", icon: "admin", permission: "admin.access", hint: "Team, branding and settings" },
];

export function navForRole(role: Role | null | undefined, mode: "easy" | "advanced" = "advanced"): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.hidden && (mode === "advanced" || !item.advanced) && can(role, item.permission));
}

export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
