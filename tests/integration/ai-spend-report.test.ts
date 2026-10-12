import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, createTeam, loginAs } from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { getCurrentUser } from "../../src/lib/auth/current-user";
import { getAiSpendReport } from "../../src/app/(dashboard)/reports/ai-spend/queries";
import { GET as exportReport } from "../../src/app/api/reports/[reportKey]/export/route";

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
});

async function usage(data: { userId: string | null; operation: string; costUsd: number; createdAt?: Date; model?: string }) {
  return testPrisma.aiUsageRecord.create({
    data: {
      userId: data.userId,
      provider: "anthropic",
      operation: data.operation,
      model: data.model ?? "claude-sonnet-5-5",
      inputTokens: 1000,
      outputTokens: 200,
      estimatedCostUsd: data.costUsd,
      createdAt: data.createdAt ?? new Date(),
    },
  });
}

async function report(filters: Record<string, string> = {}) {
  const user = await getCurrentUser();
  return getAiSpendReport(user!, { dateRange: "month", ...filters } as never);
}

describe("getAiSpendReport", () => {
  it("totals this month's spend and breaks it down by feature and person", async () => {
    const role = await createRoleWithPermissions("Owner", ["view_all_reports", "view_ai_costs"]);
    const curt = await createTestUser({ name: "Curt", roleId: role.id });
    const joe = await createTestUser({ name: "Joe", roleId: role.id });
    await loginAs(curt.id);

    await usage({ userId: curt.id, operation: "discover", costUsd: 1.5 });
    await usage({ userId: curt.id, operation: "findEmail", costUsd: 0.25 });
    await usage({ userId: joe.id, operation: "discover", costUsd: 0.75 });
    await usage({ userId: null, operation: "score", costUsd: 0.5 });
    // Last year: outside "this month".
    await usage({ userId: curt.id, operation: "discover", costUsd: 99, createdAt: new Date(Date.now() - 400 * 86_400_000) });

    const result = (await report())!;
    expect(result.totalUsd).toBeCloseTo(3);
    expect(result.callCount).toBe(4);
    expect(result.byOperation[0]).toMatchObject({ label: "Lead search: finding venues", calls: 2 });
    expect(result.byOperation[0].costUsd).toBeCloseTo(2.25);
    expect(result.byUser.map((r) => r.label)).toEqual(["Curt", "Joe", "System (no person)"]);
    expect(result.timeline.reduce((sum, row) => sum + row.costUsd, 0)).toBeCloseTo(3);
    expect(result.calls).toHaveLength(4);

    const joeOnly = (await report({ assignedToId: joe.id }))!;
    expect(joeOnly.totalUsd).toBeCloseTo(0.75);
  });

  it("is hidden without the AI-costs permission", async () => {
    const role = await createRoleWithPermissions("Reporter", ["view_all_reports"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);
    expect(await report()).toBeNull();
  });

  it("shows a rep only their own spend under an own-reports scope", async () => {
    const team = await createTeam();
    const role = await createRoleWithPermissions("Rep", ["view_own_reports", "view_ai_costs"]);
    const me = await createTestUser({ name: "Me", roleId: role.id, teamId: team.id });
    const other = await createTestUser({ name: "Other", roleId: role.id, teamId: team.id });
    await loginAs(me.id);
    await usage({ userId: me.id, operation: "discover", costUsd: 1 });
    await usage({ userId: other.id, operation: "discover", costUsd: 5 });
    await usage({ userId: null, operation: "score", costUsd: 2 });

    const result = (await report())!;
    expect(result.totalUsd).toBeCloseTo(1);
    expect(result.byUser.map((r) => r.label)).toEqual(["Me"]);
  });
});

describe("AI Spend export", () => {
  it("exports the on-screen filters, not just this month", async () => {
    const role = await createRoleWithPermissions("Owner", ["view_all_reports", "view_ai_costs", "export_reports"]);
    const curt = await createTestUser({ name: "Curt", roleId: role.id });
    const joe = await createTestUser({ name: "Joe", roleId: role.id });
    await loginAs(curt.id);
    await usage({ userId: curt.id, operation: "discover", costUsd: 1.5 });
    await usage({ userId: joe.id, operation: "findEmail", costUsd: 0.25 });

    const response = await exportReport(
      new Request(`http://localhost/api/reports/ai-spend/export?dateRange=year&assignedToId=${joe.id}&page=2&format=csv`),
      { params: Promise.resolve({ reportKey: "ai-spend" }) },
    );
    const body = await response.text();
    expect(body).toContain("Report: AI Spend Report");
    expect(body).toContain("Date range: This year");
    expect(body).toContain("Total,All AI calls,1,0.25");
    expect(body).toContain("By feature,Finding emails (web search),1,0.25");
    expect(body).toContain("By person,Joe,1,0.25");
    expect(body).not.toContain("By person,Curt");
  });
});
