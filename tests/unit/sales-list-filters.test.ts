import { describe, it, expect } from "vitest";
import { SalesListFiltersSchema, parseSalesListFilters, toCompanyListParams } from "../../src/lib/sales-lists/filters";

describe("SalesListFiltersSchema", () => {
  it("accepts a full, realistic filter set", () => {
    const result = SalesListFiltersSchema.safeParse({
      country: "Canada",
      region: "ON",
      cities: ["Milton", "Oakville"],
      leadTypeId: "lt-1",
      scoreMin: 50,
      scoreMax: 100,
      neverContactedOnly: true,
      hasPhone: true,
      isExistingCustomer: false,
      status: "ACTIVE",
      sortBy: "eosScore",
      sortDir: "desc",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown key (never raw/executable query shape)", () => {
    const result = SalesListFiltersSchema.safeParse({ where: "1=1" });
    expect(result.success).toBe(false);
  });

  it("rejects a malformed date", () => {
    const result = SalesListFiltersSchema.safeParse({ lastContactedBefore: "01/01/2026" });
    expect(result.success).toBe(false);
  });
});

describe("parseSalesListFilters", () => {
  it("degrades to an empty filter set for a stale/invalid stored value rather than throwing", () => {
    expect(parseSalesListFilters({ where: "1=1" })).toEqual({});
    expect(parseSalesListFilters(null)).toEqual({});
  });
});

describe("toCompanyListParams", () => {
  it("defaults status to ACTIVE when the saved filters don't specify one", () => {
    expect(toCompanyListParams({ city: "Milton" }).status).toBe("ACTIVE");
  });

  it("passes through an explicit ARCHIVED status", () => {
    expect(toCompanyListParams({ status: "ARCHIVED" }).status).toBe("ARCHIVED");
  });
});
