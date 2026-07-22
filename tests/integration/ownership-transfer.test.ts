import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, createLeadTypeFixture, createPipelineStageFixture, createCompanyFixture, loginAs } from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { transferUserOwnership, fetchOwnershipSummary } from "../../src/app/(dashboard)/settings/users/actions";
import { transferOwnership, OwnershipTransferError } from "../../src/lib/administration/user-safety";

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
});

async function baseFixtures() {
  const adminRole = await createRoleWithPermissions("Administrator", ["view_all_leads", "edit_leads", "manage_users"]);
  const admin = await createTestUser({ roleId: adminRole.id });
  const salespersonRole = await createRoleWithPermissions("Salesperson", ["view_assigned_leads"]);
  const fromUser = await createTestUser({ roleId: salespersonRole.id, email: "from@example.test" });
  const toUser = await createTestUser({ roleId: salespersonRole.id, email: "to@example.test" });
  const leadType = await createLeadTypeFixture();
  const stage = await createPipelineStageFixture();
  return { admin, fromUser, toUser, leadType, stage };
}

describe("ownership transfer", () => {
  it("requires manage_users", async () => {
    const role = await createRoleWithPermissions("Salesperson", ["view_assigned_leads"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);

    await expect(transferUserOwnership("a", "b")).rejects.toThrow();
  });

  it("reassigns active companies and open tasks, transactionally, and records an audit trail", async () => {
    const { admin, fromUser, toUser, leadType, stage } = await baseFixtures();
    await loginAs(admin.id);

    const company = await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: fromUser.id, createdById: admin.id });
    const task = await testPrisma.task.create({ data: { companyId: company.id, assignedToId: fromUser.id, title: "Follow up", dueAt: new Date() } });

    const result = await transferUserOwnership(fromUser.id, toUser.id);
    expect(result?.error).toBeUndefined();

    const updatedCompany = await testPrisma.company.findUniqueOrThrow({ where: { id: company.id } });
    expect(updatedCompany.assignedToId).toBe(toUser.id);

    const updatedTask = await testPrisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(updatedTask.assignedToId).toBe(toUser.id);

    const auditEvents = await testPrisma.auditEvent.findMany({ where: { module: "ownership" } });
    expect(auditEvents).toHaveLength(2);
    expect(auditEvents[0].correlationId).toBe(auditEvents[1].correlationId);
  });

  it("does not reassign a completed task or an archived company", async () => {
    const { admin, fromUser, toUser, leadType, stage } = await baseFixtures();

    const activeCompany = await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: fromUser.id, createdById: admin.id });
    const archivedCompany = await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: fromUser.id, createdById: admin.id, status: "ARCHIVED" });
    const openTask = await testPrisma.task.create({ data: { companyId: activeCompany.id, assignedToId: fromUser.id, title: "Open", dueAt: new Date() } });
    const doneTask = await testPrisma.task.create({ data: { companyId: activeCompany.id, assignedToId: fromUser.id, title: "Done", dueAt: new Date(), status: "COMPLETED" } });

    const result = await transferOwnership({ fromUserId: fromUser.id, toUserId: toUser.id, actorId: admin.id });
    expect(result.companyCount).toBe(1);
    expect(result.taskCount).toBe(1);

    expect((await testPrisma.company.findUniqueOrThrow({ where: { id: archivedCompany.id } })).assignedToId).toBe(fromUser.id);
    expect((await testPrisma.task.findUniqueOrThrow({ where: { id: doneTask.id } })).assignedToId).toBe(fromUser.id);
    expect((await testPrisma.company.findUniqueOrThrow({ where: { id: activeCompany.id } })).assignedToId).toBe(toUser.id);
    expect((await testPrisma.task.findUniqueOrThrow({ where: { id: openTask.id } })).assignedToId).toBe(toUser.id);
  });

  it("rejects transferring to a disabled user", async () => {
    const { admin, fromUser, toUser } = await baseFixtures();
    await testPrisma.user.update({ where: { id: toUser.id }, data: { disabled: true } });

    await expect(transferOwnership({ fromUserId: fromUser.id, toUserId: toUser.id, actorId: admin.id })).rejects.toThrow(OwnershipTransferError);
  });

  it("rejects transferring a user's ownership to themselves", async () => {
    const { admin, fromUser } = await baseFixtures();
    await expect(transferOwnership({ fromUserId: fromUser.id, toUserId: fromUser.id, actorId: admin.id })).rejects.toThrow(OwnershipTransferError);
  });

  it("reports a live ownership summary for the deactivation confirmation UI", async () => {
    const { admin, fromUser, leadType, stage } = await baseFixtures();
    await loginAs(admin.id);
    await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: fromUser.id, createdById: admin.id });

    const summary = await fetchOwnershipSummary(fromUser.id);
    expect(summary.companyCount).toBe(1);
    expect(summary.openTaskCount).toBe(0);
  });
});
