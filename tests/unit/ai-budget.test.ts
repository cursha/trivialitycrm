import { describe, it, expect } from "vitest";
import { evaluateAiBudget } from "../../src/lib/ai/budget";

const noSpend = { todayUsd: 0, monthUsd: 0 };

describe("evaluateAiBudget", () => {
  it("never blocks mock mode, regardless of settings", () => {
    const result = evaluateAiBudget({ isAnthropicMode: false, researchEnabled: false, spend: { todayUsd: 999, monthUsd: 999 }, dailyBudgetUsd: 1, monthlyBudgetUsd: 1 });
    expect(result.allowed).toBe(true);
  });

  it("blocks when research is disabled by an administrator (anthropic mode only)", () => {
    const result = evaluateAiBudget({ isAnthropicMode: true, researchEnabled: false, spend: noSpend, dailyBudgetUsd: null, monthlyBudgetUsd: null });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/disabled/);
  });

  it("allows a search when spend is below both budgets", () => {
    const result = evaluateAiBudget({ isAnthropicMode: true, researchEnabled: true, spend: { todayUsd: 5, monthUsd: 50 }, dailyBudgetUsd: 10, monthlyBudgetUsd: 100 });
    expect(result.allowed).toBe(true);
  });

  it("blocks once today's spend meets or exceeds the daily budget", () => {
    const atLimit = evaluateAiBudget({ isAnthropicMode: true, researchEnabled: true, spend: { todayUsd: 10, monthUsd: 10 }, dailyBudgetUsd: 10, monthlyBudgetUsd: null });
    expect(atLimit.allowed).toBe(false);
    expect(atLimit.reason).toMatch(/[Tt]oday/);

    const overLimit = evaluateAiBudget({ isAnthropicMode: true, researchEnabled: true, spend: { todayUsd: 15, monthUsd: 15 }, dailyBudgetUsd: 10, monthlyBudgetUsd: null });
    expect(overLimit.allowed).toBe(false);
  });

  it("blocks once this month's spend meets or exceeds the monthly budget, even under the daily cap", () => {
    const result = evaluateAiBudget({ isAnthropicMode: true, researchEnabled: true, spend: { todayUsd: 1, monthUsd: 100 }, dailyBudgetUsd: 50, monthlyBudgetUsd: 100 });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/month/);
  });

  it("treats a null budget as unlimited for that axis", () => {
    const result = evaluateAiBudget({ isAnthropicMode: true, researchEnabled: true, spend: { todayUsd: 100000, monthUsd: 100000 }, dailyBudgetUsd: null, monthlyBudgetUsd: null });
    expect(result.allowed).toBe(true);
  });
});
