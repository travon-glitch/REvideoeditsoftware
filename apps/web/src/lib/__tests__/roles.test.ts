import { describe, expect, it } from "vitest";
import { ROLES, allowedStatusChanges, assignableRoles, can, canDownload, canManageUser, canUseAi, hasRole, isRole } from "@/lib/auth/roles";
import { NAV_ITEMS, isActivePath, navForRole } from "@/lib/nav";

describe("roles", () => {
  it("are ranked viewer < editor < admin < super_admin", () => {
    expect(ROLES).toEqual(["viewer", "editor", "admin", "super_admin"]);
    expect(isRole("creator")).toBe(false);
    expect(hasRole("admin", "editor")).toBe(true);
    expect(hasRole("editor", "admin")).toBe(false);
    expect(hasRole(null, "viewer")).toBe(false);
    expect(isRole("owner")).toBe(false);
  });

  it("gate permissions", () => {
    expect(can("viewer", "videos.view")).toBe(true);
    expect(can("viewer", "videos.create")).toBe(false);
    expect(can("editor", "admin.access")).toBe(false);
    expect(can("admin", "admin.access")).toBe(true);
    expect(can("admin", "admins.manage")).toBe(false);
    expect(can("super_admin", "admins.manage")).toBe(true);
  });

  it("never let anyone hand out Super Admin, and only Super Admin hands out Administrator", () => {
    expect(assignableRoles("super_admin")).toEqual(["viewer", "editor", "admin"]);
    expect(assignableRoles("admin")).toEqual(["viewer", "editor"]);
    expect(assignableRoles("editor")).toEqual([]);
    for (const r of ROLES) expect(assignableRoles(r)).not.toContain("super_admin");
  });

  it("mirror the database rules for managing members", () => {
    const sa = { id: "sa", role: "super_admin" as const };
    const ad = { id: "ad", role: "admin" as const };
    expect(canManageUser(ad, { id: "c", role: "editor" })).toBe(true);
    expect(canManageUser(ad, { id: "a2", role: "admin" })).toBe(false);
    expect(canManageUser(sa, { id: "a2", role: "admin" })).toBe(true);
    expect(canManageUser(sa, { id: "sa2", role: "super_admin" })).toBe(false);
    expect(canManageUser(ad, ad)).toBe(false);
    expect(canManageUser({ id: "c", role: "editor" }, { id: "v", role: "viewer" })).toBe(false);
  });
});

describe("Stage 3 permissions", () => {
  it("match the role descriptions", () => {
    expect(can("super_admin", "settings.manage")).toBe(true);
    expect(can("admin", "settings.manage")).toBe(false);
    expect(can("admin", "users.manage")).toBe(true);
    expect(can("admin", "projects.assign")).toBe(true);
    expect(can("admin", "projects.all")).toBe(false);
    expect(can("editor", "users.manage")).toBe(false);
    expect(can("viewer", "videos.create")).toBe(false);
  });

  it("apply per-person switches on top of the role", () => {
    expect(canDownload("viewer", { can_download: false, can_use_ai: false })).toBe(false);
    expect(canDownload("viewer", { can_download: true, can_use_ai: false })).toBe(true);
    expect(canUseAi("viewer", { can_download: true, can_use_ai: true })).toBe(false);
    expect(canUseAi("editor", { can_download: true, can_use_ai: false })).toBe(false);
  });

  it("offer only allowed status changes", () => {
    expect(allowedStatusChanges("admin", "active")).toEqual(["suspended", "deactivated"]);
    expect(allowedStatusChanges("admin", "suspended")).toEqual(["active", "deactivated"]);
    expect(allowedStatusChanges("admin", "deactivated")).toEqual([]);
    expect(allowedStatusChanges("super_admin", "deactivated")).toEqual(["active"]);
  });
});

describe("navigation", () => {
  it("has the ten sections in order", () => {
    expect(NAV_ITEMS.map((n) => n.label)).toEqual([
      "Dashboard", "Create Video", "Generate 6 Videos", "My Listings", "My Videos", "Company Library", "Templates", "Camera Studio", "AI Effects", "Admin Panel",
    ]);
  });

  it("shows the Admin Panel only to administrators", () => {
    expect(navForRole("editor").map((n) => n.href)).not.toContain("/admin");
    expect(navForRole("admin").map((n) => n.href)).toContain("/admin");
    // AI Effects isn't built yet, so it's never in the menu; Camera Studio is in Advanced Mode only
    expect(navForRole("super_admin").length).toBe(9);
    expect(navForRole("editor", "easy").map((n) => n.href)).toEqual(["/dashboard", "/create", "/generate", "/listings", "/videos", "/library", "/templates"]);
    expect(navForRole("editor", "advanced").map((n) => n.href)).toContain("/camera-studio");
  });

  it("hides creation tools from viewers", () => {
    expect(navForRole("viewer").map((n) => n.href)).toEqual(["/dashboard", "/listings", "/videos", "/library", "/templates"]);
    expect(navForRole(null)).toEqual([]);
  });

  it("marks nested pages active", () => {
    expect(isActivePath("/listings/123", "/listings")).toBe(true);
    expect(isActivePath("/listingsx", "/listings")).toBe(false);
  });
});
