import crypto from "node:crypto";
import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, loginAs } from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { markNotificationRead, markAllNotificationsRead } from "../../src/app/(dashboard)/notifications-actions";

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
});

async function userFixture() {
  const role = await createRoleWithPermissions(`User-${crypto.randomUUID()}`, []);
  return createTestUser({ roleId: role.id });
}

describe("markNotificationRead", () => {
  it("only lets the owning user mark their own notification read", async () => {
    const owner = await userFixture();
    const outsider = await userFixture();
    const notification = await testPrisma.notification.create({
      data: { userId: owner.id, type: "SEQUENCE_COMPLETED", payload: {} },
    });

    await loginAs(outsider.id);
    await markNotificationRead(notification.id);
    expect((await testPrisma.notification.findUniqueOrThrow({ where: { id: notification.id } })).readAt).toBeNull();

    await loginAs(owner.id);
    await markNotificationRead(notification.id);
    expect((await testPrisma.notification.findUniqueOrThrow({ where: { id: notification.id } })).readAt).not.toBeNull();
  });
});

describe("markAllNotificationsRead", () => {
  it("marks every unread notification for the current user, and no one else's", async () => {
    const user = await userFixture();
    const otherUser = await userFixture();
    await testPrisma.notification.create({ data: { userId: user.id, type: "SEQUENCE_COMPLETED", payload: {} } });
    await testPrisma.notification.create({ data: { userId: user.id, type: "DELIVERY_FAILURE", payload: {} } });
    await testPrisma.notification.create({ data: { userId: otherUser.id, type: "SEQUENCE_COMPLETED", payload: {} } });

    await loginAs(user.id);
    await markAllNotificationsRead();

    expect(await testPrisma.notification.count({ where: { userId: user.id, readAt: null } })).toBe(0);
    expect(await testPrisma.notification.count({ where: { userId: otherUser.id, readAt: null } })).toBe(1);
  });
});
