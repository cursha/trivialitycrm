// Safe, no-network provider used whenever AI_PROVIDER/SEARCH_PROVIDER is
// "mock" (the default for tests, and for local dev without API keys).
// Produces deterministic, clearly-fake candidates so nothing here is ever
// mistaken for real research output.
import type {
  CandidateDiscoveryProvider,
  DiscoverParams,
  DiscoveryProgressUpdate,
  EvidenceVerificationProvider,
  OpportunityAnalysisInput,
  OpportunityAnalysisProgressEvent,
  OpportunityAnalysisProvider,
  OpportunityAnalysisResult,
  PromptAssistant,
  ResearchCandidate,
  ScoringProvider,
} from "./types";
import { EOS_CATEGORY_MAXIMA, EOS_CATEGORY_SCORING_CATEGORY } from "../../eos/constants";

function slugCity(city: string, index: number) {
  return `${city.replace(/[^a-zA-Z0-9]/g, "")}${index}`;
}

export class MockPromptAssistant implements PromptAssistant {
  async refine(input: { description: string; currentPrompt?: string }): Promise<{ prompt: string }> {
    const base = input.currentPrompt?.trim() || input.description.trim();
    return {
      prompt: `${base}\n\n[Mock-refined] Focus on independently-owned locations with an active events calendar and a public contact page.`,
    };
  }
}

export class MockCandidateDiscoveryProvider implements CandidateDiscoveryProvider {
  async discover(params: DiscoverParams): Promise<ResearchCandidate[]> {
    const cities = params.cities.length > 0 ? params.cities : [`${params.region} (statewide)`];

    return cities.slice(0, 3).map((city, index) => {
      const name = `Mock ${params.leadTypeName} ${slugCity(city, index)}`;
      const isCompetitorMode = params.mode === "COMPETITOR";
      const isTriviaConfirmed = params.mode === "TRIVIA_CONFIRMED";

      return {
        name,
        address1: `${100 + index} Main St`,
        city: city.includes("(statewide)") ? params.region : city,
        region: params.region,
        postalCode: null,
        country: params.country,
        phone: null,
        email: null,
        websiteUrl: `https://example.test/${name.toLowerCase().replace(/\s+/g, "-")}`,
        contactData: null,
        triviaStatus: isTriviaConfirmed || isCompetitorMode ? "CURRENT_TRIVIA" : "UNCERTAIN",
        competitorName: isCompetitorMode ? (params.competitorName ?? null) : null,
        evidence: [],
        sources: [],
      };
    });
  }
}

/** Mock stand-in for GooglePlacesDiscoveryProvider — deterministic fake
 * directory listings, used whenever PLACES_PROVIDER is "mock" (the default;
 * see factory.ts). Every AI-only field is left honestly empty/UNCERTAIN,
 * same as the real provider — a directory has no way to know them. */
export class MockPlacesProvider implements CandidateDiscoveryProvider {
  async discover(params: DiscoverParams, onProgress?: (update: DiscoveryProgressUpdate) => Promise<void>): Promise<ResearchCandidate[]> {
    const cities = params.cities.length > 0 ? params.cities : [params.region];
    const results: ResearchCandidate[] = [];

    for (const [cityIndex, city] of cities.entries()) {
      const name = `Mock Directory ${params.leadTypeName} ${slugCity(city, cityIndex)}`;
      results.push({
        name,
        address1: `${200 + cityIndex} Directory Ave`,
        city,
        region: params.region,
        postalCode: null,
        country: params.country,
        phone: "555-0100",
        email: null,
        websiteUrl: `https://example.test/${name.toLowerCase().replace(/\s+/g, "-")}`,
        contactData: null,
        triviaStatus: "UNCERTAIN",
        competitorName: null,
        evidence: [],
        sources: [],
      });
      await onProgress?.({ city, cityIndex, totalCities: cities.length, foundSoFar: results.length });
    }

    return results;
  }
}

export class MockEvidenceVerificationProvider implements EvidenceVerificationProvider {
  async verify(candidate: ResearchCandidate, params: DiscoverParams): Promise<ResearchCandidate> {
    return {
      ...candidate,
      evidence: [
        {
          category: "general",
          note: `[Mock evidence] Candidate matches the "${params.mode}" research mode for ${params.leadTypeName} in ${params.region}.`,
          sourceUrl: candidate.websiteUrl,
          verificationStatus: "UNVERIFIED",
        },
      ],
      sources: candidate.websiteUrl ? [{ url: candidate.websiteUrl, title: candidate.name }] : [],
    };
  }
}

export class MockScoringProvider implements ScoringProvider {
  async score(candidate: ResearchCandidate): Promise<{ score: number; explanation: string }> {
    // Deterministic, evidence-derived score — not random — so tests are stable.
    const base = 60;
    const evidenceBonus = Math.min(candidate.evidence.length * 10, 30);
    const triviaBonus = candidate.triviaStatus === "UNCERTAIN" ? 0 : 5;
    const score = Math.min(base + evidenceBonus + triviaBonus, 100);
    return { score, explanation: `[Mock score] base ${base} + evidence ${evidenceBonus} + trivia signal ${triviaBonus}.` };
  }
}

/**
 * Deterministic stand-in for AnthropicOpportunityAnalysisProvider — no
 * network, fixed category scores (60% of each category's max) so tests are
 * stable. A test can force the conflict-flagging path deterministically by
 * putting the literal marker "MOCK_CONFLICT" anywhere in Company.notes,
 * since there's no real AI judgment here to trigger it organically.
 */
export class MockOpportunityAnalysisProvider implements OpportunityAnalysisProvider {
  async analyze(
    input: OpportunityAnalysisInput,
    onProgress?: (event: OpportunityAnalysisProgressEvent) => void,
  ): Promise<OpportunityAnalysisResult> {
    onProgress?.({ message: `[Mock] Searching the web for ${input.name}...` });
    onProgress?.({ message: `[Mock] Reviewing category evidence for ${input.name}...` });

    const categoryScores = Object.fromEntries(
      (Object.keys(EOS_CATEGORY_MAXIMA) as (keyof typeof EOS_CATEGORY_MAXIMA)[]).map((key) => [key, Math.round(EOS_CATEGORY_MAXIMA[key] * 0.6)]),
    ) as OpportunityAnalysisResult["categoryScores"];

    const forcedConflict = input.notes?.includes("MOCK_CONFLICT") ?? false;

    return {
      categoryScores,
      confidenceLevel: "MEDIUM",
      primaryClassification: "NEEDS_QUALIFICATION",
      secondaryTags: [],
      salesPriorityScore: 60,
      scoreExplanation: `[Mock opportunity analysis] ${input.name} scored at 60% of every category pending real research.`,
      verifiedEvidenceSummary: `[Mock] ${input.name}'s public website/listing was checked for basic signals.`,
      inferredEvidenceSummary: `[Mock] No strong inferred signals for ${input.name}.`,
      missingInformation: input.email ? "None flagged." : "No public email address found.",
      recommendedSalesApproach: "[Mock] Lead with the weeknight-revenue angle.",
      recommendedNextAction: "[Mock] Call to confirm decision-maker availability.",
      evidence: [
        {
          category: EOS_CATEGORY_SCORING_CATEGORY.foodBeverageFocus,
          sourceUrl: input.websiteUrl,
          evidenceSummary: `[Mock evidence] ${input.name}'s public menu/listing was reviewed.`,
          verificationStatus: "UNVERIFIED",
          reliability: "MEDIUM",
        },
      ],
      foundEmail: input.email ? null : `contact@${input.name.toLowerCase().replace(/[^a-z0-9]/g, "")}.example.test`,
      conflict: forcedConflict ? { found: true, reason: "[Mock] Business appears permanently closed at this address." } : { found: false, reason: null },
      // Same "MOCK_" marker idiom as forcedConflict above — lets a test force
      // the hard-disqualifier path deterministically without real AI judgment.
      hasTvs: input.notes?.includes("MOCK_NO_TVS") ? false : null,
    };
  }
}
