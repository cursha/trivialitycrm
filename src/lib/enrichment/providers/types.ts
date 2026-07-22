// Third instance of this codebase's provider pattern (types.ts -> mock.ts
// -> factory.ts), mirroring src/lib/research/providers/ and src/lib/comms/
// providers/. Module Seven implements only the mock provider — no real
// enrichment service is purchased, enabled, or called; this interface is
// the seam a future module fills in, the same "structurally honest stub"
// precedent as Module Six's Gmail-inbound methods.

export type EnrichmentEntityType = "COMPANY" | "CONTACT";

export type EnrichmentSuggestInput = {
  entityType: EnrichmentEntityType;
  recordId: string;
  /** Current field values, keyed by field name — the provider never
   * receives more than it needs to produce a suggestion. */
  currentValues: Record<string, string | null>;
  /** Which fields a suggestion is wanted for. */
  fields: string[];
  requestId: string;
};

export type EnrichmentSuggestion = {
  field: string;
  suggestedValue: string;
  sourceUrl?: string;
  evidence: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  estimatedCostUsd: number;
};

export interface EnrichmentProvider {
  readonly name: string;
  suggest(input: EnrichmentSuggestInput): Promise<EnrichmentSuggestion[]>;
}
