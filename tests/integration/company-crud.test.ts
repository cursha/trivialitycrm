import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import {
  createRoleWithPermissions,
  createTestUser,
  createLeadTypeFixture,
  createPipelineStageFixture,
  loginAs,
} from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { RedirectSignal } from "../setup/mock-next";
import { createCompany, updateCompany, archiveCompany, restoreCompany, permanentlyDeleteCompany } from "../../src/app/(dashboard)/companies/actions";

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
});

async function baseFixtures() {
  const adminRole = await createRoleWithPermissions("Administrator", [
    "view_all_leads",
    "add_leads",
    "edit_leads",
    "delete_leads",
    "reassign_leads",
    "restore_archived_leads",
  ]);
  const salespersonRole = await createRoleWithPermissions("Salesperson", ["view_assigned_leads", "add_leads", "edit_leads"]);

  const admin = await createTestUser({ name: "Admin", roleId: adminRole.id });
  const salesperson = await createTestUser({ name: "Sales One", roleId: salespersonRole.id });

  const leadType = await createLeadTypeFixture("Pub");
  const stageNew = await createPipelineStageFixture("New", { isDefault: true, sortOrder: 0 });
  const stageDemo = await createPipelineStageFixture("Demo Given", { sortOrder: 1 });

  return { admin, salesperson, leadType, stageNew, stageDemo };
}

function companyFormData(overrides: Record<string, string> = {}) {
  const fd = new FormData();
  const defaults: Record<string, string> = {
    name: "The Copper Kettle",
    city: "Milton",
    region: "ON",
    country: "Canada",
    triviaStatus: "UNCERTAIN",
  };
  for (const [key, value] of Object.entries({ ...defaults, ...overrides })) {
    fd.set(key, value);
  }
  return fd;
}

describe("company create", () => {
  it("creates a company and redirects to its detail page", async () => {
    const { admin, leadType, stageNew } = await baseFixtures();
    await loginAs(admin.id);

    const fd = companyFormData({ leadTypeId: leadType.id, pipelineStageId: stageNew.id, assignedToId: admin.id });

    let redirectUrl: string | undefined;
    try {
      await createCompany(undefined, fd);
      expect.fail("expected createCompany to redirect on success");
    } catch (error) {
      redirectUrl = (error as RedirectSignal).url;
    }

    const company = await testPrisma.company.findFirstOrThrow({ where: { name: "The Copper Kettle" } });
    expect(redirectUrl).toBe(`/companies/${company.id}`);
    expect(company.normalizedName).toBe("the copper kettle");
    expect(company.status).toBe("ACTIVE");
    expect(company.createdById).toBe(admin.id);
  });

  it("blocks creation without add_leads permission", async () => {
    const viewerRole = await createRoleWithPermissions("Viewer", ["view_all_leads"]);
    const viewer = await createTestUser({ roleId: viewerRole.id });
    await loginAs(viewer.id);

    const leadType = await createLeadTypeFixture();
    const stage = await createPipelineStageFixture();
    const fd = companyFormData({ leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: viewer.id });

    await expect(createCompany(undefined, fd)).rejects.toThrow(/Forbidden/);
    expect(await testPrisma.company.count()).toBe(0);
  });

  it("flags a likely duplicate instead of silently creating a second record", async () => {
    const { admin, leadType, stageNew } = await baseFixtures();
    await loginAs(admin.id);

    const fd1 = companyFormData({ leadTypeId: leadType.id, pipelineStageId: stageNew.id, assignedToId: admin.id });
    try {
      await createCompany(undefined, fd1);
    } catch {
      // redirect throws on success — expected
    }

    const fd2 = companyFormData({
      name: "The Copper Kettle",
      leadTypeId: leadType.id,
      pipelineStageId: stageNew.id,
      assignedToId: admin.id,
    });
    const result = await createCompany(undefined, fd2);

    expect(result?.duplicates).toBeDefined();
    expect(result?.duplicates?.length).toBeGreaterThan(0);
    expect(result?.duplicates?.[0].matchedOn).toContain("name");
    expect(await testPrisma.company.count()).toBe(1);
  });

  it("lets an Administrator override a duplicate with explicit confirmation", async () => {
    const { admin, leadType, stageNew } = await baseFixtures();
    await loginAs(admin.id);

    const fd1 = companyFormData({ leadTypeId: leadType.id, pipelineStageId: stageNew.id, assignedToId: admin.id });
    try {
      await createCompany(undefined, fd1);
    } catch {
      /* redirect */
    }

    const fd2 = companyFormData({
      name: "The Copper Kettle",
      leadTypeId: leadType.id,
      pipelineStageId: stageNew.id,
      assignedToId: admin.id,
      overrideDuplicates: "true",
    });

    await expect(createCompany(undefined, fd2)).rejects.toBeInstanceOf(RedirectSignal);
    expect(await testPrisma.company.count()).toBe(2);
  });

  it("refuses a non-Administrator's duplicate override", async () => {
    const { admin, salesperson, leadType, stageNew } = await baseFixtures();
    await loginAs(admin.id);
    const fd1 = companyFormData({ leadTypeId: leadType.id, pipelineStageId: stageNew.id, assignedToId: admin.id });
    try {
      await createCompany(undefined, fd1);
    } catch {
      /* redirect */
    }

    resetFakeCookies();
    await loginAs(salesperson.id);
    const fd2 = companyFormData({
      name: "The Copper Kettle",
      leadTypeId: leadType.id,
      pipelineStageId: stageNew.id,
      assignedToId: salesperson.id,
      overrideDuplicates: "true",
    });

    const result = await createCompany(undefined, fd2);
    expect(result?.error).toMatch(/Only an Administrator/);
    expect(await testPrisma.company.count()).toBe(1);
  });
});

describe("company edit and automatic Pipeline Change activity", () => {
  it("logs a Pipeline Change activity automatically when the stage changes", async () => {
    const { admin, leadType, stageNew, stageDemo } = await baseFixtures();
    await loginAs(admin.id);

    const company = await testPrisma.company.create({
      data: {
        name: "Stonehouse Tavern",
        normalizedName: "stonehouse tavern",
        city: "Burlington",
        region: "ON",
        country: "Canada",
        leadTypeId: leadType.id,
        pipelineStageId: stageNew.id,
        assignedToId: admin.id,
        createdById: admin.id,
      },
    });

    const fd = companyFormData({
      name: company.name,
      leadTypeId: leadType.id,
      pipelineStageId: stageDemo.id,
      assignedToId: admin.id,
      overrideDuplicates: "true",
    });

    await expect(updateCompany(company.id, undefined, fd)).rejects.toBeInstanceOf(RedirectSignal);

    const activities = await testPrisma.activity.findMany({ where: { companyId: company.id, type: "PIPELINE_CHANGE" } });
    expect(activities).toHaveLength(1);
    expect(activities[0].notes).toContain("New");
    expect(activities[0].notes).toContain("Demo Given");

    const updated = await testPrisma.company.findUniqueOrThrow({ where: { id: company.id } });
    expect(updated.pipelineStageId).toBe(stageDemo.id);
    expect(updated.updatedById).toBe(admin.id);
  });

  it("does not log a Pipeline Change activity when the stage is unchanged", async () => {
    const { admin, leadType, stageNew } = await baseFixtures();
    await loginAs(admin.id);

    const company = await testPrisma.company.create({
      data: {
        name: "North End Social",
        normalizedName: "north end social",
        city: "Hamilton",
        region: "ON",
        country: "Canada",
        leadTypeId: leadType.id,
        pipelineStageId: stageNew.id,
        assignedToId: admin.id,
        createdById: admin.id,
      },
    });

    const fd = companyFormData({
      name: company.name,
      notes: "Updated notes only",
      leadTypeId: leadType.id,
      pipelineStageId: stageNew.id,
      assignedToId: admin.id,
      overrideDuplicates: "true",
    });

    await expect(updateCompany(company.id, undefined, fd)).rejects.toBeInstanceOf(RedirectSignal);

    const activities = await testPrisma.activity.findMany({ where: { companyId: company.id } });
    expect(activities).toHaveLength(0);
  });

  it("blocks a Salesperson from editing a company outside their scope", async () => {
    const { admin, salesperson, leadType, stageNew } = await baseFixtures();
    await loginAs(admin.id);

    const otherPerson = await testPrisma.user.create({
      data: {
        name: "Other Rep",
        email: "other@example.test",
        passwordHash: "not-used-in-this-test",
        roleId: salesperson.roleId,
      },
    });

    const company = await testPrisma.company.create({
      data: {
        name: "Someone Else's Lead",
        normalizedName: "someone elses lead",
        city: "Oakville",
        region: "ON",
        country: "Canada",
        leadTypeId: leadType.id,
        pipelineStageId: stageNew.id,
        assignedToId: otherPerson.id,
        createdById: admin.id,
      },
    });

    resetFakeCookies();
    await loginAs(salesperson.id);

    const fd = companyFormData({
      name: company.name,
      leadTypeId: leadType.id,
      pipelineStageId: stageNew.id,
      assignedToId: otherPerson.id,
    });

    const result = await updateCompany(company.id, undefined, fd);
    expect(result?.error).toMatch(/do not have access/);
  });

  it("requires reassign_leads to change the assigned salesperson", async () => {
    const editOnlyRole = await createRoleWithPermissions("EditOnly", ["view_all_leads", "edit_leads"]);
    const editor = await createTestUser({ roleId: editOnlyRole.id });
    const { leadType, stageNew } = await baseFixtures();

    const otherAssignee = await testPrisma.user.create({
      data: { name: "New Owner", email: "newowner@example.test", passwordHash: "x", roleId: editOnlyRole.id },
    });

    const company = await testPrisma.company.create({
      data: {
        name: "Reassign Test Co",
        normalizedName: "reassign test co",
        city: "Guelph",
        region: "ON",
        country: "Canada",
        leadTypeId: leadType.id,
        pipelineStageId: stageNew.id,
        assignedToId: editor.id,
        createdById: editor.id,
      },
    });

    await loginAs(editor.id);
    const fd = companyFormData({
      name: company.name,
      leadTypeId: leadType.id,
      pipelineStageId: stageNew.id,
      assignedToId: otherAssignee.id,
    });

    await expect(updateCompany(company.id, undefined, fd)).rejects.toThrow(/Forbidden/);
  });
});

describe("company archive / restore / permanent delete", () => {
  it("archive preserves the record and its related data", async () => {
    const { admin, leadType, stageNew } = await baseFixtures();
    await loginAs(admin.id);

    const company = await testPrisma.company.create({
      data: {
        name: "Archive Me",
        normalizedName: "archive me",
        city: "Milton",
        region: "ON",
        country: "Canada",
        leadTypeId: leadType.id,
        pipelineStageId: stageNew.id,
        assignedToId: admin.id,
        createdById: admin.id,
        contacts: { create: { firstName: "Jamie", lastName: "Rivera" } },
      },
    });

    const result = await archiveCompany(company.id);
    expect(result).toBeUndefined();

    const archived = await testPrisma.company.findUniqueOrThrow({ where: { id: company.id } });
    expect(archived.status).toBe("ARCHIVED");
    expect(archived.archivedById).toBe(admin.id);
    expect(archived.archivedAt).not.toBeNull();

    const contacts = await testPrisma.contact.findMany({ where: { companyId: company.id } });
    expect(contacts).toHaveLength(1);
  });

  it("restore makes the company active again", async () => {
    const { admin, leadType, stageNew } = await baseFixtures();
    await loginAs(admin.id);

    const company = await testPrisma.company.create({
      data: {
        name: "Restore Me",
        normalizedName: "restore me",
        city: "Milton",
        region: "ON",
        country: "Canada",
        leadTypeId: leadType.id,
        pipelineStageId: stageNew.id,
        assignedToId: admin.id,
        createdById: admin.id,
        status: "ARCHIVED",
        archivedAt: new Date(),
        archivedById: admin.id,
      },
    });

    await restoreCompany(company.id);

    const restored = await testPrisma.company.findUniqueOrThrow({ where: { id: company.id } });
    expect(restored.status).toBe("ACTIVE");
    expect(restored.archivedAt).toBeNull();
  });

  it("only an Administrator can permanently delete, and only once archived", async () => {
    const { admin, salesperson, leadType, stageNew } = await baseFixtures();

    const activeCompany = await testPrisma.company.create({
      data: {
        name: "Still Active",
        normalizedName: "still active",
        city: "Milton",
        region: "ON",
        country: "Canada",
        leadTypeId: leadType.id,
        pipelineStageId: stageNew.id,
        assignedToId: admin.id,
        createdById: admin.id,
      },
    });

    await loginAs(admin.id);
    const activeResult = await permanentlyDeleteCompany(activeCompany.id);
    expect(activeResult?.error).toMatch(/Archive this company/);
    expect(await testPrisma.company.count({ where: { id: activeCompany.id } })).toBe(1);

    const archivedCompany = await testPrisma.company.create({
      data: {
        name: "Archived Already",
        normalizedName: "archived already",
        city: "Milton",
        region: "ON",
        country: "Canada",
        leadTypeId: leadType.id,
        pipelineStageId: stageNew.id,
        assignedToId: admin.id,
        createdById: admin.id,
        status: "ARCHIVED",
        archivedAt: new Date(),
      },
    });

    resetFakeCookies();
    await loginAs(salesperson.id);
    const nonAdminResult = await permanentlyDeleteCompany(archivedCompany.id).catch((e) => {
      // Salesperson lacks delete_leads entirely in this test's role setup,
      // so requirePermission throws before the Administrator-role check.
      expect(String(e)).toMatch(/Forbidden/);
      return undefined;
    });
    expect(nonAdminResult).toBeUndefined();
    expect(await testPrisma.company.count({ where: { id: archivedCompany.id } })).toBe(1);

    resetFakeCookies();
    await loginAs(admin.id);
    await expect(permanentlyDeleteCompany(archivedCompany.id)).rejects.toBeInstanceOf(RedirectSignal);
    expect(await testPrisma.company.count({ where: { id: archivedCompany.id } })).toBe(0);
  });
});
