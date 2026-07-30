import { describe, it, expect } from "vitest";
import { sortCompaniesForCalling, normalizeCallingOrderField, resolveCallingOrderDir } from "../../src/lib/calling/order";

function company(overrides: Partial<Parameters<typeof sortCompaniesForCalling>[0][number]> = {}) {
  return {
    id: "c1",
    name: "Co",
    city: "Milton",
    salesPriorityScore: null,
    eosScore: null,
    nextFollowUpAt: null,
    pipelineStage: { sortOrder: 0 },
    ...overrides,
  };
}

describe("normalizeCallingOrderField", () => {
  it("falls back to salesPriorityScore for an unknown/missing value", () => {
    expect(normalizeCallingOrderField("not-a-real-field")).toBe("salesPriorityScore");
    expect(normalizeCallingOrderField(null)).toBe("salesPriorityScore");
  });
});

describe("resolveCallingOrderDir", () => {
  it("uses each field's natural direction when none is given", () => {
    expect(resolveCallingOrderDir("salesPriorityScore")).toBe("desc");
    expect(resolveCallingOrderDir("lastContact")).toBe("asc");
    expect(resolveCallingOrderDir("nextFollowUpAt")).toBe("asc");
    expect(resolveCallingOrderDir("name")).toBe("asc");
  });

  it("respects an explicit override", () => {
    expect(resolveCallingOrderDir("salesPriorityScore", "asc")).toBe("asc");
  });
});

describe("sortCompaniesForCalling", () => {
  it("sorts by highest sales priority by default", () => {
    const companies = [company({ id: "low", salesPriorityScore: 10 }), company({ id: "high", salesPriorityScore: 90 })];
    const sorted = sortCompaniesForCalling(companies, "salesPriorityScore", null, {});
    expect(sorted.map((c) => c.id)).toEqual(["high", "low"]);
  });

  it("sorts by highest EOS score", () => {
    const companies = [company({ id: "a", eosScore: 50 }), company({ id: "b", eosScore: 80 })];
    const sorted = sortCompaniesForCalling(companies, "eosScore", null, {});
    expect(sorted.map((c) => c.id)).toEqual(["b", "a"]);
  });

  it("sorts by oldest contact date first, treating never-contacted as the oldest", () => {
    const companies = [company({ id: "recent" }), company({ id: "old" }), company({ id: "never" })];
    const lastContact = { recent: new Date("2026-07-01"), old: new Date("2026-01-01") };
    const sorted = sortCompaniesForCalling(companies, "lastContact", null, lastContact);
    expect(sorted.map((c) => c.id)).toEqual(["never", "old", "recent"]);
  });

  it("sorts by most overdue follow-up first, nulls last", () => {
    const companies = [
      company({ id: "none" }),
      company({ id: "later", nextFollowUpAt: new Date("2026-08-01") }),
      company({ id: "mostOverdue", nextFollowUpAt: new Date("2026-01-01") }),
    ];
    const sorted = sortCompaniesForCalling(companies, "nextFollowUpAt", null, {});
    expect(sorted.map((c) => c.id)).toEqual(["mostOverdue", "later", "none"]);
  });

  it("sorts alphabetically by company name", () => {
    const companies = [company({ id: "b", name: "Bravo" }), company({ id: "a", name: "Alpha" })];
    const sorted = sortCompaniesForCalling(companies, "name", null, {});
    expect(sorted.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("sorts by city", () => {
    const companies = [company({ id: "t", city: "Toronto" }), company({ id: "m", city: "Milton" })];
    const sorted = sortCompaniesForCalling(companies, "city", null, {});
    expect(sorted.map((c) => c.id)).toEqual(["m", "t"]);
  });

  it("sorts by pipeline stage order", () => {
    const companies = [company({ id: "late", pipelineStage: { sortOrder: 3 } }), company({ id: "early", pipelineStage: { sortOrder: 1 } })];
    const sorted = sortCompaniesForCalling(companies, "pipelineStage", null, {});
    expect(sorted.map((c) => c.id)).toEqual(["early", "late"]);
  });

  it("respects an explicit direction override even for a field with a different natural default", () => {
    const companies = [company({ id: "low", salesPriorityScore: 10 }), company({ id: "high", salesPriorityScore: 90 })];
    const sorted = sortCompaniesForCalling(companies, "salesPriorityScore", "asc", {});
    expect(sorted.map((c) => c.id)).toEqual(["low", "high"]);
  });
});
