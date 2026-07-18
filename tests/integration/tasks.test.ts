import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import {
  createRoleWithPermissions,
  createTestUser,
  createLeadTypeFixture,
  createPipelineStageFixture,
  createCompanyFixture,
  loginAs,
} from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { createTask, completeTask, cancelTask } from "../../src/app/(dashboard)/companies/[id]/tasks/actions";
import {
  listOverdueTasks,
  listDueTodayTasks,
  listUpcomingTasks,
  listCompletedTasks,
  listCompaniesWithoutFollowUp,
} from "../../src/app/(dashboard)/follow-ups/queries";
import { getCurrentUser } from "../../src/lib/auth/current-user";

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
});

async function baseFixtures() {
  const role = await createRoleWithPermissions("Administrator", ["view_all_leads", "edit_leads"]);
  const admin = await createTestUser({ roleId: role.id });
  const leadType = await createLeadTypeFixture();
  const stage = await createPipelineStageFixture();
  const company = await createCompanyFixture({
    leadTypeId: leadType.id,
    pipelineStageId: stage.id,
    assignedToId: admin.id,
    createdById: admin.id,
  });
  return { admin, leadType, stage, company };
}

function isoDate(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

describe("follow-up completion", () => {
  it("marks a follow-up completed and records the completion date", async () => {
    const { admin, company } = await baseFixtures();
    await loginAs(admin.id);

    const createFd = new FormData();
    createFd.set("title", "Send trial materials");
    createFd.set("dueAt", isoDate(0));
    createFd.set("assignedToId", admin.id);
    await createTask(company.id, undefined, createFd);

    const task = await testPrisma.task.findFirstOrThrow({ where: { companyId: company.id } });
    expect(task.status).toBe("OPEN");

    await completeTask(company.id, task.id, new FormData());

    const completed = await testPrisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(completed.status).toBe("COMPLETED");
    expect(completed.completedAt).not.toBeNull();
  });

  it("can complete a follow-up and create the next one in the same action", async () => {
    const { admin, company } = await baseFixtures();
    await loginAs(admin.id);

    const createFd = new FormData();
    createFd.set("title", "Initial call");
    createFd.set("dueAt", isoDate(0));
    createFd.set("assignedToId", admin.id);
    await createTask(company.id, undefined, createFd);

    const task = await testPrisma.task.findFirstOrThrow({ where: { companyId: company.id } });

    const completeFd = new FormData();
    completeFd.set("createNext", "true");
    completeFd.set("next-title", "Follow-up demo");
    completeFd.set("next-dueAt", isoDate(7));
    completeFd.set("next-assignedToId", admin.id);
    await completeTask(company.id, task.id, completeFd);

    const allTasks = await testPrisma.task.findMany({ where: { companyId: company.id }, orderBy: { createdAt: "asc" } });
    expect(allTasks).toHaveLength(2);
    expect(allTasks[0].status).toBe("COMPLETED");
    expect(allTasks[1].status).toBe("OPEN");
    expect(allTasks[1].title).toBe("Follow-up demo");
  });

  it("cancelling a follow-up leaves it out of the open list", async () => {
    const { admin, company } = await baseFixtures();
    await loginAs(admin.id);

    const createFd = new FormData();
    createFd.set("title", "Maybe not needed");
    createFd.set("dueAt", isoDate(3));
    createFd.set("assignedToId", admin.id);
    await createTask(company.id, undefined, createFd);

    const task = await testPrisma.task.findFirstOrThrow({ where: { companyId: company.id } });
    await cancelTask(company.id, task.id);

    const cancelled = await testPrisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(cancelled.status).toBe("CANCELLED");
  });
});

describe("follow-up views", () => {
  it("buckets tasks into overdue, due today, and upcoming correctly", async () => {
    const { admin, company } = await baseFixtures();
    await loginAs(admin.id);
    const user = await getCurrentUser();

    await testPrisma.task.create({
      data: { companyId: company.id, assignedToId: admin.id, title: "Overdue one", dueAt: new Date(isoDate(-3)) },
    });
    await testPrisma.task.create({
      data: { companyId: company.id, assignedToId: admin.id, title: "Due today", dueAt: new Date() },
    });
    await testPrisma.task.create({
      data: { companyId: company.id, assignedToId: admin.id, title: "Upcoming one", dueAt: new Date(isoDate(10)) },
    });
    await testPrisma.task.create({
      data: {
        companyId: company.id,
        assignedToId: admin.id,
        title: "Already done",
        dueAt: new Date(isoDate(-10)),
        status: "COMPLETED",
        completedAt: new Date(),
      },
    });

    const overdue = await listOverdueTasks(user!);
    const today = await listDueTodayTasks(user!);
    const upcoming = await listUpcomingTasks(user!);
    const completed = await listCompletedTasks(user!);

    expect(overdue.map((t) => t.title)).toEqual(["Overdue one"]);
    expect(today.map((t) => t.title)).toEqual(["Due today"]);
    expect(upcoming.map((t) => t.title)).toEqual(["Upcoming one"]);
    expect(completed.map((t) => t.title)).toEqual(["Already done"]);
  });

  it("lists companies with no open follow-up", async () => {
    const { admin, leadType, stage, company } = await baseFixtures();
    await loginAs(admin.id);
    const user = await getCurrentUser();

    const companyWithFollowUp = await createCompanyFixture({
      name: "Has A Follow-up",
      leadTypeId: leadType.id,
      pipelineStageId: stage.id,
      assignedToId: admin.id,
      createdById: admin.id,
    });
    await testPrisma.task.create({
      data: { companyId: companyWithFollowUp.id, assignedToId: admin.id, title: "Scheduled", dueAt: new Date() },
    });

    const withoutFollowUp = await listCompaniesWithoutFollowUp(user!);
    const names = withoutFollowUp.map((c) => c.name);

    expect(names).toContain(company.name);
    expect(names).not.toContain(companyWithFollowUp.name);
  });
});
