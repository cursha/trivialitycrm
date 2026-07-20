import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, createLeadTypeFixture, createPipelineStageFixture, createCompanyFixture, loginAs } from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { getCurrentUser } from "../../src/lib/auth/current-user";
import { listOverdueTasks, listDueTodayTasks, listUpcomingTasks } from "../../src/app/(dashboard)/follow-ups/queries";

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
});

describe("follow-up queries exclude tasks belonging to archived companies", () => {
  it("does not surface an overdue task whose company has since been archived", async () => {
    const role = await createRoleWithPermissions("Full", ["view_all_leads"]);
    const user = await createTestUser({ roleId: role.id });
    const leadType = await createLeadTypeFixture();
    const stage = await createPipelineStageFixture();
    const company = await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: user.id, createdById: user.id, status: "ARCHIVED" });

    await testPrisma.task.create({
      data: {
        companyId: company.id,
        assignedToId: user.id,
        title: "Call back",
        dueAt: new Date("2020-01-01"),
        status: "OPEN",
      },
    });

    await loginAs(user.id);
    const authedUser = await getCurrentUser();
    const overdue = await listOverdueTasks(authedUser!);
    expect(overdue).toHaveLength(0);
  });

  it("still surfaces an overdue task for an ACTIVE company", async () => {
    const role = await createRoleWithPermissions("Full", ["view_all_leads"]);
    const user = await createTestUser({ roleId: role.id });
    const leadType = await createLeadTypeFixture();
    const stage = await createPipelineStageFixture();
    const company = await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: user.id, createdById: user.id });

    await testPrisma.task.create({
      data: { companyId: company.id, assignedToId: user.id, title: "Call back", dueAt: new Date("2020-01-01"), status: "OPEN" },
    });

    await loginAs(user.id);
    const authedUser = await getCurrentUser();
    const overdue = await listOverdueTasks(authedUser!);
    expect(overdue).toHaveLength(1);
  });

  it("also excludes archived-company tasks from due-today and upcoming", async () => {
    const role = await createRoleWithPermissions("Full", ["view_all_leads"]);
    const user = await createTestUser({ roleId: role.id });
    const leadType = await createLeadTypeFixture();
    const stage = await createPipelineStageFixture();
    const company = await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: user.id, createdById: user.id, status: "ARCHIVED" });

    const now = new Date();
    const farFuture = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);
    await testPrisma.task.create({
      data: { companyId: company.id, assignedToId: user.id, title: "Today", dueAt: now, status: "OPEN" },
    });
    await testPrisma.task.create({
      data: { companyId: company.id, assignedToId: user.id, title: "Later", dueAt: farFuture, status: "OPEN" },
    });

    await loginAs(user.id);
    const authedUser = await getCurrentUser();
    expect(await listDueTodayTasks(authedUser!)).toHaveLength(0);
    expect(await listUpcomingTasks(authedUser!)).toHaveLength(0);
  });
});
