import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, loginAs } from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { getOnboardingChecklist, setOnboardingStepCompleted } from "../../src/app/(dashboard)/onboarding/actions";

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
});

describe("getOnboardingChecklist", () => {
  it("hides permission-gated steps from a user without those permissions", async () => {
    const role = await createRoleWithPermissions("Viewer", []);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);

    const { items } = await getOnboardingChecklist();
    expect(items.map((i) => i.key)).toEqual(["schedule_follow_up", "review_my_day"]);
  });

  it("shows a permission-gated step once the user has that permission", async () => {
    const role = await createRoleWithPermissions("Salesperson", ["add_leads"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);

    const { items } = await getOnboardingChecklist();
    expect(items.map((i) => i.key)).toContain("add_first_company");
  });

  it("reflects completed steps and their count", async () => {
    const role = await createRoleWithPermissions("Viewer", []);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);

    await setOnboardingStepCompleted("review_my_day", true);

    const { items, completedCount } = await getOnboardingChecklist();
    expect(completedCount).toBe(1);
    expect(items.find((i) => i.key === "review_my_day")?.completed).toBe(true);
    expect(items.find((i) => i.key === "schedule_follow_up")?.completed).toBe(false);
  });
});

describe("setOnboardingStepCompleted", () => {
  it("marks a step complete and is idempotent", async () => {
    const role = await createRoleWithPermissions("Viewer", []);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);

    await setOnboardingStepCompleted("review_my_day", true);
    await setOnboardingStepCompleted("review_my_day", true);

    const rows = await testPrisma.userOnboardingStep.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
  });

  it("unmarks a completed step", async () => {
    const role = await createRoleWithPermissions("Viewer", []);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);

    await setOnboardingStepCompleted("review_my_day", true);
    await setOnboardingStepCompleted("review_my_day", false);

    const rows = await testPrisma.userOnboardingStep.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(0);
  });

  it("refuses to complete a step the user lacks permission for", async () => {
    const role = await createRoleWithPermissions("Viewer", []);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);

    const result = await setOnboardingStepCompleted("add_first_company", true);
    expect(result.error).toBeTruthy();

    const rows = await testPrisma.userOnboardingStep.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(0);
  });

  it("scopes completion to the acting user only", async () => {
    const role = await createRoleWithPermissions("Viewer", []);
    const userA = await createTestUser({ name: "User A", roleId: role.id });
    const userB = await createTestUser({ name: "User B", roleId: role.id });

    await loginAs(userA.id);
    await setOnboardingStepCompleted("review_my_day", true);

    await loginAs(userB.id);
    const { completedCount } = await getOnboardingChecklist();
    expect(completedCount).toBe(0);
  });
});
