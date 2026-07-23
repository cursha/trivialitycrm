import type { LeadSearchMode } from "../../../generated/prisma/enums";
import type { ResearchProviders } from "./types";
import { MockPromptAssistant, MockCandidateDiscoveryProvider, MockEvidenceVerificationProvider, MockScoringProvider, MockPlacesProvider } from "./mock";
import {
  AnthropicPromptAssistant,
  AnthropicCandidateDiscoveryProvider,
  AnthropicEvidenceVerificationProvider,
  AnthropicScoringProvider,
} from "./anthropic";
import { GooglePlacesDiscoveryProvider } from "./google-places";

/**
 * Selects the research provider implementation from AI_PROVIDER (and, for
 * discovery specifically, PLACES_PROVIDER — see below). Defaults to "mock"
 * when unset — the app and its automated tests must never make a paid call
 * by accident. Only "mock" and "anthropic" are implemented for AI_PROVIDER;
 * any other value throws rather than silently falling back, so a typo in
 * deployment config fails loudly instead of quietly billing the wrong
 * provider (or none).
 *
 * Discovery is mode-aware: a business-directory API (Google Places) can
 * answer "what businesses of type X exist in this city" but has no way to
 * answer "does this specific one run trivia" or "does it use competitor Y's
 * service" — those are the entire reason TRIVIA_GAP/TRIVIA_CONFIRMED/
 * COMPETITOR modes exist. So the fast/cheap directory provider only ever
 * backs GENERAL mode; every other mode always uses AI_PROVIDER's discovery,
 * exactly as before. verification/scoring/promptAssistant are never
 * mode-dependent — they're always AI-driven regardless of discovery source,
 * since a directory-sourced candidate still needs an AI pass (via the
 * opt-in per-result "Research this business" action) to ever get a real
 * triviaStatus.
 */
export function getProviders(mode: LeadSearchMode): ResearchProviders {
  const aiProvider = (process.env.AI_PROVIDER || "mock").toLowerCase();
  const placesProvider = (process.env.PLACES_PROVIDER || "mock").toLowerCase();

  let promptAssistant, verification, scoring;
  switch (aiProvider) {
    case "mock":
      promptAssistant = new MockPromptAssistant();
      verification = new MockEvidenceVerificationProvider();
      scoring = new MockScoringProvider();
      break;
    case "anthropic":
      promptAssistant = new AnthropicPromptAssistant();
      verification = new AnthropicEvidenceVerificationProvider();
      scoring = new AnthropicScoringProvider();
      break;
    default:
      throw new Error(`Unknown AI_PROVIDER "${aiProvider}" — expected "mock" or "anthropic".`);
  }

  let discovery;
  if (mode === "GENERAL" && placesProvider === "google") {
    discovery = new GooglePlacesDiscoveryProvider();
  } else if (mode === "GENERAL" && placesProvider === "mock") {
    discovery = new MockPlacesProvider();
  } else if (placesProvider !== "google" && placesProvider !== "mock") {
    throw new Error(`Unknown PLACES_PROVIDER "${placesProvider}" — expected "mock" or "google".`);
  } else {
    discovery = aiProvider === "anthropic" ? new AnthropicCandidateDiscoveryProvider() : new MockCandidateDiscoveryProvider();
  }

  return { promptAssistant, discovery, verification, scoring };
}
