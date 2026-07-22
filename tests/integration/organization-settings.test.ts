import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, loginAs } from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { updateOrganizationSettings } from "../../src/app/(dashboard)/administration/organization/actions";

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
});

function formData(overrides: Record<string, string> = {}) {
  const fd = new FormData();
  const defaults: Record<string, string> = {
    organizationName: "Triviality",
    defaultCountry: "Canada",
    defaultRegion: "Ontario",
    defaultTimezone: "America/Toronto",
    defaultCurrency: "CAD",
    defaultDateFormat: "YYYY-MM-DD",
  };
  for (const [k, v] of Object.entries({ ...defaults, ...overrides })) fd.set(k, v);
  return fd;
}

describe("organization settings", () => {
  it("requires manage_organization_settings", async () => {
    const role = await createRoleWithPermissions("Salesperson", ["view_assigned_leads"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);

    await expect(updateOrganizationSettings(undefined, formData())).rejects.toThrow();
  });

  it("validates every field server-side and rejects an invalid time zone", async () => {
    const role = await createRoleWithPermissions("Administrator", ["manage_organization_settings"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);

    const result = await updateOrganizationSettings(undefined, formData({ defaultTimezone: "Not/AZone" }));
    expect(result?.error).toBeTruthy();
    expect(await testPrisma.organizationSettings.count()).toBe(0);
  });

  it("rejects an unsupported currency", async () => {
    const role = await createRoleWithPermissions("Administrator", ["manage_organization_settings"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);

    const result = await updateOrganizationSettings(undefined, formData({ defaultCurrency: "EUR" }));
    expect(result?.error).toBeTruthy();
  });

  it("saves valid settings and records who changed them, when, and before/after", async () => {
    const role = await createRoleWithPermissions("Administrator", ["manage_organization_settings"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);

    await updateOrganizationSettings(undefined, formData());
    const first = await testPrisma.organizationSettings.findUniqueOrThrow({ where: { id: 1 } });
    expect(first.organizationName).toBe("Triviality");
    expect(first.updatedById).toBe(user.id);

    await updateOrganizationSettings(undefined, formData({ organizationName: "Triviality Games" }));
    const second = await testPrisma.organizationSettings.findUniqueOrThrow({ where: { id: 1 } });
    expect(second.organizationName).toBe("Triviality Games");

    const auditEvents = await testPrisma.auditEvent.findMany({ where: { module: "organization" }, orderBy: { occurredAt: "asc" } });
    expect(auditEvents).toHaveLength(2);
    expect(auditEvents[1].actorId).toBe(user.id);
    expect((auditEvents[1].beforeData as Record<string, unknown>).organizationName).toBe("Triviality");
    expect((auditEvents[1].afterData as Record<string, unknown>).organizationName).toBe("Triviality Games");
  });

  it("never introduces a second organization row (single-organization CRM)", async () => {
    const role = await createRoleWithPermissions("Administrator", ["manage_organization_settings"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);

    await updateOrganizationSettings(undefined, formData());
    await updateOrganizationSettings(undefined, formData({ organizationName: "Renamed" }));

    expect(await testPrisma.organizationSettings.count()).toBe(1);
  });
});
