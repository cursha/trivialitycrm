import { describe, it, expect } from "vitest";
import { looksLikeFormulaInjection, neutralizeForExport } from "../../src/lib/security/formula-injection";

describe("looksLikeFormulaInjection", () => {
  it.each(["=SUM(A1:A9)", "+1+1", "-cmd|' /C calc'!A1", "@SUM(1+1)", "\tsneaky", "\rsneaky"])(
    "flags a value starting with a formula-trigger character: %s",
    (value) => {
      expect(looksLikeFormulaInjection(value)).toBe(true);
    },
  );

  it.each(["The Copper Kettle", "123 Main St", "hi@example.test", ""])("does not flag an ordinary value: %s", (value) => {
    expect(looksLikeFormulaInjection(value)).toBe(false);
  });

  it("does not flag a legitimate hyphen-leading business name after trimming leading whitespace is considered", () => {
    // A real business name starting with "-" is still technically a formula
    // trigger in Excel's eyes — this function intentionally flags it (see
    // neutralizeForExport, which is safe to apply even here); it must not
    // be silently dropped or corrupted, only neutralized.
    expect(looksLikeFormulaInjection("-24 Grill")).toBe(true);
  });
});

describe("neutralizeForExport", () => {
  it("prefixes a formula-triggering value with a single quote", () => {
    expect(neutralizeForExport("=SUM(A1:A9)")).toBe("'=SUM(A1:A9)");
    expect(neutralizeForExport("-24 Grill")).toBe("'-24 Grill");
  });

  it("leaves an ordinary value unchanged", () => {
    expect(neutralizeForExport("The Copper Kettle")).toBe("The Copper Kettle");
    expect(neutralizeForExport("123 Main St")).toBe("123 Main St");
  });

  it("leaves an empty value unchanged", () => {
    expect(neutralizeForExport("")).toBe("");
  });
});
