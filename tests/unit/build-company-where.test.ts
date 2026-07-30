import { describe, it, expect } from "vitest";
import { buildCompanyWhere } from "../../src/app/(dashboard)/companies/queries";
import type { AuthenticatedUser } from "../../src/lib/auth/current-user";

function fakeUser(): AuthenticatedUser {
  return {
    id: "user-1",
    teamId: "team-1",
    role: { permissions: [{ allowed: true, permission: { key: "view_all_leads" } }] },
  } as unknown as AuthenticatedUser;
}

function clauses(params: Parameters<typeof buildCompanyWhere>[1]) {
  const where = buildCompanyWhere(fakeUser(), params);
  return (where as { AND: unknown[] }).AND;
}

describe("buildCompanyWhere — Sales Lists filter extensions", () => {
  it("filters by EOS score range", () => {
    const result = clauses({ scoreMin: 60, scoreMax: 90 });
    expect(result).toContainEqual({ eosScore: { gte: 60 } });
    expect(result).toContainEqual({ eosScore: { lte: 90 } });
  });

  it("filters by created-date range", () => {
    const result = clauses({ createdFrom: "2026-01-01", createdTo: "2026-06-30" });
    expect(result).toContainEqual({ createdAt: { gte: new Date("2026-01-01") } });
    expect(result).toContainEqual({ createdAt: { lte: new Date("2026-06-30") } });
  });

  it("filters by multiple cities (OR, case-insensitive)", () => {
    const result = clauses({ cities: ["Milton", "Oakville"] });
    expect(result).toContainEqual({
      OR: [{ city: { equals: "Milton", mode: "insensitive" } }, { city: { equals: "Oakville", mode: "insensitive" } }],
    });
  });

  it("never-contacted-only excludes companies with any contact-type activity", () => {
    const result = clauses({ neverContactedOnly: true });
    expect(result).toContainEqual({
      activities: { none: { type: { in: ["PHONE", "EMAIL", "MEETING", "MATERIAL_SENT", "DEMO", "TRIAL"] } } },
    });
  });

  it("last-contacted-before requires a contact history AND that the most recent one predates the cutoff", () => {
    const result = clauses({ lastContactedBefore: "2026-01-01" });
    const contactTypes = ["PHONE", "EMAIL", "MEETING", "MATERIAL_SENT", "DEMO", "TRIAL"];
    expect(result).toContainEqual({ activities: { some: { type: { in: contactTypes } } } });
    expect(result).toContainEqual({
      activities: { none: { type: { in: contactTypes }, occurredAt: { gte: new Date("2026-01-01") } } },
    });
  });

  it("filters by phone/email availability", () => {
    expect(clauses({ hasPhone: true })).toContainEqual({ phone: { not: null } });
    expect(clauses({ hasPhone: false })).toContainEqual({ phone: null });
    expect(clauses({ hasEmail: true })).toContainEqual({ email: { not: null } });
    expect(clauses({ hasEmail: false })).toContainEqual({ email: null });
  });

  it("filters by existing-customer and do-not-contact flags", () => {
    expect(clauses({ isExistingCustomer: true })).toContainEqual({ isExistingCustomer: true });
    expect(clauses({ doNotContactOnly: true })).toContainEqual({ doNotContact: true });
  });

  it("filters by never-analyzed and last-analyzed-before", () => {
    expect(clauses({ neverAnalyzedOnly: true })).toContainEqual({ lastScoredAt: null });
    expect(clauses({ lastAnalyzedBefore: "2026-01-01" })).toContainEqual({
      lastScoredAt: { not: null, lt: new Date("2026-01-01") },
    });
  });

  it("filters by open data-quality warnings", () => {
    const result = clauses({ hasDataQualityWarnings: true });
    expect(result).toContainEqual({ dataQualityIssues: { some: { status: { in: ["OPEN", "REOPENED", "DEFERRED"] } } } });
  });

  it("omits every new clause when no new params are given", () => {
    const result = clauses({});
    expect(result).toHaveLength(2); // scope + default ACTIVE status only
  });
});
