import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, loginAs } from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { createSavedView, updateSavedView, duplicateSavedView, archiveSavedView } from "../../src/app/(dashboard)/pipeline/actions";

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
});

describe("SavedView ownership and visibility", () => {
  it("lets any lead-viewer create a private view without any new permission", async () => {
    const role = await createRoleWithPermissions("Basic", ["view_assigned_leads"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);

    const result = await createSavedView({ name: "My Overdue", visibility: "PRIVATE", filters: { followUp: "overdue" } });

    expect("success" in result).toBe(true);
    const view = await testPrisma.savedView.findFirstOrThrow();
    expect(view.ownerId).toBe(user.id);
    expect(view.visibility).toBe("PRIVATE");
  });

  it("requires create_shared_views to create a SHARED view", async () => {
    const role = await createRoleWithPermissions("Basic", ["view_assigned_leads"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);

    await expect(createSavedView({ name: "Team View", visibility: "SHARED", filters: {} })).rejects.toThrow(/Forbidden/);
  });

  it("rejects filters that don't match the validated shape", async () => {
    const role = await createRoleWithPermissions("Basic", ["view_assigned_leads"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);

    const result = await createSavedView({ name: "Bad", visibility: "PRIVATE", filters: { notARealField: "x" } });
    expect(result).toEqual({ error: "Invalid filter selection." });
    expect(await testPrisma.savedView.count()).toBe(0);
  });

  it("prevents a non-owner from editing another user's private view", async () => {
    const role = await createRoleWithPermissions("Basic", ["view_assigned_leads"]);
    const owner = await createTestUser({ roleId: role.id });
    const intruder = await createTestUser({ roleId: role.id });

    await loginAs(owner.id);
    await createSavedView({ name: "Mine", visibility: "PRIVATE", filters: {} });
    const view = await testPrisma.savedView.findFirstOrThrow();

    resetFakeCookies();
    await loginAs(intruder.id);
    const result = await updateSavedView(view.id, { name: "Hijacked" });

    expect(result).toEqual({ error: "You do not have access to this saved view." });
    expect((await testPrisma.savedView.findUniqueOrThrow({ where: { id: view.id } })).name).toBe("Mine");
  });

  it("lets an Administrator edit any saved view", async () => {
    const role = await createRoleWithPermissions("Basic", ["view_assigned_leads"]);
    const owner = await createTestUser({ roleId: role.id });
    const adminRole = await createRoleWithPermissions("Administrator", ["view_all_leads"]);
    const admin = await createTestUser({ name: "Admin", roleId: adminRole.id });

    await loginAs(owner.id);
    await createSavedView({ name: "Mine", visibility: "PRIVATE", filters: {} });
    const view = await testPrisma.savedView.findFirstOrThrow();

    resetFakeCookies();
    await loginAs(admin.id);
    const result = await updateSavedView(view.id, { name: "Admin edited" });

    expect("success" in result).toBe(true);
  });

  it("duplicating a SHARED view always creates a new PRIVATE view owned by the duplicator", async () => {
    const sharedRole = await createRoleWithPermissions("Sharer", ["view_assigned_leads", "create_shared_views"]);
    const owner = await createTestUser({ roleId: sharedRole.id });
    const viewerRole = await createRoleWithPermissions("Viewer", ["view_assigned_leads"]);
    const viewer = await createTestUser({ roleId: viewerRole.id });

    await loginAs(owner.id);
    await createSavedView({ name: "Team Overdue", visibility: "SHARED", filters: {} });
    const original = await testPrisma.savedView.findFirstOrThrow();

    resetFakeCookies();
    await loginAs(viewer.id);
    const result = await duplicateSavedView(original.id);

    expect("success" in result).toBe(true);
    if ("success" in result) {
      const copy = await testPrisma.savedView.findUniqueOrThrow({ where: { id: result.id } });
      expect(copy.ownerId).toBe(viewer.id);
      expect(copy.visibility).toBe("PRIVATE");
    }
    // The original is untouched.
    expect((await testPrisma.savedView.findUniqueOrThrow({ where: { id: original.id } })).ownerId).toBe(owner.id);
  });

  it("only setting one default view per owner at a time", async () => {
    const role = await createRoleWithPermissions("Basic", ["view_assigned_leads"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);

    await createSavedView({ name: "First", visibility: "PRIVATE", isDefault: true, filters: {} });
    await createSavedView({ name: "Second", visibility: "PRIVATE", isDefault: true, filters: {} });

    const defaults = await testPrisma.savedView.findMany({ where: { ownerId: user.id, isDefault: true } });
    expect(defaults).toHaveLength(1);
    expect(defaults[0].name).toBe("Second");
  });

  it("archiving a view removes it from a normal listing query", async () => {
    const role = await createRoleWithPermissions("Basic", ["view_assigned_leads"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);

    await createSavedView({ name: "Temp", visibility: "PRIVATE", filters: {} });
    const view = await testPrisma.savedView.findFirstOrThrow();

    await archiveSavedView(view.id);

    const active = await testPrisma.savedView.findMany({ where: { archivedAt: null } });
    expect(active).toHaveLength(0);
  });
});
