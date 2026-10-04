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
import { changeCompanyStage } from "../../src/app/(dashboard)/companies/actions";
import { logVisit } from "../../src/app/(dashboard)/companies/[id]/activities/actions";
import { setSalesTrack } from "../../src/app/(dashboard)/companies/[id]/sales-process/actions";
import { saveSalesTarget } from "../../src/app/(dashboard)/manager/actions";
import { updateStagePlaybook } from "../../src/app/(dashboard)/settings/pipeline-stages/actions";
import { updateBarIntel } from "../../src/app/(dashboard)/companies/[id]/bar-intel/actions";
import { getRepScores, DEFAULT_TARGETS } from "../../src/lib/sales/scoreboard";
import { isForwardMove } from "../../src/lib/companies/sales-process";

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
});

async function setup(permissions: string[] = ["view_assigned_leads", "edit_leads"]) {
  const role = await createRoleWithPermissions("Rep", permissions);
  const user = await createTestUser({ roleId: role.id });
  const leadType = await createLeadTypeFixture();
  const target = await createPipelineStageFixture("Target", { isDefault: true, sortOrder: 0, processStep: "TARGET" });
  const introduced = await createPipelineStageFixture("Introduced", { sortOrder: 1, processStep: "INTRODUCED" });
  const demoBooked = await createPipelineStageFixture("Demo Booked", { sortOrder: 2, processStep: "DEMO_BOOKED" });
  const trialBooked = await createPipelineStageFixture("Trial Booked", { sortOrder: 4, processStep: "TRIAL_BOOKED" });
  const trialLive = await createPipelineStageFixture("Trial Live", { sortOrder: 5, processStep: "TRIAL_LIVE" });
  const lost = await createPipelineStageFixture("Lost", { sortOrder: 7, outcomeType: "LOST" });
  const company = await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: target.id, assignedToId: user.id, createdById: user.id });
  await loginAs(user.id);

  await testPrisma.pipelineStageTask.createMany({
    data: [
      { stageId: introduced.id, track: "LOCAL", title: "Follow up to book a demo", daysAfter: 2 },
      { stageId: introduced.id, track: "REMOTE", title: "Follow up: book a demo or start a trial", daysAfter: 2 },
      { stageId: trialLive.id, track: null, title: "Trial week 2 check-in", daysAfter: 7 },
    ],
  });

  return { user, company, leadType, stages: { target, introduced, demoBooked, trialBooked, trialLive, lost } };
}

function visitForm(outcomeId: string): FormData {
  const formData = new FormData();
  formData.set("timezone", "America/Toronto");
  formData.set("outcomeId", outcomeId);
  return formData;
}

describe("automatic follow-ups on entering a step", () => {
  it("creates only the follow-ups for the company's track, assigned to its salesperson", async () => {
    const { user, company, stages } = await setup();

    expect(await changeCompanyStage(company.id, stages.introduced.id)).toEqual({ success: true });

    const tasks = await testPrisma.task.findMany({ where: { companyId: company.id } });
    expect(tasks.map((t) => t.title)).toEqual(["Follow up to book a demo"]);
    expect(tasks[0].assignedToId).toBe(user.id);
    const days = (tasks[0].dueAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(1.9);
    expect(days).toBeLessThan(2.1);
  });

  it("uses the long-distance follow-ups for a long-distance bar, and shared ones apply to both", async () => {
    const { company, stages } = await setup();
    await testPrisma.company.update({ where: { id: company.id }, data: { salesTrack: "REMOTE" } });

    await changeCompanyStage(company.id, stages.introduced.id);
    await changeCompanyStage(company.id, stages.trialLive.id);

    const titles = (await testPrisma.task.findMany({ where: { companyId: company.id }, orderBy: { dueAt: "asc" } })).map((t) => t.title);
    expect(titles).toEqual(["Follow up: book a demo or start a trial", "Trial week 2 check-in"]);
  });

  it("lets a long-distance bar skip straight to Trial Booked", async () => {
    const { company, stages } = await setup();
    await testPrisma.company.update({ where: { id: company.id }, data: { salesTrack: "REMOTE" } });

    expect(await changeCompanyStage(company.id, stages.trialBooked.id)).toEqual({ success: true });
    const updated = await testPrisma.company.findUniqueOrThrow({ where: { id: company.id } });
    expect(updated.pipelineStageId).toBe(stages.trialBooked.id);
  });
});

describe("outcome-driven stage moves", () => {
  it("moves forward, and the new step's follow-ups replace the outcome's own follow-up", async () => {
    const { company, stages } = await setup();
    const flyer = await testPrisma.callOutcome.create({
      data: {
        name: "Flyer Dropped (Owner Not In)",
        appliesToCalls: false,
        appliesToVisits: true,
        requiresNextAction: true,
        defaultNextActionDays: 2,
        defaultNextActionTitle: "Call to book a demo",
        defaultPipelineStageId: stages.introduced.id,
      },
    });

    expect(await logVisit(company.id, visitForm(flyer.id))).toMatchObject({ ok: true });

    const updated = await testPrisma.company.findUniqueOrThrow({ where: { id: company.id } });
    expect(updated.pipelineStageId).toBe(stages.introduced.id);
    const titles = (await testPrisma.task.findMany({ where: { companyId: company.id } })).map((t) => t.title);
    expect(titles).toEqual(["Follow up to book a demo"]);
  });

  it("never moves a bar backwards, but still creates the outcome's follow-up", async () => {
    const { company, stages } = await setup();
    await testPrisma.company.update({ where: { id: company.id }, data: { pipelineStageId: stages.trialLive.id } });
    const flyer = await testPrisma.callOutcome.create({
      data: {
        name: "Flyer Dropped (Owner Not In)",
        appliesToCalls: false,
        appliesToVisits: true,
        requiresNextAction: true,
        defaultNextActionDays: 2,
        defaultNextActionTitle: "Call to book a demo",
        defaultPipelineStageId: stages.introduced.id,
      },
    });

    await logVisit(company.id, visitForm(flyer.id));

    const updated = await testPrisma.company.findUniqueOrThrow({ where: { id: company.id } });
    expect(updated.pipelineStageId).toBe(stages.trialLive.id);
    expect(await testPrisma.pipelineStageHistory.count({ where: { companyId: company.id } })).toBe(0);
    const titles = (await testPrisma.task.findMany({ where: { companyId: company.id } })).map((t) => t.title);
    expect(titles).toEqual(["Call to book a demo"]);
  });

  it("isForwardMove: forward only among open steps; Won/Lost from any open step; never out of Won/Lost", () => {
    expect(isForwardMove({ sortOrder: 1, outcomeType: null }, { sortOrder: 2, outcomeType: null })).toBe(true);
    expect(isForwardMove({ sortOrder: 2, outcomeType: null }, { sortOrder: 1, outcomeType: null })).toBe(false);
    expect(isForwardMove({ sortOrder: 2, outcomeType: null }, { sortOrder: 2, outcomeType: null })).toBe(false);
    expect(isForwardMove({ sortOrder: 9, outcomeType: null }, { sortOrder: 7, outcomeType: "LOST" })).toBe(true);
    expect(isForwardMove({ sortOrder: 7, outcomeType: "LOST" }, { sortOrder: 9, outcomeType: null })).toBe(false);
  });
});

describe("setSalesTrack", () => {
  it("switches a bar between Local and Long-distance and rejects anything else", async () => {
    const { company } = await setup();

    expect(await setSalesTrack(company.id, "REMOTE")).toBeUndefined();
    expect((await testPrisma.company.findUniqueOrThrow({ where: { id: company.id } })).salesTrack).toBe("REMOTE");
    expect(await setSalesTrack(company.id, "SOMEWHERE")).toEqual({ error: "Choose Local or Long-distance." });
  });
});

describe("sales scoreboard", () => {
  it("counts today's visits and step entries per rep, remote-only intros, once per bar", async () => {
    const { user, company, leadType, stages } = await setup();
    const remote = await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stages.target.id, assignedToId: user.id, createdById: user.id });
    await testPrisma.company.update({ where: { id: remote.id }, data: { salesTrack: "REMOTE" } });

    await testPrisma.activity.createMany({
      data: [
        { companyId: company.id, userId: user.id, type: "VISIT" },
        { companyId: company.id, userId: user.id, type: "VISIT" },
        { companyId: company.id, userId: user.id, type: "PHONE" },
      ],
    });
    await changeCompanyStage(company.id, stages.introduced.id); // local: not an intro
    await changeCompanyStage(remote.id, stages.introduced.id); // remote: an intro
    await changeCompanyStage(company.id, stages.demoBooked.id);
    await changeCompanyStage(company.id, stages.introduced.id);
    await changeCompanyStage(company.id, stages.demoBooked.id); // same bar again: still 1

    const [score] = await getRepScores([user.id]);
    expect(score.today).toEqual({ visits: 2, intros: 1, demosBooked: 1, demosHeld: 0, trialsBooked: 0 });
    expect(score.week.visits).toBe(2);
    expect(score.targets).toEqual(DEFAULT_TARGETS);
  });

  it("counts 'today' in the rep's own timezone", async () => {
    const { user, company } = await setup();
    await testPrisma.user.update({ where: { id: user.id }, data: { timezone: "America/Denver" } });
    // 2026-10-05 05:30 UTC = Oct 4, 23:30 in Denver, but already Oct 5 in Toronto.
    await testPrisma.activity.create({ data: { companyId: company.id, userId: user.id, type: "VISIT", occurredAt: new Date("2026-10-05T05:30:00Z") } });

    const denverOct4 = new Date("2026-10-05T03:00:00Z");
    const denverOct5 = new Date("2026-10-05T18:00:00Z");
    expect((await getRepScores([user.id], denverOct4))[0].today.visits).toBe(1);
    expect((await getRepScores([user.id], denverOct5))[0].today.visits).toBe(0);
  });
});

describe("saveSalesTarget", () => {
  it("lets a manager set a rep's goals and timezone, with validation", async () => {
    const managerRole = await createRoleWithPermissions("Manager", ["view_manager_workspace"]);
    const manager = await createTestUser({ roleId: managerRole.id });
    const repRole = await createRoleWithPermissions("Rep", ["edit_leads"]);
    const rep = await createTestUser({ roleId: repRole.id });
    await loginAs(manager.id);

    const form = new FormData();
    for (const [key, value] of Object.entries({ visits: "8", intros: "0", demosBooked: "2", demosHeld: "2", trialsBooked: "1", timezone: "America/Denver" })) {
      form.set(key, value);
    }
    expect(await saveSalesTarget(rep.id, form)).toBeUndefined();
    expect(await testPrisma.salesTarget.findUniqueOrThrow({ where: { userId: rep.id } })).toMatchObject({ visits: 8, trialsBooked: 1 });
    expect((await testPrisma.user.findUniqueOrThrow({ where: { id: rep.id } })).timezone).toBe("America/Denver");

    form.set("visits", "-1");
    expect(await saveSalesTarget(rep.id, form)).toEqual({ error: "Goals must be whole numbers from 0 to 500." });
    form.set("visits", "8");
    form.set("timezone", "Mars/Olympus");
    expect(await saveSalesTarget(rep.id, form)).toEqual({ error: "Choose a valid timezone." });
  });

  it("refuses a user without the manager permission", async () => {
    const repRole = await createRoleWithPermissions("Rep", ["edit_leads"]);
    const rep = await createTestUser({ roleId: repRole.id });
    await loginAs(rep.id);

    await expect(saveSalesTarget(rep.id, new FormData())).rejects.toThrow();
  });
});

describe("step descriptions and trivia history", () => {
  it("saves a step's description with its checklists", async () => {
    const adminRole = await createRoleWithPermissions("Admin", ["manage_settings"]);
    const admin = await createTestUser({ roleId: adminRole.id });
    const stage = await createPipelineStageFixture("Target", { processStep: "TARGET" });
    await loginAs(admin.id);

    const form = new FormData();
    form.set("description", "  A bar we want to sell to.  ");
    form.set("playbookLocal", "Get the manager's phone and email");
    form.set("playbookRemote", "");
    expect(await updateStagePlaybook(stage.id, form)).toBeUndefined();
    expect(await testPrisma.pipelineStage.findUniqueOrThrow({ where: { id: stage.id } })).toMatchObject({
      description: "A bar we want to sell to.",
      playbookLocal: "Get the manager's phone and email",
      playbookRemote: null,
    });

    form.set("description", "x".repeat(1001));
    expect(await updateStagePlaybook(stage.id, form)).toEqual({ error: "Keep the description under 1000 characters." });
  });

  it("saves and clears trivia history from the Bar intel card", async () => {
    const { company } = await setup();
    const form = new FormData();
    form.set("triviaHistory", "Ran trivia on Tuesdays until spring");
    expect(await updateBarIntel(company.id, form)).toBeUndefined();
    expect((await testPrisma.company.findUniqueOrThrow({ where: { id: company.id } })).triviaHistory).toBe("Ran trivia on Tuesdays until spring");

    form.set("triviaHistory", "");
    await updateBarIntel(company.id, form);
    expect((await testPrisma.company.findUniqueOrThrow({ where: { id: company.id } })).triviaHistory).toBeNull();
  });
});
