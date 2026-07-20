import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, loginAs } from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { createTerritory, updateTerritory, setTerritoryActive, deleteTerritory } from "../../src/app/(dashboard)/settings/territories/actions";

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
});

function territoryFormData(overrides: Record<string, string> = {}) {
  const fd = new FormData();
  const defaults: Record<string, string> = { name: "", country: "Canada", region: "ON", city: "Toronto", assignedToId: "" };
  for (const [key, value] of Object.entries({ ...defaults, ...overrides })) fd.set(key, value);
  return fd;
}

describe("Territory CRUD", () => {
  it("creates a territory", async () => {
    const role = await createRoleWithPermissions("TerritoryManager", ["manage_territories"]);
    const manager = await createTestUser({ roleId: role.id });
    await loginAs(manager.id);

    const result = await createTerritory(undefined, territoryFormData());
    expect(result).toBeUndefined();

    const territory = await testPrisma.territory.findFirstOrThrow({ where: { country: "Canada", city: "Toronto" } });
    expect(territory.region).toBe("ON");
    expect(territory.active).toBe(true);
  });

  it("rejects a duplicate exact scope (country+region+city)", async () => {
    const role = await createRoleWithPermissions("TerritoryManager", ["manage_territories"]);
    const manager = await createTestUser({ roleId: role.id });
    await loginAs(manager.id);

    await createTerritory(undefined, territoryFormData());
    const result = await createTerritory(undefined, territoryFormData());

    expect(result?.error).toMatch(/already exists/);
    expect(await testPrisma.territory.count()).toBe(1);
  });

  it("allows a broader territory (no city) to coexist with a narrower one for the same region", async () => {
    const role = await createRoleWithPermissions("TerritoryManager", ["manage_territories"]);
    const manager = await createTestUser({ roleId: role.id });
    await loginAs(manager.id);

    await createTerritory(undefined, territoryFormData({ city: "Toronto" }));
    const result = await createTerritory(undefined, territoryFormData({ city: "" }));

    expect(result).toBeUndefined();
    expect(await testPrisma.territory.count()).toBe(2);
  });

  it("rejects a city-level territory with no region", async () => {
    const role = await createRoleWithPermissions("TerritoryManager", ["manage_territories"]);
    const manager = await createTestUser({ roleId: role.id });
    await loginAs(manager.id);

    const result = await createTerritory(undefined, territoryFormData({ region: "", city: "Toronto" }));
    expect(result?.error).toMatch(/needs a state\/province/);
  });

  it("denies creation without manage_territories", async () => {
    const role = await createRoleWithPermissions("NoAccess", ["view_all_leads"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);

    await expect(createTerritory(undefined, territoryFormData())).rejects.toThrow(/Forbidden/);
  });

  it("updates, deactivates, and deletes a territory", async () => {
    const role = await createRoleWithPermissions("TerritoryManager", ["manage_territories"]);
    const manager = await createTestUser({ roleId: role.id });
    await loginAs(manager.id);

    await createTerritory(undefined, territoryFormData());
    const territory = await testPrisma.territory.findFirstOrThrow();

    await updateTerritory(territory.id, territoryFormData({ name: "GTA" }));
    expect((await testPrisma.territory.findUniqueOrThrow({ where: { id: territory.id } })).name).toBe("GTA");

    await setTerritoryActive(territory.id, false);
    expect((await testPrisma.territory.findUniqueOrThrow({ where: { id: territory.id } })).active).toBe(false);

    await deleteTerritory(territory.id);
    expect(await testPrisma.territory.count({ where: { id: territory.id } })).toBe(0);
  });
});
