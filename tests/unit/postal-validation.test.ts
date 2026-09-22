import { describe, it, expect } from "vitest";
import { checkPostalCode, checkCompanyAddressField } from "../../src/lib/validation/postal";
import { CompanySchema } from "../../src/lib/validation/company";
import { TransferRowSchema } from "../../src/lib/validation/transfer";
import { mapAndValidateRow } from "../../src/lib/validation/import";

describe("checkPostalCode", () => {
  it("formats Canadian codes as A1A 1A1", () => {
    expect(checkPostalCode("l9t2x5", "Canada", "ON")).toEqual({ value: "L9T 2X5" });
    expect(checkPostalCode(" L9T-2X5 ", "Canada", "ON")).toEqual({ value: "L9T 2X5" });
  });

  it("rejects malformed Canadian codes and letters Canada Post never uses", () => {
    expect(checkPostalCode("L9T 2X", "Canada", "ON")).toHaveProperty("error");
    expect(checkPostalCode("12345", "Canada", "ON")).toHaveProperty("error");
    expect(checkPostalCode("D9T 2X5", "Canada", "ON")).toHaveProperty("error");
    expect(checkPostalCode("W1A 1A1", "Canada", "ON")).toHaveProperty("error");
    expect(checkPostalCode("L9O 2X5", "Canada", "ON")).toHaveProperty("error");
  });

  it("rejects a Canadian code from a different province", () => {
    expect(checkPostalCode("A1C 3W8", "Canada", "ON")).toEqual({ error: "Postal code A1C 3W8 is in NL, not ON." });
    expect(checkPostalCode("X0A 0H0", "Canada", "NU")).toEqual({ value: "X0A 0H0" });
  });

  it("formats US ZIP and ZIP+4", () => {
    expect(checkPostalCode("80202", "United States", "CO")).toEqual({ value: "80202" });
    expect(checkPostalCode("802021234", "USA", "CO")).toEqual({ value: "80202-1234" });
    expect(checkPostalCode("80202-1234", "US", "CO")).toEqual({ value: "80202-1234" });
  });

  it("rejects malformed US ZIPs", () => {
    expect(checkPostalCode("8020", "United States", "CO")).toHaveProperty("error");
    expect(checkPostalCode("L9T 2X5", "United States", "CO")).toHaveProperty("error");
  });

  it("leaves blank blank and passes unknown countries through", () => {
    expect(checkPostalCode("", "Canada", "ON")).toEqual({ value: undefined });
    expect(checkPostalCode(null, "Canada", "ON")).toEqual({ value: undefined });
    expect(checkPostalCode("SW1A 1AA", "United Kingdom")).toEqual({ value: "SW1A 1AA" });
  });
});

describe("checkCompanyAddressField", () => {
  const company = { country: "Canada", region: "ON" };

  it("uppercases a 2-letter region and rejects a full name", () => {
    expect(checkCompanyAddressField("region", "on", company)).toEqual({ value: "ON" });
    expect(checkCompanyAddressField("region", "Ontario", company)).toHaveProperty("error");
  });

  it("checks postalCode against the company's country and province", () => {
    expect(checkCompanyAddressField("postalCode", "k1k4e6", company)).toEqual({ value: "K1K 4E6" });
    expect(checkCompanyAddressField("postalCode", "T2P 1J9", company)).toHaveProperty("error");
    expect(checkCompanyAddressField("postalCode", "", company)).toEqual({ value: null });
  });

  it("passes other fields through untouched", () => {
    expect(checkCompanyAddressField("phone", "555-0100", company)).toEqual({ value: "555-0100" });
  });
});

describe("schemas that create companies", () => {
  const companyBase = {
    name: "The Copper Kettle",
    city: "milton",
    region: "on",
    country: "Canada",
    leadTypeId: "lt",
    pipelineStageId: "ps",
    triviaStatus: "UNCERTAIN",
  };

  it("CompanySchema formats a valid postal code", () => {
    const result = CompanySchema.safeParse({ ...companyBase, postalCode: "l9t2x5" });
    expect(result.success && result.data.postalCode).toBe("L9T 2X5");
  });

  it("CompanySchema reports a bad postal code on the postalCode field", () => {
    const result = CompanySchema.safeParse({ ...companyBase, postalCode: "L9T" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["postalCode"]);
  });

  it("CompanySchema still allows a blank postal code", () => {
    const result = CompanySchema.safeParse({ ...companyBase, postalCode: "" });
    expect(result.success && result.data.postalCode).toBeUndefined();
  });

  it("TransferRowSchema rejects a postal code from another province", () => {
    const result = TransferRowSchema.safeParse({ resultId: "r1", name: "Bar", city: "Denver", region: "CO", country: "United States", postalCode: "L9T 2X5" });
    expect(result.success).toBe(false);
  });

  it("mapAndValidateRow formats and validates postal codes", () => {
    const mapping = { name: "Name", city: "City", region: "Prov", country: "Nation", postalCode: "Postal" };
    const ok = mapAndValidateRow({ Name: "Bar", City: "Milton", Prov: "ON", Nation: "Canada", Postal: "l9t2x5" }, mapping);
    expect(ok.errors).toHaveLength(0);
    expect(ok.values.postalCode).toBe("L9T 2X5");
    const bad = mapAndValidateRow({ Name: "Bar", City: "Milton", Prov: "ON", Nation: "Canada", Postal: "A1C 3W8" }, mapping);
    expect(bad.errors).toContain("Postal code A1C 3W8 is in NL, not ON.");
  });
});
