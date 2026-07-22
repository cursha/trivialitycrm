import type { EnrichmentProvider } from "./types";
import { MockEnrichmentProvider } from "./mock";

/**
 * Returns the mock provider unconditionally — no real enrichment provider
 * is implemented in this module (per the plan: "do not purchase or enable
 * paid enrichment services," "do not make live third-party enrichment
 * calls"). Deliberately no env var to branch on yet — a dead config knob
 * for a provider that doesn't exist isn't added; a future module can
 * introduce one alongside a real implementation, the same way
 * src/lib/research/providers/factory.ts and src/lib/comms/providers/
 * factory.ts branch on AI_PROVIDER / ProviderConnection.provider today.
 */
export function getEnrichmentProvider(): EnrichmentProvider {
  return new MockEnrichmentProvider();
}
