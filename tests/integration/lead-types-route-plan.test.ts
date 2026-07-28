import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, createLeadTypeFixture, loginAs } from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { setLeadTypeRoutePlanSettings } from "../../src/app/(dashboard)/settings/lead-types/actions";

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
});

function formData(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

async function adminFixture() {
  const role = await createRoleWithPermissions("Administrator", ["manage_settings", "configure_route_plan_lead_types"]);
  const admin = await createTestUser({ roleId: role.id });
  await loginAs(admin.id);
  return admin;
}

describe("setLeadTypeRoutePlanSettings", () => {
  it("enables Route Planning with a sanitized slug", async () => {
    await adminFixture();
    const leadType = await createLeadTypeFixture("Pub Trivia");

    const result = await setLeadTypeRoutePlanSettings(leadType.id, formData({ routePlanEnabled: "on", routePlanSlug: "Pub Trivia!!" }));
    expect(result?.error).toBeUndefined();

    const updated = await testPrisma.leadType.findUniqueOrThrow({ where: { id: leadType.id } });
    expect(updated.routePlanEnabled).toBe(true);
    expect(updated.routePlanSlug).toBe("pub-trivia");
  });

  it("rejects enabling without a usable slug", async () => {
    await adminFixture();
    const leadType = await createLeadTypeFixture("Pub Trivia");

    const result = await setLeadTypeRoutePlanSettings(leadType.id, formData({ routePlanEnabled: "on", routePlanSlug: "   " }));
    expect(result?.error).toBeTruthy();

    const updated = await testPrisma.leadType.findUniqueOrThrow({ where: { id: leadType.id } });
    expect(updated.routePlanEnabled).toBe(false);
  });

  it("disabling clears the slug even if one was set", async () => {
    await adminFixture();
    const leadType = await createLeadTypeFixture("Pub Trivia", { routePlanEnabled: true, routePlanSlug: "pub" });

    const result = await setLeadTypeRoutePlanSettings(leadType.id, formData({ routePlanSlug: "pub" }));
    expect(result?.error).toBeUndefined();

    const updated = await testPrisma.leadType.findUniqueOrThrow({ where: { id: leadType.id } });
    expect(updated.routePlanEnabled).toBe(false);
    expect(updated.routePlanSlug).toBeNull();
  });

  it("rejects a slug already used by another lead type", async () => {
    await adminFixture();
    await createLeadTypeFixture("Pub Trivia", { routePlanEnabled: true, routePlanSlug: "pub" });
    const other = await createLeadTypeFixture("Senior Home");

    const result = await setLeadTypeRoutePlanSettings(other.id, formData({ routePlanEnabled: "on", routePlanSlug: "pub" }));
    expect(result?.error).toBeTruthy();
  });

  it("requires configure_route_plan_lead_types, not just manage_settings", async () => {
    const role = await createRoleWithPermissions("SettingsOnly", ["manage_settings"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);
    const leadType = await createLeadTypeFixture("Pub Trivia");

    await expect(setLeadTypeRoutePlanSettings(leadType.id, formData({ routePlanEnabled: "on", routePlanSlug: "pub" }))).rejects.toThrow();
  });
});
