import { describe, it, expect } from "vitest";
import { MockEnrichmentProvider } from "../../src/lib/enrichment/providers/mock";
import { getEnrichmentProvider } from "../../src/lib/enrichment/providers/factory";

describe("MockEnrichmentProvider", () => {
  it("returns one suggestion per requested field, clearly labeled and zero-cost", async () => {
    const provider = new MockEnrichmentProvider();
    const suggestions = await provider.suggest({
      entityType: "COMPANY",
      recordId: "company-1",
      currentValues: { websiteUrl: null },
      fields: ["websiteUrl", "phone"],
      requestId: "req-1",
    });

    expect(suggestions).toHaveLength(2);
    for (const suggestion of suggestions) {
      expect(suggestion.estimatedCostUsd).toBe(0);
      expect(suggestion.suggestedValue).toMatch(/mock/i);
      expect(suggestion.evidence).toMatch(/mock/i);
    }
  });

  it("is deterministic for the same input", async () => {
    const provider = new MockEnrichmentProvider();
    const input = { entityType: "COMPANY" as const, recordId: "company-1", currentValues: {}, fields: ["phone"], requestId: "req-1" };
    const first = await provider.suggest(input);
    const second = await provider.suggest(input);
    expect(first).toEqual(second);
  });
});

describe("getEnrichmentProvider", () => {
  it("always returns the mock provider", () => {
    expect(getEnrichmentProvider().name).toBe("mock");
  });
});
