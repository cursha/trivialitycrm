import { describe, it, expect, beforeEach } from "vitest";
import type { Job } from "pg-boss";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, createLeadTypeFixture, createPipelineStageFixture, createCompanyFixture, loginAs } from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { runReportsTick } from "../../worker/handlers/reports-tick";
import { handleGenerateReportJob } from "../../worker/handlers/generate-report";
import type { GenerateReportJobData } from "../../src/lib/jobs/enqueue";
import { computeNextRunAt } from "../../src/lib/reports/schedule";
import { createScheduledReport, setScheduledReportActive, deleteScheduledReport } from "../../src/app/(dashboard)/reports/scheduled/actions";
import { markNotificationRead } from "../../src/app/(dashboard)/notifications-actions";
import { GET as downloadGeneratedReport } from "../../src/app/api/reports/generated/[id]/download/route";

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
});

function fakeJob(data: GenerateReportJobData): Job<GenerateReportJobData>[] {
  return [{ id: "test-job-id", data } as Job<GenerateReportJobData>];
}

async function baseFixtures() {
  const role = await createRoleWithPermissions("Administrator", ["view_all_reports", "manage_scheduled_reports", "view_all_leads", "add_leads"]);
  const user = await createTestUser({ roleId: role.id });
  const leadType = await createLeadTypeFixture();
  const stage = await createPipelineStageFixture("New", { isDefault: true });
  return { user, leadType, stage };
}

describe("runReportsTick", () => {
  it("enqueues only active schedules whose nextRunAt has passed", async () => {
    const { user } = await baseFixtures();
    const past = new Date(Date.now() - 60_000);
    const future = new Date(Date.now() + 60_000);

    await testPrisma.scheduledReport.create({
      data: { name: "Due & active", reportKey: "sources", cadence: "DAILY", recipientIds: [user.id], createdById: user.id, active: true, nextRunAt: past },
    });
    await testPrisma.scheduledReport.create({
      data: { name: "Due but paused", reportKey: "sources", cadence: "DAILY", recipientIds: [user.id], createdById: user.id, active: false, nextRunAt: past },
    });
    await testPrisma.scheduledReport.create({
      data: { name: "Not due yet", reportKey: "sources", cadence: "DAILY", recipientIds: [user.id], createdById: user.id, active: true, nextRunAt: future },
    });

    const enqueuedCount = await runReportsTick();
    expect(enqueuedCount).toBe(1);
  });
});

describe("handleGenerateReportJob", () => {
  it("generates the report, freezes it into GeneratedReport, and advances the schedule", async () => {
    const { user, leadType, stage } = await baseFixtures();
    await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: user.id, createdById: user.id, source: "MANUAL" });

    const nextRunAt = new Date("2026-07-20T04:00:00.000Z");
    const schedule = await testPrisma.scheduledReport.create({
      data: { name: "Daily sources", reportKey: "sources", cadence: "DAILY", recipientIds: [user.id], createdById: user.id, active: true, nextRunAt },
    });

    await handleGenerateReportJob(fakeJob({ scheduledReportId: schedule.id, periodKey: nextRunAt.toISOString() }));

    const generated = await testPrisma.generatedReport.findFirstOrThrow({ where: { scheduledReportId: schedule.id } });
    expect(generated.status).toBe("SUCCEEDED");
    expect(generated.recipientIds).toEqual([user.id]);
    const payload = generated.payload as unknown as { columns: unknown[]; rows: Record<string, string>[] };
    expect(payload.rows.some((r) => r.label === "Manual")).toBe(true);

    const updatedSchedule = await testPrisma.scheduledReport.findUniqueOrThrow({ where: { id: schedule.id } });
    expect(updatedSchedule.lastRunStatus).toBe("SUCCEEDED");
    expect(updatedSchedule.nextRunAt.getTime()).toBeGreaterThan(nextRunAt.getTime());
  });

  it("records a permanent failure (and still advances the schedule) when the creator no longer has report access", async () => {
    const noReportsRole = await createRoleWithPermissions("NoReports", ["add_leads"]);
    const creator = await createTestUser({ roleId: noReportsRole.id });
    const nextRunAt = new Date("2026-07-20T04:00:00.000Z");
    const schedule = await testPrisma.scheduledReport.create({
      data: { name: "Orphaned schedule", reportKey: "sources", cadence: "DAILY", recipientIds: [creator.id], createdById: creator.id, active: true, nextRunAt },
    });

    await handleGenerateReportJob(fakeJob({ scheduledReportId: schedule.id, periodKey: nextRunAt.toISOString() }));

    const generated = await testPrisma.generatedReport.findFirstOrThrow({ where: { scheduledReportId: schedule.id } });
    expect(generated.status).toBe("FAILED");
    expect(generated.errorMessage).toMatch(/permission/i);

    const updatedSchedule = await testPrisma.scheduledReport.findUniqueOrThrow({ where: { id: schedule.id } });
    expect(updatedSchedule.nextRunAt.getTime()).toBeGreaterThan(nextRunAt.getTime());
  });

  it("records a permanent failure when the creator's account is disabled", async () => {
    const role = await createRoleWithPermissions("WillBeDisabled", ["view_all_reports"]);
    const creator = await createTestUser({ roleId: role.id, disabled: true });
    const nextRunAt = new Date("2026-07-20T04:00:00.000Z");
    const schedule = await testPrisma.scheduledReport.create({
      data: { name: "Disabled creator", reportKey: "sources", cadence: "DAILY", recipientIds: [creator.id], createdById: creator.id, active: true, nextRunAt },
    });

    await handleGenerateReportJob(fakeJob({ scheduledReportId: schedule.id, periodKey: nextRunAt.toISOString() }));

    const generated = await testPrisma.generatedReport.findFirstOrThrow({ where: { scheduledReportId: schedule.id } });
    expect(generated.status).toBe("FAILED");
    expect(generated.errorMessage).toMatch(/disabled/i);
  });

  it("is a no-op when the schedule was deactivated between enqueue and processing", async () => {
    const { user } = await baseFixtures();
    const nextRunAt = new Date("2026-07-20T04:00:00.000Z");
    const schedule = await testPrisma.scheduledReport.create({
      data: { name: "Deactivated", reportKey: "sources", cadence: "DAILY", recipientIds: [user.id], createdById: user.id, active: false, nextRunAt },
    });

    await handleGenerateReportJob(fakeJob({ scheduledReportId: schedule.id, periodKey: nextRunAt.toISOString() }));

    expect(await testPrisma.generatedReport.count({ where: { scheduledReportId: schedule.id } })).toBe(0);
  });

  // Module Ten regression: a pg-boss redelivery of the exact same job (e.g.
  // the worker crashing after the transaction committed but before the job
  // was acked) previously duplicated the GeneratedReport row, duplicated
  // the fan-out Notification, and double-advanced nextRunAt.
  it("is idempotent — processing the identical job twice never duplicates the report, the notification, or the schedule advance", async () => {
    const { user, leadType, stage } = await baseFixtures();
    await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: user.id, createdById: user.id, source: "MANUAL" });

    const nextRunAt = new Date("2026-07-20T04:00:00.000Z");
    const schedule = await testPrisma.scheduledReport.create({
      data: { name: "Daily sources", reportKey: "sources", cadence: "DAILY", recipientIds: [user.id], createdById: user.id, active: true, nextRunAt },
    });

    const job = fakeJob({ scheduledReportId: schedule.id, periodKey: nextRunAt.toISOString() });
    await handleGenerateReportJob(job);
    // Simulated redelivery: same job data, second independent invocation.
    await handleGenerateReportJob(job);

    expect(await testPrisma.generatedReport.count({ where: { scheduledReportId: schedule.id } })).toBe(1);
    expect(await testPrisma.notification.count({ where: { type: "REPORT_GENERATED", userId: user.id } })).toBe(1);

    const updatedSchedule = await testPrisma.scheduledReport.findUniqueOrThrow({ where: { id: schedule.id } });
    // Advanced exactly one cadence step past the original period, not two —
    // compare against the real computeNextRunAt() rather than a hand-rolled
    // +24h approximation (DAILY resolves to a business-timezone day
    // boundary, not a naive UTC offset).
    expect(updatedSchedule.nextRunAt.getTime()).toBe(computeNextRunAt("DAILY", nextRunAt).getTime());
  });

  it("is idempotent on the permanent-failure path too", async () => {
    const noReportsRole = await createRoleWithPermissions("NoReportsIdempotent", ["add_leads"]);
    const creator = await createTestUser({ roleId: noReportsRole.id });
    const nextRunAt = new Date("2026-07-20T04:00:00.000Z");
    const schedule = await testPrisma.scheduledReport.create({
      data: { name: "Orphaned schedule", reportKey: "sources", cadence: "DAILY", recipientIds: [creator.id], createdById: creator.id, active: true, nextRunAt },
    });

    const job = fakeJob({ scheduledReportId: schedule.id, periodKey: nextRunAt.toISOString() });
    await handleGenerateReportJob(job);
    await handleGenerateReportJob(job);

    expect(await testPrisma.generatedReport.count({ where: { scheduledReportId: schedule.id } })).toBe(1);
    expect(await testPrisma.notification.count({ where: { type: "REPORT_GENERATED", userId: creator.id } })).toBe(1);
  });
});

describe("scheduled report CRUD actions", () => {
  it("blocks a user without manage_scheduled_reports from creating a schedule", async () => {
    const role = await createRoleWithPermissions("NoManage", ["view_all_reports"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);

    const formData = new FormData();
    formData.set("name", "Attempt");
    formData.set("reportKey", "sources");
    formData.set("cadence", "DAILY");
    formData.set("recipientIds", user.id);

    await expect(createScheduledReport(undefined, formData)).rejects.toThrow(/Forbidden/);
  });

  it("creates a schedule with a computed nextRunAt", async () => {
    const { user } = await baseFixtures();
    await loginAs(user.id);

    const formData = new FormData();
    formData.set("name", "Weekly pipeline");
    formData.set("reportKey", "pipeline");
    formData.set("cadence", "WEEKLY");
    formData.set("recipientIds", user.id);

    const result = await createScheduledReport(undefined, formData);
    expect(result).toBeUndefined();

    const schedule = await testPrisma.scheduledReport.findFirstOrThrow({ where: { name: "Weekly pipeline" } });
    expect(schedule.reportKey).toBe("pipeline");
    expect(schedule.recipientIds).toEqual([user.id]);
    expect(schedule.nextRunAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("rejects an invalid recipient id", async () => {
    const { user } = await baseFixtures();
    await loginAs(user.id);

    const formData = new FormData();
    formData.set("name", "Bad recipient");
    formData.set("reportKey", "sources");
    formData.set("cadence", "DAILY");
    formData.set("recipientIds", "not-a-real-user-id");

    const result = await createScheduledReport(undefined, formData);
    expect(result?.error).toBeTruthy();
    expect(await testPrisma.scheduledReport.count()).toBe(0);
  });

  it("toggles active and deletes, both permission-gated", async () => {
    const { user } = await baseFixtures();
    await loginAs(user.id);
    const schedule = await testPrisma.scheduledReport.create({
      data: { name: "Toggle me", reportKey: "sources", cadence: "DAILY", recipientIds: [user.id], createdById: user.id, active: true, nextRunAt: new Date() },
    });

    await setScheduledReportActive(schedule.id, false);
    expect((await testPrisma.scheduledReport.findUniqueOrThrow({ where: { id: schedule.id } })).active).toBe(false);

    await deleteScheduledReport(schedule.id);
    expect(await testPrisma.scheduledReport.count({ where: { id: schedule.id } })).toBe(0);
  });
});

describe("REPORT_GENERATED notifications (Module Six Phase E)", () => {
  it("creates one REPORT_GENERATED notification per recipient when a report succeeds", async () => {
    const { user, leadType, stage } = await baseFixtures();
    await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: user.id, createdById: user.id, source: "MANUAL" });
    const otherRole = await createRoleWithPermissions("Other", ["view_own_reports"]);
    const otherUser = await createTestUser({ roleId: otherRole.id });

    const nextRunAt = new Date();
    const schedule = await testPrisma.scheduledReport.create({
      data: { name: "Weekly sources", reportKey: "sources", cadence: "DAILY", recipientIds: [user.id, otherUser.id], createdById: user.id, active: true, nextRunAt },
    });
    await handleGenerateReportJob(fakeJob({ scheduledReportId: schedule.id, periodKey: nextRunAt.toISOString() }));
    const generated = await testPrisma.generatedReport.findFirstOrThrow({ where: { scheduledReportId: schedule.id } });

    const notifications = await testPrisma.notification.findMany({ where: { type: "REPORT_GENERATED" } });
    expect(notifications).toHaveLength(2);
    expect(notifications.map((n) => n.userId).sort()).toEqual([user.id, otherUser.id].sort());
    for (const notification of notifications) {
      const payload = notification.payload as Record<string, unknown>;
      expect(payload.generatedReportId).toBe(generated.id);
      expect(payload.status).toBe("SUCCEEDED");
      expect(payload.name).toBe("Weekly sources");
    }
  });

  it("creates a FAILED-status REPORT_GENERATED notification when generation permanently fails", async () => {
    const { user } = await baseFixtures();
    const schedule = await testPrisma.scheduledReport.create({
      data: { name: "Bad key", reportKey: "not-a-real-key", cadence: "DAILY", recipientIds: [user.id], createdById: user.id, active: true, nextRunAt: new Date() },
    });

    await handleGenerateReportJob(fakeJob({ scheduledReportId: schedule.id, periodKey: new Date().toISOString() }));

    const notification = await testPrisma.notification.findFirstOrThrow({ where: { type: "REPORT_GENERATED", userId: user.id } });
    expect((notification.payload as Record<string, unknown>).status).toBe("FAILED");
  });

  it("only lets the owning recipient mark their own REPORT_GENERATED notification read", async () => {
    const { user } = await baseFixtures();
    const otherRole = await createRoleWithPermissions("Other", ["view_own_reports"]);
    const otherUser = await createTestUser({ roleId: otherRole.id });

    const notification = await testPrisma.notification.create({
      data: { userId: user.id, type: "REPORT_GENERATED", payload: { generatedReportId: "does-not-matter", status: "SUCCEEDED" } },
    });

    await loginAs(otherUser.id);
    await markNotificationRead(notification.id);
    expect((await testPrisma.notification.findUniqueOrThrow({ where: { id: notification.id } })).readAt).toBeNull();

    await loginAs(user.id);
    await markNotificationRead(notification.id);
    expect((await testPrisma.notification.findUniqueOrThrow({ where: { id: notification.id } })).readAt).not.toBeNull();
  });
});

describe("GET /api/reports/generated/[id]/download", () => {
  function params(id: string) {
    return { params: Promise.resolve({ id }) };
  }

  it("serves the exact frozen payload, unaffected by later data changes", async () => {
    const { user, leadType, stage } = await baseFixtures();
    const company = await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: user.id, createdById: user.id, source: "MANUAL" });

    const nextRunAt = new Date("2026-07-20T04:00:00.000Z");
    const schedule = await testPrisma.scheduledReport.create({
      data: { name: "Frozen check", reportKey: "sources", cadence: "DAILY", recipientIds: [user.id], createdById: user.id, active: true, nextRunAt },
    });
    await handleGenerateReportJob(fakeJob({ scheduledReportId: schedule.id, periodKey: nextRunAt.toISOString() }));
    const generated = await testPrisma.generatedReport.findFirstOrThrow({ where: { scheduledReportId: schedule.id } });

    // Change the underlying data after generation.
    await testPrisma.company.delete({ where: { id: company.id } });

    await loginAs(user.id);
    const response = await downloadGeneratedReport(new Request(`http://localhost/api/reports/generated/${generated.id}/download?format=csv`), params(generated.id));
    const body = await response.text();
    expect(body).toContain("Manual,1");

    const notification = await testPrisma.notification.findFirstOrThrow({
      where: { userId: user.id, type: "REPORT_GENERATED", payload: { path: ["generatedReportId"], equals: generated.id } },
    });
    expect(notification.readAt).not.toBeNull();
  });

  it("blocks a user who is neither a recipient, the creator, nor a report manager", async () => {
    const { user } = await baseFixtures();
    const outsiderRole = await createRoleWithPermissions("Outsider", ["view_own_reports"]);
    const outsider = await createTestUser({ roleId: outsiderRole.id });

    const generated = await testPrisma.generatedReport.create({
      data: {
        scheduledReportId: (
          await testPrisma.scheduledReport.create({
            data: { name: "Private", reportKey: "sources", cadence: "DAILY", recipientIds: [user.id], createdById: user.id, active: true, nextRunAt: new Date() },
          })
        ).id,
        reportKey: "sources",
        status: "SUCCEEDED",
        periodStart: new Date(),
        periodEnd: new Date(),
        payload: { columns: [], rows: [] },
        recipientIds: [user.id],
      },
    });

    await loginAs(outsider.id);
    const response = await downloadGeneratedReport(new Request(`http://localhost/api/reports/generated/${generated.id}/download?format=csv`), params(generated.id));
    expect(response.status).toBe(403);
  });

  it("returns 409 for a run that did not succeed", async () => {
    const { user } = await baseFixtures();
    const generated = await testPrisma.generatedReport.create({
      data: { reportKey: "sources", status: "FAILED", periodStart: new Date(), periodEnd: new Date(), payload: { columns: [], rows: [] }, recipientIds: [user.id], errorMessage: "boom" },
    });

    await loginAs(user.id);
    const response = await downloadGeneratedReport(new Request(`http://localhost/api/reports/generated/${generated.id}/download?format=csv`), params(generated.id));
    expect(response.status).toBe(409);
  });
});
