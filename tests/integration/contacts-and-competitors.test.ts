import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import {
  createRoleWithPermissions,
  createTestUser,
  createLeadTypeFixture,
  createPipelineStageFixture,
  createCompetitorFixture,
  createCompanyFixture,
  loginAs,
} from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { createContact, updateContact, deleteContact } from "../../src/app/(dashboard)/companies/[id]/contacts/actions";

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
});

async function baseFixtures() {
  const role = await createRoleWithPermissions("Administrator", ["view_all_leads", "edit_leads"]);
  const admin = await createTestUser({ roleId: role.id });
  const leadType = await createLeadTypeFixture();
  const stage = await createPipelineStageFixture();
  return { admin, leadType, stage };
}

describe("multiple contacts per company", () => {
  it("allows adding several contacts to the same company", async () => {
    const { admin, leadType, stage } = await baseFixtures();
    await loginAs(admin.id);

    const company = await createCompanyFixture({
      leadTypeId: leadType.id,
      pipelineStageId: stage.id,
      assignedToId: admin.id,
      createdById: admin.id,
    });

    const fd1 = new FormData();
    fd1.set("firstName", "Jamie");
    fd1.set("lastName", "Rivera");
    await createContact(company.id, undefined, fd1);

    const fd2 = new FormData();
    fd2.set("firstName", "Chris");
    fd2.set("lastName", "Nguyen");
    await createContact(company.id, undefined, fd2);

    const contacts = await testPrisma.contact.findMany({ where: { companyId: company.id } });
    expect(contacts).toHaveLength(2);
    expect(contacts.map((c) => c.firstName).sort()).toEqual(["Chris", "Jamie"]);
  });

  it("edits and removes a contact independently of the others", async () => {
    const { admin, leadType, stage } = await baseFixtures();
    await loginAs(admin.id);

    const company = await createCompanyFixture({
      leadTypeId: leadType.id,
      pipelineStageId: stage.id,
      assignedToId: admin.id,
      createdById: admin.id,
    });

    const contactA = await testPrisma.contact.create({
      data: { companyId: company.id, firstName: "A", lastName: "One" },
    });
    const contactB = await testPrisma.contact.create({
      data: { companyId: company.id, firstName: "B", lastName: "Two" },
    });

    const updateFd = new FormData();
    updateFd.set("firstName", "A-updated");
    updateFd.set("lastName", "One");
    await updateContact(company.id, contactA.id, updateFd);

    await deleteContact(company.id, contactB.id);

    const remaining = await testPrisma.contact.findMany({ where: { companyId: company.id } });
    expect(remaining).toHaveLength(1);
    expect(remaining[0].firstName).toBe("A-updated");
  });

  it("blocks contact changes for a user outside the company's scope", async () => {
    const role = await createRoleWithPermissions("Salesperson", ["view_assigned_leads", "edit_leads"]);
    const owner = await createTestUser({ roleId: role.id });
    const outsider = await createTestUser({ roleId: role.id });
    const leadType = await createLeadTypeFixture();
    const stage = await createPipelineStageFixture();

    const company = await createCompanyFixture({
      leadTypeId: leadType.id,
      pipelineStageId: stage.id,
      assignedToId: owner.id,
      createdById: owner.id,
    });

    await loginAs(outsider.id);
    const fd = new FormData();
    fd.set("firstName", "Nope");
    fd.set("lastName", "Denied");

    await expect(createContact(company.id, undefined, fd)).rejects.toThrow(/Forbidden/);
  });
});

describe("competitor location count", () => {
  it("is calculated live from linked companies, never stored", async () => {
    const { admin, leadType, stage } = await baseFixtures();
    const competitor = await createCompetitorFixture("Geeks Who Drink");

    await createCompanyFixture({
      leadTypeId: leadType.id,
      pipelineStageId: stage.id,
      assignedToId: admin.id,
      createdById: admin.id,
      competitorId: competitor.id,
    });
    await createCompanyFixture({
      leadTypeId: leadType.id,
      pipelineStageId: stage.id,
      assignedToId: admin.id,
      createdById: admin.id,
      competitorId: competitor.id,
    });
    await createCompanyFixture({
      leadTypeId: leadType.id,
      pipelineStageId: stage.id,
      assignedToId: admin.id,
      createdById: admin.id,
      competitorId: null,
    });

    const withCount = await testPrisma.competitor.findUniqueOrThrow({
      where: { id: competitor.id },
      include: { _count: { select: { companies: true } } },
    });

    expect(withCount._count.companies).toBe(2);

    // Deleting one linked company should immediately change the live count
    // — there is no separately stored total to fall out of sync.
    const linked = await testPrisma.company.findFirst({ where: { competitorId: competitor.id } });
    await testPrisma.company.delete({ where: { id: linked!.id } });

    const afterDelete = await testPrisma.competitor.findUniqueOrThrow({
      where: { id: competitor.id },
      include: { _count: { select: { companies: true } } },
    });
    expect(afterDelete._count.companies).toBe(1);
  });
});
