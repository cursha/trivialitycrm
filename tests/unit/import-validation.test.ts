import { describe, it, expect } from "vitest";
import { mapAndValidateRow } from "../../src/lib/validation/import";

describe("mapAndValidateRow", () => {
  const mapping = { name: "Business Name", city: "City", region: "Prov", country: "Nation", email: "Email" };

  it("maps columns and passes validation for a complete row", () => {
    const result = mapAndValidateRow(
      { "Business Name": "The Copper Kettle", City: "Milton", Prov: "ON", Nation: "Canada", Email: "hi@example.test" },
      mapping,
    );
    expect(result.errors).toHaveLength(0);
    expect(result.values.name).toBe("The Copper Kettle");
    expect(result.values.email).toBe("hi@example.test");
  });

  it("reports missing required fields", () => {
    const result = mapAndValidateRow({ "Business Name": "", City: "Milton", Prov: "", Nation: "Canada" }, mapping);
    expect(result.errors).toContain('Missing required field "name".');
    expect(result.errors).toContain('Missing required field "region".');
  });

  it("flags an invalid email without crashing", () => {
    const result = mapAndValidateRow(
      { "Business Name": "Bar", City: "Milton", Prov: "ON", Nation: "Canada", Email: "not-an-email" },
      mapping,
    );
    expect(result.errors).toContain("Invalid company email.");
  });

  it("leaves unmapped optional fields empty rather than erroring", () => {
    const result = mapAndValidateRow({ "Business Name": "Bar", City: "Milton", Prov: "ON", Nation: "Canada" }, mapping);
    expect(result.errors).toHaveLength(0);
    expect(result.values.phone).toBe("");
  });

  it("rejects a full state/province name instead of a 2-letter code", () => {
    const result = mapAndValidateRow({ "Business Name": "Bar", City: "Milton", Prov: "Ontario", Nation: "Canada" }, mapping);
    expect(result.errors).toContain("Region must be a 2-letter state/province code (e.g. ON, CO) — not the full name.");
  });

  it("title-cases city and uppercases region on import", () => {
    const result = mapAndValidateRow({ "Business Name": "Bar", City: "milton", Prov: "on", Nation: "Canada" }, mapping);
    expect(result.values.city).toBe("Milton");
    expect(result.values.region).toBe("ON");
  });
});
