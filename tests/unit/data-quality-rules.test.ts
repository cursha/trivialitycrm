import { describe, it, expect } from "vitest";
import { evaluateCompanyRule, evaluateContactRule, parseRuleConfig, DUPLICATE_RULE_TYPES } from "../../src/lib/data-quality/rules";

const baseCompany = {
  address1: "123 Main St",
  phone: "9055550134",
  email: "sales@thecopperkettle.com",
  websiteUrl: "https://thecopperkettle.com",
  name: "The Copper Kettle",
  activities: [],
  createdAt: new Date("2020-01-01"),
};

describe("evaluateCompanyRule", () => {
  it("flags a missing required field", () => {
    const result = evaluateCompanyRule({ ruleType: "REQUIRED_FIELD", field: "phone", config: {} }, { ...baseCompany, phone: null });
    expect(result.violates).toBe(true);
    expect(result.description).toMatch(/missing/i);
  });

  it("does not flag a present required field", () => {
    const result = evaluateCompanyRule({ ruleType: "REQUIRED_FIELD", field: "phone", config: {} }, baseCompany);
    expect(result.violates).toBe(false);
  });

  it("flags an invalid email format but not a valid one", () => {
    expect(evaluateCompanyRule({ ruleType: "INVALID_EMAIL_FORMAT", field: "email", config: {} }, { ...baseCompany, email: "bad" }).violates).toBe(true);
    expect(evaluateCompanyRule({ ruleType: "INVALID_EMAIL_FORMAT", field: "email", config: {} }, baseCompany).violates).toBe(false);
  });

  it("does not flag a format rule when the field is simply absent (REQUIRED_FIELD's job, not this one's)", () => {
    const result = evaluateCompanyRule({ ruleType: "INVALID_EMAIL_FORMAT", field: "email", config: {} }, { ...baseCompany, email: null });
    expect(result.violates).toBe(false);
  });

  it("flags a stale record past the configured threshold", () => {
    const staleCompany = { ...baseCompany, createdAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000) };
    const result = evaluateCompanyRule({ ruleType: "STALE_RECORD", field: "activity", config: { staleDays: 180 } }, staleCompany);
    expect(result.violates).toBe(true);
  });

  it("does not flag a record with recent activity as stale", () => {
    const recentCompany = { ...baseCompany, activities: [{ occurredAt: new Date() }] };
    const result = evaluateCompanyRule({ ruleType: "STALE_RECORD", field: "activity", config: { staleDays: 180 } }, recentCompany);
    expect(result.violates).toBe(false);
  });

  it("never evaluates a DUPLICATE_* or CUSTOM_REVIEW_FLAG rule type as a single-record violation", () => {
    for (const ruleType of [...DUPLICATE_RULE_TYPES, "CUSTOM_REVIEW_FLAG"] as const) {
      expect(evaluateCompanyRule({ ruleType, field: "name", config: {} }, baseCompany).violates).toBe(false);
    }
  });

  it("ignores a rule referencing a field name it doesn't recognize, rather than an unsafe dynamic access", () => {
    const result = evaluateCompanyRule({ ruleType: "REQUIRED_FIELD", field: "someUnknownField", config: {} }, baseCompany);
    expect(result.violates).toBe(false);
  });
});

const baseContact = {
  firstName: "Jane",
  lastName: "Doe",
  phone: "9055550134",
  email: "jane@example-real.com",
  title: "Owner",
  createdAt: new Date(),
};

describe("evaluateContactRule", () => {
  it("flags a missing required field", () => {
    const result = evaluateContactRule({ ruleType: "REQUIRED_FIELD", field: "email", config: {} }, { ...baseContact, email: null });
    expect(result.violates).toBe(true);
  });

  it("flags an invalid phone format", () => {
    const result = evaluateContactRule({ ruleType: "INVALID_PHONE_FORMAT", field: "phone", config: {} }, { ...baseContact, phone: "555-555-5555" });
    expect(result.violates).toBe(true);
  });

  it("never evaluates STALE_RECORD for a contact (no contact-scoped activity signal exists)", () => {
    const result = evaluateContactRule({ ruleType: "STALE_RECORD", field: "activity", config: {} }, baseContact);
    expect(result.violates).toBe(false);
  });
});

describe("parseRuleConfig", () => {
  it("defaults and validates a DUPLICATE_FUZZY_MATCH config", () => {
    expect(parseRuleConfig("DUPLICATE_FUZZY_MATCH", {})).toEqual({ minSimilarity: 85 });
    expect(parseRuleConfig("DUPLICATE_FUZZY_MATCH", { minSimilarity: 90 })).toEqual({ minSimilarity: 90 });
  });

  it("rejects an out-of-range value", () => {
    expect(() => parseRuleConfig("DUPLICATE_FUZZY_MATCH", { minSimilarity: 150 })).toThrow();
  });

  it("rejects an unrecognized key on a strict schema", () => {
    expect(() => parseRuleConfig("REQUIRED_FIELD", { somethingElse: true })).toThrow();
  });
});
