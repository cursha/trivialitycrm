import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createCompanyFixture, createLeadTypeFixture, createPipelineStageFixture, createRoleWithPermissions, createTestUser } from "../helpers/fixtures";

// Company.nextFollowUpAt is kept by a Postgres trigger on "Task" (migration
// 20261007160000_company_next_follow_up_from_tasks): the earliest OPEN
// follow-up's due date, whatever code path changed the follow-ups.

beforeEach(async () => {
  await resetDatabase();
});

async function setup() {
  const role = await createRoleWithPermissions("Salesperson", []);
  const user = await createTestUser({ roleId: role.id });
  const leadType = await createLeadTypeFixture("Pubs");
  const stage = await createPipelineStageFixture();
  const make = (name: string) => createCompanyFixture({ name, leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: user.id, createdById: user.id });
  return { user, company: await make("The Crown"), other: await make("The Anchor") };
}

async function nextFollowUp(companyId: string) {
  return (await testPrisma.company.findUniqueOrThrow({ where: { id: companyId } })).nextFollowUpAt;
}

const MAY_1 = new Date("2026-05-01T12:00:00Z");
const JUNE_1 = new Date("2026-06-01T12:00:00Z");

describe("Company.nextFollowUpAt follows its open follow-ups", () => {
  it("is set when a follow-up is added and tracks the earliest open one", async () => {
    const { user, company } = await setup();
    expect(await nextFollowUp(company.id)).toBeNull();

    await testPrisma.task.create({ data: { companyId: company.id, assignedToId: user.id, title: "Call back", dueAt: JUNE_1 } });
    expect(await nextFollowUp(company.id)).toEqual(JUNE_1);

    const earlier = await testPrisma.task.create({ data: { companyId: company.id, assignedToId: user.id, title: "Drop in", dueAt: MAY_1 } });
    expect(await nextFollowUp(company.id)).toEqual(MAY_1);

    await testPrisma.task.update({ where: { id: earlier.id }, data: { status: "COMPLETED", completedAt: new Date() } });
    expect(await nextFollowUp(company.id)).toEqual(JUNE_1);
  });

  it("clears when the last open follow-up is cancelled or deleted, and follows a reschedule", async () => {
    const { user, company } = await setup();
    const task = await testPrisma.task.create({ data: { companyId: company.id, assignedToId: user.id, title: "Call back", dueAt: JUNE_1 } });

    await testPrisma.task.update({ where: { id: task.id }, data: { dueAt: MAY_1 } });
    expect(await nextFollowUp(company.id)).toEqual(MAY_1);

    await testPrisma.task.update({ where: { id: task.id }, data: { status: "CANCELLED" } });
    expect(await nextFollowUp(company.id)).toBeNull();

    const second = await testPrisma.task.create({ data: { companyId: company.id, assignedToId: user.id, title: "Again", dueAt: JUNE_1 } });
    await testPrisma.task.delete({ where: { id: second.id } });
    expect(await nextFollowUp(company.id)).toBeNull();
  });

  it("moves with a follow-up to another company (e.g. a merge)", async () => {
    const { user, company, other } = await setup();
    await testPrisma.task.create({ data: { companyId: company.id, assignedToId: user.id, title: "Call back", dueAt: JUNE_1 } });

    await testPrisma.task.updateMany({ where: { companyId: company.id }, data: { companyId: other.id } });

    expect(await nextFollowUp(company.id)).toBeNull();
    expect(await nextFollowUp(other.id)).toEqual(JUNE_1);
  });
});
