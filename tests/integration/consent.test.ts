import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, createLeadTypeFixture, createPipelineStageFixture, createCompanyFixture, loginAs } from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { resetEnvCacheForTests } from "../../src/lib/env";
import { recordConsent, unsubscribeByToken } from "../../src/lib/comms/consent";
import { createUnsubscribeToken } from "../../src/lib/comms/unsubscribe-token";
import { recordContactConsentAction } from "../../src/app/(dashboard)/settings/communication-compliance/actions";

const TEST_KEY = "SRvbw8Ualx2XC/Ekfrk0RWORk0fg8/dcL1kL5krkqbk=";
const mutableEnv = process.env as Record<string, string | undefined>;

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
  mutableEnv.UNSUBSCRIBE_TOKEN_SECRET = TEST_KEY;
  resetEnvCacheForTests();
});

afterEach(() => {
  delete mutableEnv.UNSUBSCRIBE_TOKEN_SECRET;
  resetEnvCacheForTests();
});

async function contactFixture() {
  const role = await createRoleWithPermissions("Admin", ["manage_communication_compliance"]);
  const user = await createTestUser({ roleId: role.id });
  const leadType = await createLeadTypeFixture();
  const stage = await createPipelineStageFixture("New", { isDefault: true });
  const company = await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: user.id, createdById: user.id });
  const contact = await testPrisma.contact.create({
    data: { companyId: company.id, firstName: "Jamie", lastName: "Lead", email: "jamie@example.com" },
  });
  return { user, company, contact };
}

describe("recordConsent", () => {
  it("grants permission and clears doNotContact on an EXPRESS record", async () => {
    const { contact } = await contactFixture();
    await testPrisma.contact.update({ where: { id: contact.id }, data: { doNotContact: true } });

    await recordConsent({ contactId: contact.id, type: "EXPRESS", source: "signed form" });

    const updated = await testPrisma.contact.findUniqueOrThrow({ where: { id: contact.id } });
    expect(updated.emailPermitted).toBe(true);
    expect(updated.doNotContact).toBe(false);

    const record = await testPrisma.consentRecord.findFirstOrThrow({ where: { contactId: contact.id } });
    expect(record.type).toBe("EXPRESS");
    expect(record.source).toBe("signed form");
  });

  it("sets doNotContact and clears emailPermitted on a WITHDRAWN record", async () => {
    const { contact } = await contactFixture();
    await recordConsent({ contactId: contact.id, type: "EXPRESS", source: "signed form" });

    await recordConsent({ contactId: contact.id, type: "WITHDRAWN", source: "reply email" });

    const updated = await testPrisma.contact.findUniqueOrThrow({ where: { id: contact.id } });
    expect(updated.emailPermitted).toBe(false);
    expect(updated.doNotContact).toBe(true);
    expect(updated.unsubscribedAt).not.toBeNull();
    expect(updated.unsubscribeSource).toBe("reply email");

    expect(await testPrisma.consentRecord.count({ where: { contactId: contact.id } })).toBe(2);
  });

  it("is append-only — never deletes or overwrites a prior record", async () => {
    const { contact } = await contactFixture();
    await recordConsent({ contactId: contact.id, type: "EXPRESS", source: "signed form" });
    await recordConsent({ contactId: contact.id, type: "WITHDRAWN", source: "unsubscribe_link" });
    await recordConsent({ contactId: contact.id, type: "EXPRESS", source: "called back in" });

    const history = await testPrisma.consentRecord.findMany({ where: { contactId: contact.id }, orderBy: { occurredAt: "asc" } });
    expect(history.map((r) => r.type)).toEqual(["EXPRESS", "WITHDRAWN", "EXPRESS"]);
  });
});

describe("unsubscribeByToken", () => {
  it("unsubscribes the contact identified by a valid token, with no recordedById (self-service)", async () => {
    const { contact } = await contactFixture();
    await recordConsent({ contactId: contact.id, type: "EXPRESS", source: "signed form" });
    const token = createUnsubscribeToken(contact.id);

    const outcome = await unsubscribeByToken(token);
    expect(outcome).toEqual({ ok: true, contactId: contact.id });

    const updated = await testPrisma.contact.findUniqueOrThrow({ where: { id: contact.id } });
    expect(updated.doNotContact).toBe(true);

    const record = await testPrisma.consentRecord.findFirstOrThrow({ where: { contactId: contact.id, type: "WITHDRAWN" } });
    expect(record.recordedById).toBeNull();
    expect(record.source).toBe("unsubscribe_link");
  });

  it("rejects an invalid or forged token", async () => {
    const outcome = await unsubscribeByToken("not-a-real-token");
    expect(outcome.ok).toBe(false);
  });

  it("is idempotent — following the same link twice writes only one WITHDRAWN record", async () => {
    const { contact } = await contactFixture();
    const token = createUnsubscribeToken(contact.id);

    await unsubscribeByToken(token);
    await unsubscribeByToken(token);

    expect(await testPrisma.consentRecord.count({ where: { contactId: contact.id, type: "WITHDRAWN" } })).toBe(1);
  });
});

describe("recordContactConsentAction (server action)", () => {
  it("blocks a user without manage_communication_compliance", async () => {
    const noPermRole = await createRoleWithPermissions("NoCompliance", ["edit_leads"]);
    const outsider = await createTestUser({ roleId: noPermRole.id });
    const { contact } = await contactFixture();
    await loginAs(outsider.id);

    const formData = new FormData();
    formData.set("type", "EXPRESS");
    formData.set("source", "signed form");

    await expect(recordContactConsentAction(contact.id, undefined, formData)).rejects.toThrow(/Forbidden/);
  });

  it("records consent with the authorized user as recordedById", async () => {
    const { user, contact } = await contactFixture();
    await loginAs(user.id);

    const formData = new FormData();
    formData.set("type", "IMPLIED");
    formData.set("source", "existing business relationship");

    const result = await recordContactConsentAction(contact.id, undefined, formData);
    expect(result).toBeUndefined();

    const record = await testPrisma.consentRecord.findFirstOrThrow({ where: { contactId: contact.id } });
    expect(record.recordedById).toBe(user.id);
    expect(record.type).toBe("IMPLIED");
  });

  it("requires a source", async () => {
    const { user, contact } = await contactFixture();
    await loginAs(user.id);

    const formData = new FormData();
    formData.set("type", "EXPRESS");
    formData.set("source", "");

    const result = await recordContactConsentAction(contact.id, undefined, formData);
    expect(result?.error).toMatch(/source/i);
    expect(await testPrisma.consentRecord.count()).toBe(0);
  });
});
