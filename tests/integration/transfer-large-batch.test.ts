import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import {
  createRoleWithPermissions,
  createTestUser,
  createLeadTypeFixture,
  createPipelineStageFixture,
  createLeadSearchFixture,
  createSearchResultFixture,
  loginAs,
} from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import type { TransferRow } from "../../src/lib/validation/transfer";

// Production's database is a network hop away, so each write takes far
// longer than against the local test database. Slow one write per row down
// to stand in for that: 60 rows x 100ms is past Prisma's default 5-second
// transaction limit, which is what a large transfer hit in production.
vi.mock("../../src/lib/companies/activity-log", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/lib/companies/activity-log")>();
  return {
    ...original,
    logInitialPipelineStage: async (...args: Parameters<typeof original.logInitialPipelineStage>) => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return original.logInitialPipelineStage(...args);
    },
  };
});

const { transferSearchResults } = await import("../../src/app/(dashboard)/leads/transfer/actions");

vi.setConfig({ testTimeout: 60_000 });

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
});

describe("transferSearchResults with a large batch", () => {
  it("transfers 60 venues in one go even when the writes are slow", async () => {
    const role = await createRoleWithPermissions("Administrator", ["transfer_leads"]);
    const user = await createTestUser({ name: "Administrator", roleId: role.id });
    const leadType = await createLeadTypeFixture("Pub");
    const stage = await createPipelineStageFixture("New", { isDefault: true });
    const search = await createLeadSearchFixture({ createdById: user.id, leadTypeId: leadType.id });
    await loginAs(user.id);

    const rows: TransferRow[] = [];
    for (let i = 0; i < 60; i++) {
      const name = `Test Pub ${i}`;
      const city = `Town ${i}`;
      const result = await createSearchResultFixture({ searchId: search.id, name });
      rows.push({
        resultId: result.id,
        name,
        address1: undefined,
        city,
        region: "ON",
        postalCode: undefined,
        country: "Canada",
        phone: undefined,
        email: undefined,
        websiteUrl: undefined,
        contactFirstName: undefined,
        contactLastName: undefined,
        contactPhone: undefined,
        contactEmail: undefined,
        contactTitle: undefined,
        contactNote: undefined,
      });
    }

    const outcome = await transferSearchResults({ assignedToId: user.id, pipelineStageId: stage.id, rows });

    expect(outcome).toEqual({ transferredCount: 60, ignoredCount: 0 });
    expect(await testPrisma.company.count()).toBe(60);
    expect(await testPrisma.searchResult.count({ where: { disposition: "TRANSFERRED" } })).toBe(60);
  });
});
