// Safe, no-network provider used whenever AI_PROVIDER/SEARCH_PROVIDER is
// "mock" (the default for tests, and for local dev without API keys).
// Produces deterministic, clearly-fake candidates so nothing here is ever
// mistaken for real research output.
import type {
  CandidateDiscoveryProvider,
  DiscoverParams,
  EvidenceVerificationProvider,
  PromptAssistant,
  ResearchCandidate,
  ScoringProvider,
} from "./types";

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
