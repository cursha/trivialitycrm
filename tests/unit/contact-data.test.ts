import { describe, it, expect } from "vitest";
import { readContactDataEntries } from "../../src/lib/research/contact-data";

describe("readContactDataEntries", () => {
  it("returns an empty array for null", () => {
    expect(readContactDataEntries(null)).toEqual([]);
  });

  it("returns an empty array for undefined", () => {
    expect(readContactDataEntries(undefined)).toEqual([]);
  });

  it("wraps a legacy single-object value in an array", () => {
    const legacy = { firstName: "Jamie", lastName: "Lee" };
    expect(readContactDataEntries(legacy)).toEqual([legacy]);
  });

  it("passes an array through as-is", () => {
    const entries = [{ firstName: "Jamie" }, { firstName: "Alex" }];
    expect(readContactDataEntries(entries)).toEqual(entries);
  });

  it("filters out non-object entries from a malformed array", () => {
    const entries = [{ firstName: "Jamie" }, "not an object", 42, null];
    expect(readContactDataEntries(entries)).toEqual([{ firstName: "Jamie" }]);
  });

  it("returns an empty array for other malformed JSON (a string or number)", () => {
    expect(readContactDataEntries("garbage")).toEqual([]);
    expect(readContactDataEntries(42)).toEqual([]);
  });
});
