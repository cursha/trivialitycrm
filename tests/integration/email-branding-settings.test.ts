import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, loginAs } from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { updateWorkspaceSettings } from "../../src/app/(dashboard)/settings/actions";

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
});

function settingsForm(overrides: Record<string, string> = {}) {
  const fd = new FormData();
  for (const [key, value] of Object.entries({ noActivityThresholdDays: "14", newlyAssignedThresholdDays: "3", ...overrides })) fd.set(key, value);
  return fd;
}

async function loginAdmin() {
  const role = await createRoleWithPermissions("Administrator", ["manage_settings"]);
  const user = await createTestUser({ roleId: role.id });
  await loginAs(user.id);
}

describe("email branding settings", () => {
  it("saves the footer phone and website and keeps the layout on", async () => {
    await loginAdmin();
    expect(await updateWorkspaceSettings(undefined, settingsForm({ emailBrandingEnabled: "on", emailFooterPhone: "905-555-0123", emailFooterWebsite: "trivialitymayhem.com" }))).toBeUndefined();
    expect(await testPrisma.workspaceSettings.findUniqueOrThrow({ where: { id: 1 } })).toMatchObject({
      emailBrandingEnabled: true,
      emailFooterPhone: "905-555-0123",
      emailFooterWebsite: "trivialitymayhem.com",
    });
  });

  it("turns the layout off when unticked, and clears blank footer fields", async () => {
    await loginAdmin();
    await updateWorkspaceSettings(undefined, settingsForm({ emailFooterPhone: "", emailFooterWebsite: "" }));
    expect(await testPrisma.workspaceSettings.findUniqueOrThrow({ where: { id: 1 } })).toMatchObject({
      emailBrandingEnabled: false,
      emailFooterPhone: null,
      emailFooterWebsite: null,
    });
  });

  it("refuses a website that isn't a web address", async () => {
    await loginAdmin();
    expect(await updateWorkspaceSettings(undefined, settingsForm({ emailBrandingEnabled: "on", emailFooterWebsite: "not a website" }))).toEqual({
      error: "Enter the website as an address, e.g. trivialitymayhem.com.",
    });
  });
});
