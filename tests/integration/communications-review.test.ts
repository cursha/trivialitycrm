import { describe, it, expect, beforeEach } from "vitest";
import crypto from "node:crypto";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, createLeadTypeFixture, createPipelineStageFixture, createCompanyFixture, loginAs } from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { matchInboundMessageAction, dismissInboundMessageAction } from "../../src/app/(dashboard)/settings/communications-review/actions";

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
});

async function baseFixtures(permissions: string[] = ["view_team_communications"]) {
  const role = await createRoleWithPermissions(`Reviewer-${crypto.randomUUID()}`, permissions);
  const user = await createTestUser({ roleId: role.id });
  const leadType = await createLeadTypeFixture();
  const stage = await createPipelineStageFixture(`New-${crypto.randomUUID()}`, { isDefault: true });
  const company = await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: user.id, createdById: user.id });
  return { user, company };
}

async function unmatchedMessageFixture(overrides: Partial<{ fromAddress: string }> = {}) {
  return testPrisma.emailMessage.create({
    data: {
      direction: "INBOUND",
      fromAddress: overrides.fromAddress ?? "stranger@example.com",
      toAddresses: ["salesperson@example.test"],
      subject: "Hi",
      body: "Hello there",
      status: "RECEIVED",
    },
  });
}

function formWith(email: string): FormData {
  const form = new FormData();
  form.set("contactEmail", email);
  return form;
}

describe("matchInboundMessageAction", () => {
  it("blocks a user without view_team_communications", async () => {
    const { user } = await baseFixtures([]);
    await loginAs(user.id);
    const message = await unmatchedMessageFixture();

    await expect(matchInboundMessageAction(message.id, undefined, formWith("jamie@example.com"))).rejects.toThrow(/Forbidden/);
  });

  it("errors when no contact has the given email", async () => {
    const { user } = await baseFixtures();
    await loginAs(user.id);
    const message = await unmatchedMessageFixture();

    const result = await matchInboundMessageAction(message.id, undefined, formWith("nobody@example.com"));
    expect(result?.error).toMatch(/no contact/i);
  });

  it("errors when more than one contact shares that email (ambiguous)", async () => {
    const { user, company } = await baseFixtures();
    await loginAs(user.id);
    await testPrisma.contact.create({ data: { companyId: company.id, firstName: "A", lastName: "One", email: "shared@example.com" } });
    const { company: companyB } = await baseFixtures();
    await testPrisma.contact.create({ data: { companyId: companyB.id, firstName: "B", lastName: "Two", email: "shared@example.com" } });
    const message = await unmatchedMessageFixture();

    const result = await matchInboundMessageAction(message.id, undefined, formWith("shared@example.com"));
    expect(result?.error).toMatch(/more than one/i);
  });

  it("links the message to the matched contact and stamps reviewedAt/reviewedById", async () => {
    const { user, company } = await baseFixtures();
    await loginAs(user.id);
    const contact = await testPrisma.contact.create({ data: { companyId: company.id, firstName: "Jamie", lastName: "Lead", email: "jamie@example.com" } });
    const message = await unmatchedMessageFixture();

    const result = await matchInboundMessageAction(message.id, undefined, formWith("jamie@example.com"));
    expect(result).toBeUndefined();

    const updated = await testPrisma.emailMessage.findUniqueOrThrow({ where: { id: message.id } });
    expect(updated.contactId).toBe(contact.id);
    expect(updated.companyId).toBe(company.id);
    expect(updated.reviewedAt).not.toBeNull();
    expect(updated.reviewedById).toBe(user.id);
  });
});

describe("dismissInboundMessageAction", () => {
  it("blocks a user without view_team_communications", async () => {
    const { user } = await baseFixtures([]);
    await loginAs(user.id);
    const message = await unmatchedMessageFixture();

    await expect(dismissInboundMessageAction(message.id)).rejects.toThrow(/Forbidden/);
  });

  it("marks the message reviewed without linking it to any contact", async () => {
    const { user } = await baseFixtures();
    await loginAs(user.id);
    const message = await unmatchedMessageFixture();

    await dismissInboundMessageAction(message.id);

    const updated = await testPrisma.emailMessage.findUniqueOrThrow({ where: { id: message.id } });
    expect(updated.reviewedAt).not.toBeNull();
    expect(updated.reviewedById).toBe(user.id);
    expect(updated.contactId).toBeNull();
  });

  it("removes the message from the review query (contactId null AND reviewedAt null) after dismissal", async () => {
    const { user } = await baseFixtures();
    await loginAs(user.id);
    const message = await unmatchedMessageFixture();

    await dismissInboundMessageAction(message.id);

    const stillPending = await testPrisma.emailMessage.findMany({ where: { direction: "INBOUND", contactId: null, reviewedAt: null } });
    expect(stillPending.find((m) => m.id === message.id)).toBeUndefined();
  });
});
