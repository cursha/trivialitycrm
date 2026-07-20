import { describe, it, expect } from "vitest";
import { SavedViewFiltersSchema, parseSavedViewFilters } from "../../src/lib/workspace/saved-view-filters";

describe("SavedViewFiltersSchema", () => {
  it("accepts an empty object (no filters)", () => {
    expect(SavedViewFiltersSchema.safeParse({}).success).toBe(true);
  });

  it("accepts a valid, fully-populated filter set", () => {
    const result = SavedViewFiltersSchema.safeParse({
      leadTypeId: "lt1",
      assignedToId: "u1",
      territoryId: "t1",
      cities: ["Toronto", "Ottawa"],
      opportunityGrade: "A",
      scoreMin: 10,
      scoreMax: 90,
      followUp: "overdue",
      status: "ARCHIVED",
      sortBy: "createdAt",
      sortDir: "desc",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown key — no raw/unexpected shape is ever accepted", () => {
    const result = SavedViewFiltersSchema.safeParse({ leadTypeId: "lt1", maliciousSql: "DROP TABLE Company" });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid enum value", () => {
    const result = SavedViewFiltersSchema.safeParse({ opportunityGrade: "Z" });
    expect(result.success).toBe(false);
  });

  it("rejects a score outside 0-100", () => {
    expect(SavedViewFiltersSchema.safeParse({ scoreMin: -5 }).success).toBe(false);
    expect(SavedViewFiltersSchema.safeParse({ scoreMax: 101 }).success).toBe(false);
  });

  it("rejects a malformed date", () => {
    expect(SavedViewFiltersSchema.safeParse({ createdFrom: "not-a-date" }).success).toBe(false);
  });

  it("never accepts a non-object payload (e.g. a raw string)", () => {
    expect(SavedViewFiltersSchema.safeParse("SELECT * FROM Company").success).toBe(false);
  });
});

describe("parseSavedViewFilters", () => {
  it("returns the parsed object on valid input", () => {
    expect(parseSavedViewFilters({ leadTypeId: "lt1" })).toEqual({ leadTypeId: "lt1" });
  });

  it("fails safe to an empty object on invalid/legacy-shaped stored data, never throwing", () => {
    expect(parseSavedViewFilters({ notAField: "x" })).toEqual({});
    expect(parseSavedViewFilters("garbage")).toEqual({});
    expect(parseSavedViewFilters(null)).toEqual({});
  });
});
