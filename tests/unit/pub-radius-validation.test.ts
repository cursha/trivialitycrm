import { describe, it, expect } from "vitest";
import { PubRadiusSetupSchema } from "../../src/lib/validation/pub-radius";

describe("PubRadiusSetupSchema", () => {
  it("accepts a valid miles radius within bounds", () => {
    const result = PubRadiusSetupSchema.safeParse({ originCompanyId: "company-1", radiusValue: 5, radiusUnit: "MI" });
    expect(result.success).toBe(true);
  });

  it("defaults radiusUnit to MI when omitted", () => {
    const result = PubRadiusSetupSchema.safeParse({ originCompanyId: "company-1", radiusValue: 5 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.radiusUnit).toBe("MI");
  });

  it("accepts the miles lower bound (1) and rejects one below it", () => {
    expect(PubRadiusSetupSchema.safeParse({ originCompanyId: "c", radiusValue: 1, radiusUnit: "MI" }).success).toBe(true);
    expect(PubRadiusSetupSchema.safeParse({ originCompanyId: "c", radiusValue: 0, radiusUnit: "MI" }).success).toBe(false);
  });

  it("accepts the miles upper bound (50) and rejects one above it", () => {
    expect(PubRadiusSetupSchema.safeParse({ originCompanyId: "c", radiusValue: 50, radiusUnit: "MI" }).success).toBe(true);
    expect(PubRadiusSetupSchema.safeParse({ originCompanyId: "c", radiusValue: 51, radiusUnit: "MI" }).success).toBe(false);
  });

  it("accepts the kilometers lower bound (1) and rejects one below it", () => {
    expect(PubRadiusSetupSchema.safeParse({ originCompanyId: "c", radiusValue: 1, radiusUnit: "KM" }).success).toBe(true);
    expect(PubRadiusSetupSchema.safeParse({ originCompanyId: "c", radiusValue: 0, radiusUnit: "KM" }).success).toBe(false);
  });

  it("accepts the kilometers upper bound (80) and rejects one above it", () => {
    expect(PubRadiusSetupSchema.safeParse({ originCompanyId: "c", radiusValue: 80, radiusUnit: "KM" }).success).toBe(true);
    expect(PubRadiusSetupSchema.safeParse({ originCompanyId: "c", radiusValue: 81, radiusUnit: "KM" }).success).toBe(false);
  });

  it("rejects a radius that's valid in KM but out of bounds interpreted for MI's own range (units aren't silently cross-converted)", () => {
    // 60 is within KM's 1-80 bound but outside MI's 1-50 bound — confirms
    // bounds are evaluated against the unit actually chosen, not a single
    // shared range.
    expect(PubRadiusSetupSchema.safeParse({ originCompanyId: "c", radiusValue: 60, radiusUnit: "KM" }).success).toBe(true);
    expect(PubRadiusSetupSchema.safeParse({ originCompanyId: "c", radiusValue: 60, radiusUnit: "MI" }).success).toBe(false);
  });

  it("requires an originCompanyId", () => {
    expect(PubRadiusSetupSchema.safeParse({ originCompanyId: "", radiusValue: 5, radiusUnit: "MI" }).success).toBe(false);
  });

  it("rejects a non-integer radius", () => {
    expect(PubRadiusSetupSchema.safeParse({ originCompanyId: "c", radiusValue: 5.5, radiusUnit: "MI" }).success).toBe(false);
  });
});
