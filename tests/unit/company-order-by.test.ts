import { describe, it, expect } from "vitest";
import { companyOrderBy } from "../../src/app/(dashboard)/companies/queries";

describe("companyOrderBy", () => {
  it("defaults to name ascending, with id as the tie-breaker", () => {
    expect(companyOrderBy(undefined, undefined)).toEqual([{ name: "asc" }, { id: "asc" }]);
    expect(companyOrderBy("notAField", "sideways")).toEqual([{ name: "asc" }, { id: "asc" }]);
  });

  it("always puts empty EOS scores and follow-up dates last, in either direction", () => {
    expect(companyOrderBy("eosScore", "desc")).toEqual([{ eosScore: { sort: "desc", nulls: "last" } }, { name: "asc" }, { id: "asc" }]);
    expect(companyOrderBy("eosScore", "asc")).toEqual([{ eosScore: { sort: "asc", nulls: "last" } }, { name: "asc" }, { id: "asc" }]);
    expect(companyOrderBy("nextFollowUpAt", "desc")).toEqual([{ nextFollowUpAt: { sort: "desc", nulls: "last" } }, { name: "asc" }, { id: "asc" }]);
  });

  it("breaks ties on required fields by name, then id", () => {
    expect(companyOrderBy("city", "desc")).toEqual([{ city: "desc" }, { name: "asc" }, { id: "asc" }]);
    expect(companyOrderBy("createdAt", "asc")).toEqual([{ createdAt: "asc" }, { name: "asc" }, { id: "asc" }]);
  });
});
