import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser } from "../helpers/fixtures";
import { putUpload, getUpload } from "../../src/lib/import/batch-store";
import { sweepExpiredImportBatches } from "../../worker/handlers/cleanup";
import { Prisma } from "../../src/generated/prisma/client";

beforeEach(async () => {
  await resetDatabase();
});

async function baseFixtures() {
  const role = await createRoleWithPermissions("Importer", ["import_leads"]);
  const user = await createTestUser({ roleId: role.id });
  return { user };
}

describe("import batch expiry and cleanup", () => {
  it("treats a past-expiresAt batch as gone even before the cleanup job runs", async () => {
    const { user } = await baseFixtures();
    const batch = await testPrisma.importBatch.create({
      data: {
        uploadedById: user.id,
        filename: "leads.csv",
        headers: ["Name"],
        payload: [{ Name: "Bar A" }],
        rowCount: 1,
        expiresAt: new Date(Date.now() - 1000), // already expired
      },
    });

    const upload = await getUpload(batch.id, user.id);
    expect(upload).toBeUndefined();
  });

  it("wipes the payload and marks EXPIRED for batches past expiresAt, leaving live batches untouched", async () => {
    const { user } = await baseFixtures();
    const expired = await testPrisma.importBatch.create({
      data: {
        uploadedById: user.id,
        filename: "old.csv",
        headers: ["Name"],
        payload: [{ Name: "Bar A" }],
        rowCount: 1,
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    const live = await testPrisma.importBatch.create({
      data: {
        uploadedById: user.id,
        filename: "new.csv",
        headers: ["Name"],
        payload: [{ Name: "Bar B" }],
        rowCount: 1,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    const result = await sweepExpiredImportBatches();
    expect(result.expired).toBe(1);

    const expiredAfter = await testPrisma.importBatch.findUniqueOrThrow({ where: { id: expired.id } });
    expect(expiredAfter.payload).toBeNull();
    expect(expiredAfter.status).toBe("EXPIRED");

    const liveAfter = await testPrisma.importBatch.findUniqueOrThrow({ where: { id: live.id } });
    expect(liveAfter.payload).not.toBeNull();
    expect(liveAfter.status).toBe("PENDING");
  });

  it("hard-deletes EXPIRED/IMPORTED batch rows only after the retention grace period", async () => {
    const { user } = await baseFixtures();
    const recentlyExpired = await testPrisma.importBatch.create({
      data: {
        uploadedById: user.id,
        filename: "recent.csv",
        headers: ["Name"],
        payload: Prisma.DbNull,
        rowCount: 1,
        status: "EXPIRED",
        expiresAt: new Date(Date.now() - 60 * 60 * 1000),
        updatedAt: new Date(), // within grace period
      },
    });
    const longExpired = await testPrisma.importBatch.create({
      data: {
        uploadedById: user.id,
        filename: "old.csv",
        headers: ["Name"],
        payload: Prisma.DbNull,
        rowCount: 1,
        status: "EXPIRED",
        expiresAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      },
    });
    // updatedAt is set by @updatedAt on write — backdate it directly so the
    // grace-period comparison has something to actually test.
    await testPrisma.$executeRawUnsafe(
      `UPDATE "ImportBatch" SET "updatedAt" = $1 WHERE id = $2`,
      new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      longExpired.id,
    );

    const result = await sweepExpiredImportBatches();
    expect(result.deleted).toBe(1);

    expect(await testPrisma.importBatch.findUnique({ where: { id: recentlyExpired.id } })).not.toBeNull();
    expect(await testPrisma.importBatch.findUnique({ where: { id: longExpired.id } })).toBeNull();
  });

  it("getUpload rejects a batch belonging to a different user", async () => {
    const { user } = await baseFixtures();
    const roleB = await createRoleWithPermissions("Importer B", ["import_leads"]);
    const otherUser = await createTestUser({ roleId: roleB.id });

    const batchId = await putUpload(user.id, "leads.csv", { headers: ["Name"], rows: [{ Name: "Bar A" }] });

    expect(await getUpload(batchId, otherUser.id)).toBeUndefined();
    expect(await getUpload(batchId, user.id)).toBeDefined();
  });
});
