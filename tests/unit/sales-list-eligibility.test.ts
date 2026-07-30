import { describe, it, expect } from "vitest";
import { evaluateCompanyEligibility, type EligibilityCompany } from "../../src/lib/sales-lists/eligibility";

function company(overrides: Partial<EligibilityCompany> = {}): EligibilityCompany {
  return {
    status: "ACTIVE",
    doNotContact: false,
    isExistingCustomer: false,
    phone: "555-0100",
    primaryContact: { status: "ACTIVE", email: "hi@example.test", phone: "555-0100", doNotContact: false, unsubscribedAt: null },
    ...overrides,
  };
}

describe("evaluateCompanyEligibility — GENERAL_SALES", () => {
  it("is eligible with no blockers", () => {
    expect(evaluateCompanyEligibility(company(), "GENERAL_SALES")).toEqual({ eligible: true, reasons: [] });
  });

  it("is ineligible when archived", () => {
    const result = evaluateCompanyEligibility(company({ status: "ARCHIVED" }), "GENERAL_SALES");
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("Archived");
  });

  it("is ineligible when do-not-contact", () => {
    const result = evaluateCompanyEligibility(company({ doNotContact: true }), "GENERAL_SALES");
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("Do not contact");
  });

  it("does not require a phone or eligible contact — those are purpose-specific", () => {
    const result = evaluateCompanyEligibility(company({ phone: null, primaryContact: null }), "GENERAL_SALES");
    expect(result.eligible).toBe(true);
  });
});

describe("evaluateCompanyEligibility — CALLING", () => {
  it("is ineligible with no phone number", () => {
    const result = evaluateCompanyEligibility(company({ phone: null }), "CALLING");
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("Missing telephone number");
  });

  it("does not require an eligible email contact", () => {
    const result = evaluateCompanyEligibility(company({ primaryContact: null }), "CALLING");
    expect(result.eligible).toBe(true);
  });
});

describe("evaluateCompanyEligibility — EMAIL_CAMPAIGN", () => {
  it("is ineligible with no primary contact at all", () => {
    const result = evaluateCompanyEligibility(company({ primaryContact: null }), "EMAIL_CAMPAIGN");
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("No eligible primary contact");
  });

  it("is ineligible when the primary contact has no email", () => {
    const result = evaluateCompanyEligibility(
      company({ primaryContact: { status: "ACTIVE", email: null, phone: null, doNotContact: false, unsubscribedAt: null } }),
      "EMAIL_CAMPAIGN",
    );
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("Missing email address");
  });

  it("is ineligible when the primary contact opted out", () => {
    const result = evaluateCompanyEligibility(
      company({ primaryContact: { status: "ACTIVE", email: "hi@example.test", phone: null, doNotContact: true, unsubscribedAt: null } }),
      "EMAIL_CAMPAIGN",
    );
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("Contact has opted out / do not contact");
  });

  it("is ineligible when the primary contact unsubscribed", () => {
    const result = evaluateCompanyEligibility(
      company({ primaryContact: { status: "ACTIVE", email: "hi@example.test", phone: null, doNotContact: false, unsubscribedAt: new Date() } }),
      "EMAIL_CAMPAIGN",
    );
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("Unsubscribed");
  });

  it("is ineligible when the primary contact's address has a permanent bounce on file", () => {
    const result = evaluateCompanyEligibility(company({ primaryContactHasPermanentBounce: true }), "EMAIL_CAMPAIGN");
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("Permanent email bounce on file");
  });

  it("is ineligible when the primary contact was merged away", () => {
    const result = evaluateCompanyEligibility(
      company({ primaryContact: { status: "MERGED", email: "hi@example.test", phone: null, doNotContact: false, unsubscribedAt: null } }),
      "EMAIL_CAMPAIGN",
    );
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("No eligible primary contact");
  });

  it("is ineligible for an existing customer, per campaign rules", () => {
    const result = evaluateCompanyEligibility(company({ isExistingCustomer: true }), "EMAIL_CAMPAIGN");
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("Existing customer excluded by campaign rules");
  });

  it("never overrides a universal blocker even when the contact itself is fine", () => {
    const result = evaluateCompanyEligibility(company({ status: "ARCHIVED" }), "EMAIL_CAMPAIGN");
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("Archived");
  });

  it("is eligible with a clean, permitted contact", () => {
    expect(evaluateCompanyEligibility(company(), "EMAIL_CAMPAIGN")).toEqual({ eligible: true, reasons: [] });
  });
});
