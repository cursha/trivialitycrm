import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, createLeadTypeFixture, createPipelineStageFixture, createCompanyFixture } from "../helpers/fixtures";

beforeEach(async () => {
  await resetDatabase();
});

describe("User.passwordHash is omitted by default", () => {
  it("is never returned unless a query opts back in", async () => {
    const role = await createRoleWithPermissions("Rep", []);
    const user = await createTestUser({ roleId: role.id });
    const leadType = await createLeadTypeFixture();
    const stage = await createPipelineStageFixture();
    const company = await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: user.id, createdById: user.id });
    await testPrisma.activity.create({ data: { companyId: company.id, userId: user.id, type: "PHONE" } });

    expect(user).not.toHaveProperty("passwordHash");
    expect(await testPrisma.user.findUniqueOrThrow({ where: { id: user.id } })).not.toHaveProperty("passwordHash");

    const activity = await testPrisma.activity.findFirstOrThrow({ where: { companyId: company.id }, include: { user: true } });
    expect(activity.user).not.toHaveProperty("passwordHash");

    const withOwner = await testPrisma.company.findUniqueOrThrow({ where: { id: company.id }, include: { assignedTo: true } });
    expect(withOwner.assignedTo).not.toHaveProperty("passwordHash");

    await testPrisma.$transaction(async (tx) => {
      expect(await tx.user.findUniqueOrThrow({ where: { id: user.id } })).not.toHaveProperty("passwordHash");
    });

    const optedIn = await testPrisma.user.findUniqueOrThrow({ where: { id: user.id }, omit: { passwordHash: false } });
    expect(optedIn.passwordHash).toEqual(expect.any(String));
  });
});
