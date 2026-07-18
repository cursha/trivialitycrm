import "server-only";
import type { ResearchProviders } from "./types";
import { MockPromptAssistant, MockCandidateDiscoveryProvider, MockEvidenceVerificationProvider, MockScoringProvider } from "./mock";
import {
  AnthropicPromptAssistant,
  AnthropicCandidateDiscoveryProvider,
  AnthropicEvidenceVerificationProvider,
  AnthropicScoringProvider,
} from "./anthropic";

/**
 * Selects the research provider implementation from AI_PROVIDER. Defaults to
 * "mock" when unset — the app and its automated tests must never make a paid
 * call by accident. Only "mock" and "anthropic" are implemented; any other
 * value throws rather than silently falling back, so a typo in deployment
 * config fails loudly instead of quietly billing the wrong provider (or none).
 */
export function getProviders(): ResearchProviders {
  const provider = (process.env.AI_PROVIDER || "mock").toLowerCase();

  switch (provider) {
    case "mock":
      return {
        promptAssistant: new MockPromptAssistant(),
        discovery: new MockCandidateDiscoveryProvider(),
        verification: new MockEvidenceVerificationProvider(),
        scoring: new MockScoringProvider(),
      };
    case "anthropic":
      return {
        promptAssistant: new AnthropicPromptAssistant(),
        discovery: new AnthropicCandidateDiscoveryProvider(),
        verification: new AnthropicEvidenceVerificationProvider(),
        scoring: new AnthropicScoringProvider(),
      };
    default:
      throw new Error(`Unknown AI_PROVIDER "${provider}" — expected "mock" or "anthropic".`);
  }
}
