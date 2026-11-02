/*
 * Roles and permissions. The database enforces the same rules (Row-Level
 * Security + admin functions in supabase/migrations); this module only decides
 * what the UI offers. Every server action is re-checked by the database.
 */
export const ROLES = ["viewer", "editor", "admin", "super_admin"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  viewer: "Viewer",
  editor: "Editor",
  admin: "Admin",
  super_admin: "Super Admin",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  viewer: "Sees only projects assigned to them. Can download if allowed.",
  editor: "Creates listings, uploads photos, makes and edits videos.",
  admin: "Adds people, assigns projects and sees company video activity.",
  super_admin: "Full control, including admins, AI services, costs and settings.",
};

export const USER_STATUSES = ["invited", "active", "suspended", "deactivated"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const STATUS_LABELS: Record<UserStatus, string> = {
  invited: "Invited",
  active: "Active",
  suspended: "Suspended",
  deactivated: "Deactivated",
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function roleRank(role: Role): number {
  return ROLES.indexOf(role);
}

export function hasRole(role: Role | null | undefined, minimum: Role): boolean {
  if (!role) return false;
  return roleRank(role) >= roleRank(minimum);
}

export const PERMISSIONS = {
  "videos.view": "viewer",
  "videos.create": "editor",
  "listings.view": "viewer",
  "listings.create": "editor",
  "templates.view": "viewer",
  "templates.manage": "admin",
  "camera.use": "editor",
  "effects.use": "editor",
  "admin.access": "admin",
  "users.manage": "admin",
  "projects.assign": "admin",
  "activity.view": "admin",
  "branding.manage": "admin",
  "admins.manage": "super_admin",
  "projects.all": "super_admin",
  "settings.manage": "super_admin",
} as const satisfies Record<string, Role>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role | null | undefined, permission: Permission): boolean {
  return hasRole(role, PERMISSIONS[permission]);
}

/** Per-person switches an admin can turn on or off (on top of the role). */
export interface UserFlags {
  can_download: boolean;
  can_use_ai: boolean;
}

export function canDownload(role: Role, flags: UserFlags): boolean {
  return hasRole(role, "viewer") && flags.can_download;
}

export function canUseAi(role: Role, flags: UserFlags): boolean {
  return hasRole(role, "editor") && flags.can_use_ai;
}

/** Roles `actor` may give to someone else. Super Admin is never assignable. */
export function assignableRoles(actor: Role): Role[] {
  if (actor === "super_admin") return ["viewer", "editor", "admin"];
  if (actor === "admin") return ["viewer", "editor"];
  return [];
}

/** Mirrors private.assert_can_manage() in the database. */
export function canManageUser(actor: { id: string; role: Role }, target: { id: string; role: Role }): boolean {
  if (actor.id === target.id) return false;
  if (!hasRole(actor.role, "admin")) return false;
  if (target.role === "super_admin") return false;
  if (target.role === "admin" && actor.role !== "super_admin") return false;
  return true;
}

/** Status changes the UI offers (deactivated accounts come back only via the Super Admin). */
export function allowedStatusChanges(actor: Role, current: UserStatus): Exclude<UserStatus, "invited">[] {
  switch (current) {
    case "invited":
      return ["suspended", "deactivated"];
    case "active":
      return ["suspended", "deactivated"];
    case "suspended":
      return ["active", "deactivated"];
    case "deactivated":
      return actor === "super_admin" ? ["active"] : [];
  }
}
