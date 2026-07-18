// Provider interfaces for the AI-assisted research pipeline. Every real
// integration (Anthropic, a future OpenAI/Places/etc. provider) and the
// mock/demo provider implement these same shapes, so run-search.ts and the
// prompt-assist action never depend on a specific vendor. See getProviders()
// in factory.ts for how AI_PROVIDER/SEARCH_PROVIDER selects an implementation.
import type { LeadSearchMode, TriviaStatus } from "../../../generated/prisma/enums";

export type EvidenceEntry = {
  category: string;
  note: string;
  sourceUrl: string | null;
  verificationStatus: "VERIFIED" | "INFERRED" | "UNVERIFIED";
};

export type SourceEntry = {
  url: string;
  title: string | null;
};

export type ResearchCandidate = {
  name: string;
  address1: string | null;
  city: string;
  region: string;
  postalCode: string | null;
  country: string;
  phone: string | null;
  email: string | null;
  websiteUrl: string | null;
  contactData: {
    firstName?: string;
    lastName?: string;
    phone?: string;
    email?: string;
    title?: string;
    note?: string;
  } | null;
  triviaStatus: TriviaStatus;
  competitorName: string | null;
  evidence: EvidenceEntry[];
  sources: SourceEntry[];
};

export type ScoredCandidate = ResearchCandidate & {
  score: number;
  explanation: string;
};

export type DiscoverParams = {
  promptText: string;
  country: string;
  region: string;
  cities: string[];
  leadTypeName: string;
  mode: LeadSearchMode;
  competitorName?: string;
};

/** Turns a user's freeform description into (or improves an existing) reusable research prompt. */
export interface PromptAssistant {
  refine(input: { description: string; currentPrompt?: string }): Promise<{ prompt: string }>;
}

/** Finds raw business candidates matching the structured search criteria. */
export interface CandidateDiscoveryProvider {
  discover(params: DiscoverParams): Promise<ResearchCandidate[]>;
}

/** Verifies a raw candidate's trivia/competitor status and evidence against live sources. */
export interface EvidenceVerificationProvider {
  verify(candidate: ResearchCandidate, params: DiscoverParams): Promise<ResearchCandidate>;
}

/** Produces a 0-100 quality score and explanation for a verified candidate. Distinct from the
 * EOS-1.0 scoring engine (src/lib/eos) — this ranks research candidates, not CRM companies. */
export interface ScoringProvider {
  score(candidate: ResearchCandidate, params: DiscoverParams): Promise<{ score: number; explanation: string }>;
}

export type ResearchProviders = {
  promptAssistant: PromptAssistant;
  discovery: CandidateDiscoveryProvider;
  verification: EvidenceVerificationProvider;
  scoring: ScoringProvider;
};
