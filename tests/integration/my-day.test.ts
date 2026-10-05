import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import {
  createRoleWithPermissions,
  createTestUser,
  createLeadTypeFixture,
  createPipelineStageFixture,
  createCompanyFixture,
  fetchAuthenticatedUser,
} from "../helpers/fixtures";
import { getMyDay } from "../../src/app/(dashboard)/my-day/queries";

beforeEach(async () => {
  await resetDatabase();
});

async function setup() {
  const role = await createRoleWithPermissions("Rep", ["view_assigned_leads", "edit_leads", "view_route_plan"]);
  const rep = await createTestUser({ roleId: role.id });
  const other = await createTestUser({ roleId: role.id });
  const leadType = await createLeadTypeFixture();
  const target = await createPipelineStageFixture("Target", { isDefault: true, sortOrder: 0, processStep: "TARGET" });
  const introduced = await createPipelineStageFixture("Introduced", { sortOrder: 1, processStep: "INTRODUCED" });
  const trialBooked = await createPipelineStageFixture("Trial Booked", { sortOrder: 4, processStep: "TRIAL_BOOKED" });
  const trialLive = await createPipelineStageFixture("Trial Live", { sortOrder: 5, processStep: "TRIAL_LIVE" });
  const make = (name: string, stageId: string, assignedToId = rep.id) =>
    createCompanyFixture({ name, leadTypeId: leadType.id, pipelineStageId: stageId, assignedToId, createdById: rep.id });
  return { rep, other, stages: { target, introduced, trialBooked, trialLive }, make };
}

describe("My Day", () => {
  it("lists the rep's own bars at each step, what's missing, and today's work", async () => {
    const { rep, other, stages, make } = await setup();

    const bare = await make("Bare Bar", stages.target.id);
    const complete = await make("Complete Bar", stages.target.id);
    await testPrisma.company.update({ where: { id: complete.id }, data: { triviaHistory: "Never run trivia" } });
    await testPrisma.contact.create({ data: { companyId: complete.id, firstName: "Sam", lastName: "Lee", phone: "905-555-0100" } });
    const remote = await make("Remote Bar", stages.target.id);
    await testPrisma.company.update({ where: { id: remote.id }, data: { salesTrack: "REMOTE" } });
    await make("Someone Else's Bar", stages.target.id, other.id);
    const intro = await make("Intro Bar", stages.introduced.id);
    await make("Booked Trial Bar", stages.trialBooked.id);
    await make("Live Trial Bar", stages.trialLive.id);

    const now = new Date();
    await testPrisma.task.createMany({
      data: [
        { companyId: intro.id, assignedToId: rep.id, title: "Overdue call", dueAt: new Date(now.getTime() - 3 * 86_400_000) },
        { companyId: intro.id, assignedToId: rep.id, title: "Next week", dueAt: new Date(now.getTime() + 7 * 86_400_000) },
      ],
    });
    await testPrisma.activity.create({ data: { companyId: bare.id, userId: rep.id, type: "VISIT" } });

    const data = await getMyDay(await fetchAuthenticatedUser(rep.id), now);
    expect(data).not.toBeNull();
    if (!data) return;

    expect(data.needInfo.companies.map((c) => [c.name, c.note]).sort()).toEqual([
      ["Bare Bar", "Missing manager contact and trivia history"],
      ["Remote Bar", "Missing manager contact and trivia history"],
    ]);
    // Only Local Target bars are suggested for the route.
    expect(data.readyToVisit?.companies.map((c) => c.name).sort()).toEqual(["Bare Bar", "Complete Bar"]);
    expect(data.visitsToday).toBe(1);
    expect(data.introduced.companies.map((c) => c.name)).toEqual(["Intro Bar"]);
    expect(data.tasks.items.map((t) => [t.title, t.overdue])).toEqual([["Overdue call", true]]);
    expect(data.trials.booked.map((c) => c.name)).toEqual(["Booked Trial Bar"]);
    expect(data.trials.live.map((c) => c.name)).toEqual(["Live Trial Bar"]);
    expect(data.score?.today.visits).toBe(1);
  });

  it("leaves out the route step for a rep without route plan access", async () => {
    const role = await createRoleWithPermissions("NoRoute", ["view_assigned_leads"]);
    const rep = await createTestUser({ roleId: role.id });
    const data = await getMyDay(await fetchAuthenticatedUser(rep.id));
    expect(data?.readyToVisit).toBeNull();
    expect(data?.routeCount).toBeNull();
  });
});
