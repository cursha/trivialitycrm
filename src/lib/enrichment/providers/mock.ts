// Safe, no-network provider — the only EnrichmentProvider implementation in
// this module. Output is deterministic (not random) and clearly labeled so
// it's never mistaken for a real suggestion, mirroring src/lib/research/
// providers/mock.ts's and src/lib/comms/providers/mock.ts's conventions.
// Zero cost, zero network calls — no suggestion here should ever be trusted
// as real data; a user must still explicitly accept it (see Section 9 of
// the plan) before it touches a Company/Contact row.
import type { EnrichmentProvider, EnrichmentSuggestInput, EnrichmentSuggestion } from "./types";

export class MockEnrichmentProvider implements EnrichmentProvider {
  readonly name = "mock";

  async suggest(input: EnrichmentSuggestInput): Promise<EnrichmentSuggestion[]> {
    return input.fields.map((field) => {
      const current = input.currentValues[field];
      return {
        field,
        suggestedValue: current
          ? `${current} [mock-verified]`
          : `[Mock enrichment] ${field} suggestion for ${input.entityType.toLowerCase()} ${input.recordId}`,
        sourceUrl: "https://example.com/mock-enrichment-source",
        evidence: `[Mock enrichment] No real lookup was performed — this is deterministic placeholder evidence for field "${field}".`,
        confidence: "LOW",
        estimatedCostUsd: 0,
      };
    });
  }
}
