import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, loginAs } from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { createRule, updateRule, setRuleEnabled, reorderRule, archiveRule, restoreRule } from "../../src/app/(dashboard)/data-quality/rules/actions";

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
});

function ruleFormData(overrides: Record<string, string> = {}) {
  const fd = new FormData();
  const defaults: Record<string, string> = { name: "Missing phone", entityType: "COMPANY", field: "phone", ruleType: "REQUIRED_FIELD", severity: "MEDIUM" };
  for (const [k, v] of Object.entries({ ...defaults, ...overrides })) fd.set(k, v);
  return fd;
}

async function admin() {
  const role = await createRoleWithPermissions("Administrator", ["manage_data_quality_rules"]);
  return createTestUser({ roleId: role.id });
}

describe("data quality rule CRUD", () => {
  it("requires manage_data_quality_rules to create a rule", async () => {
    const role = await createRoleWithPermissions("Salesperson", ["view_assigned_leads"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);

    await expect(createRule(undefined, ruleFormData())).rejects.toThrow();
  });

  it("creates a rule with validated config", async () => {
    const user = await admin();
    await loginAs(user.id);

    const result = await createRule(undefined, ruleFormData({ ruleType: "DUPLICATE_FUZZY_MATCH", field: "name", minSimilarity: "90" }));
    expect(result?.error).toBeUndefined();

    const rule = await testPrisma.dataQualityRule.findFirstOrThrow({ where: { name: "Missing phone" } });
    expect(rule.ruleType).toBe("DUPLICATE_FUZZY_MATCH");
    expect((rule.config as { minSimilarity: number }).minSimilarity).toBe(90);
  });

  it("rejects a rule with no name", async () => {
    const user = await admin();
    await loginAs(user.id);

    const result = await createRule(undefined, ruleFormData({ name: "" }));
    expect(result?.error).toBeTruthy();
    expect(await testPrisma.dataQualityRule.count()).toBe(0);
  });

  it("updates a rule and records an audit event", async () => {
    const user = await admin();
    await loginAs(user.id);
    await createRule(undefined, ruleFormData());
    const rule = await testPrisma.dataQualityRule.findFirstOrThrow({});

    await updateRule(rule.id, ruleFormData({ name: "Missing phone number", severity: "HIGH" }));

    const updated = await testPrisma.dataQualityRule.findUniqueOrThrow({ where: { id: rule.id } });
    expect(updated.name).toBe("Missing phone number");
    expect(updated.severity).toBe("HIGH");

    const auditEvent = await testPrisma.dataQualityAuditEvent.findFirst({ where: { action: "RULE_UPDATED", ruleId: rule.id } });
    expect(auditEvent).not.toBeNull();
  });

  it("toggles enabled without needing a full edit", async () => {
    const user = await admin();
    await loginAs(user.id);
    await createRule(undefined, ruleFormData());
    const rule = await testPrisma.dataQualityRule.findFirstOrThrow({});
    expect(rule.enabled).toBe(true);

    await setRuleEnabled(rule.id, false);
    expect((await testPrisma.dataQualityRule.findUniqueOrThrow({ where: { id: rule.id } })).enabled).toBe(false);
  });

  it("reorders rules within the same entity type", async () => {
    const user = await admin();
    await loginAs(user.id);
    await createRule(undefined, ruleFormData({ name: "Rule A" }));
    await createRule(undefined, ruleFormData({ name: "Rule B" }));

    const ruleA = await testPrisma.dataQualityRule.findFirstOrThrow({ where: { name: "Rule A" } });
    const ruleB = await testPrisma.dataQualityRule.findFirstOrThrow({ where: { name: "Rule B" } });
    expect(ruleA.sortOrder).toBeLessThan(ruleB.sortOrder);

    await reorderRule(ruleB.id, "up");

    const ruleAAfter = await testPrisma.dataQualityRule.findUniqueOrThrow({ where: { id: ruleA.id } });
    const ruleBAfter = await testPrisma.dataQualityRule.findUniqueOrThrow({ where: { id: ruleB.id } });
    expect(ruleBAfter.sortOrder).toBeLessThan(ruleAAfter.sortOrder);
  });

  it("archives and restores a rule without deleting it", async () => {
    const user = await admin();
    await loginAs(user.id);
    await createRule(undefined, ruleFormData());
    const rule = await testPrisma.dataQualityRule.findFirstOrThrow({});

    await archiveRule(rule.id);
    let result = await testPrisma.dataQualityRule.findUniqueOrThrow({ where: { id: rule.id } });
    expect(result.archivedAt).not.toBeNull();

    await restoreRule(rule.id);
    result = await testPrisma.dataQualityRule.findUniqueOrThrow({ where: { id: rule.id } });
    expect(result.archivedAt).toBeNull();

    expect(await testPrisma.dataQualityRule.count()).toBe(1);
  });
});
