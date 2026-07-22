import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, createLeadTypeFixture, createPipelineStageFixture, createCompanyFixture } from "../helpers/fixtures";
import { mergeContacts, ContactMergeError } from "../../src/lib/data-quality/merge-contact";

beforeEach(async () => {
  await resetDatabase();
});

async function baseFixtures() {
  const role = await createRoleWithPermissions("Administrator", ["view_all_leads", "edit_leads"]);
  const admin = await createTestUser({ roleId: role.id });
  const leadType = await createLeadTypeFixture();
  const stage = await createPipelineStageFixture();
  const company = await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: admin.id, createdById: admin.id });
  return { admin, leadType, stage, company };
}

describe("mergeContacts", () => {
  it("reassigns EmailMessage/Appointment/ConsentRecord/SequenceEnrollment onto the surviving contact", async () => {
    const { admin, company } = await baseFixtures();
    const surviving = await testPrisma.contact.create({ data: { companyId: company.id, firstName: "Jane", lastName: "Doe" } });
    const merged = await testPrisma.contact.create({ data: { companyId: company.id, firstName: "Janet", lastName: "Doe" } });

    const consent = await testPrisma.consentRecord.create({ data: { contactId: merged.id, type: "EXPRESS", source: "test" } });
    const appointment = await testPrisma.appointment.create({
      data: { companyId: company.id, contactId: merged.id, type: "DEMO", title: "Demo", startAt: new Date(), endAt: new Date(), timezone: "America/Toronto", createdById: admin.id },
    });

    await mergeContacts({ survivingContactId: surviving.id, mergedContactId: merged.id, fieldDecisions: {}, actorId: admin.id });

    expect((await testPrisma.consentRecord.findUniqueOrThrow({ where: { id: consent.id } })).contactId).toBe(surviving.id);
    expect((await testPrisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).contactId).toBe(surviving.id);

    const tombstoned = await testPrisma.contact.findUniqueOrThrow({ where: { id: merged.id } });
    expect(tombstoned.status).toBe("MERGED");
    expect(tombstoned.mergedIntoId).toBe(surviving.id);
  });

  it("applies field decisions and writes an audit event", async () => {
    const { admin, company } = await baseFixtures();
    const surviving = await testPrisma.contact.create({ data: { companyId: company.id, firstName: "Jane", lastName: "Doe" } });
    const merged = await testPrisma.contact.create({ data: { companyId: company.id, firstName: "Janet", lastName: "Doe", phone: "9055550134" } });

    await mergeContacts({ survivingContactId: surviving.id, mergedContactId: merged.id, fieldDecisions: { phone: "9055550134" }, actorId: admin.id });

    const result = await testPrisma.contact.findUniqueOrThrow({ where: { id: surviving.id } });
    expect(result.phone).toBe("9055550134");

    const auditEvent = await testPrisma.dataQualityAuditEvent.findFirst({ where: { action: "CONTACT_MERGED", contactId: surviving.id } });
    expect(auditEvent).not.toBeNull();
  });

  it("resolves consent conflicts to the most restrictive value automatically", async () => {
    const { admin, company } = await baseFixtures();
    const surviving = await testPrisma.contact.create({ data: { companyId: company.id, firstName: "Jane", lastName: "Doe", emailPermitted: true, doNotContact: false } });
    const merged = await testPrisma.contact.create({ data: { companyId: company.id, firstName: "Janet", lastName: "Doe", emailPermitted: true, doNotContact: true, unsubscribedAt: new Date("2024-01-01"), unsubscribeSource: "unsubscribe_link" } });

    await mergeContacts({ survivingContactId: surviving.id, mergedContactId: merged.id, fieldDecisions: {}, actorId: admin.id });

    const result = await testPrisma.contact.findUniqueOrThrow({ where: { id: surviving.id } });
    expect(result.doNotContact).toBe(true);
    expect(result.emailPermitted).toBe(false);
    expect(result.unsubscribedAt).toEqual(new Date("2024-01-01"));
  });

  it("rejects merging contacts that belong to different companies", async () => {
    const { admin, leadType, stage, company } = await baseFixtures();
    const otherCompany = await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: admin.id, createdById: admin.id });
    const a = await testPrisma.contact.create({ data: { companyId: company.id, firstName: "Jane", lastName: "Doe" } });
    const b = await testPrisma.contact.create({ data: { companyId: otherCompany.id, firstName: "Jane", lastName: "Doe" } });

    await expect(mergeContacts({ survivingContactId: a.id, mergedContactId: b.id, fieldDecisions: {}, actorId: admin.id })).rejects.toThrow(ContactMergeError);
  });

  it("prevents merging an already-merged contact again", async () => {
    const { admin, company } = await baseFixtures();
    const a = await testPrisma.contact.create({ data: { companyId: company.id, firstName: "A", lastName: "One" } });
    const b = await testPrisma.contact.create({ data: { companyId: company.id, firstName: "B", lastName: "Two" } });
    const c = await testPrisma.contact.create({ data: { companyId: company.id, firstName: "C", lastName: "Three" } });

    await mergeContacts({ survivingContactId: a.id, mergedContactId: b.id, fieldDecisions: {}, actorId: admin.id });

    await expect(mergeContacts({ survivingContactId: c.id, mergedContactId: b.id, fieldDecisions: {}, actorId: admin.id })).rejects.toThrow(/already been merged/);
  });
});
