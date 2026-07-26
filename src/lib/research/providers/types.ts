// Provider interfaces for the AI-assisted research pipeline. Every real
// integration (Anthropic, a future OpenAI/Places/etc. provider) and the
// mock/demo provider implement these same shapes, so run-search.ts and the
// prompt-assist action never depend on a specific vendor. See getProviders()
// in factory.ts for how AI_PROVIDER/SEARCH_PROVIDER selects an implementation.
import type { LeadSearchMode, TriviaStatus, ConfidenceLevel, PrimaryClassification, SecondaryTag, ScoringCategory, EvidenceVerificationStatus, EvidenceReliability } from "../../../generated/prisma/enums";
import type { EosCategoryScores } from "../../eos/constants";

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
  // Optional attribution for AiUsageRecord (worker-side cost tracking). Not
  // used by mock providers; the Anthropic provider writes one row per call
  // when present. Absent for callers with no LeadSearch context (e.g. the
  // prompt assistant, which threads userId separately below).
  searchId?: string;
  userId?: string;
};

/** Turns a user's freeform description into (or improves an existing) reusable research prompt. */
export interface PromptAssistant {
  refine(input: { description: string; currentPrompt?: string; userId?: string }): Promise<{ prompt: string }>;
}

export type DiscoveryProgressUpdate = { city: string; cityIndex: number; totalCities: number; foundSoFar: number };

/** Finds raw business candidates matching the structured search criteria.
 * `onProgress`, when given, is called once per city as it finishes — only
 * the directory providers (GooglePlacesDiscoveryProvider/MockPlacesProvider,
 * which genuinely process one city at a time) call it; the AI providers,
 * which discover across every city in a single call, simply ignore it. */
export interface CandidateDiscoveryProvider {
  discover(params: DiscoverParams, onProgress?: (update: DiscoveryProgressUpdate) => Promise<void>): Promise<ResearchCandidate[]>;
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

/**
 * Input for the EOS-1.0 "opportunity analysis" pass — a deep AI research
 * pass against an already-existing Company (not a lead-search candidate).
 * address1/city/region/postalCode/country/phone/websiteUrl are given as
 * trusted, already-verified facts: the provider is told not to re-check or
 * dispute them, only to research what's missing and score the EOS
 * categories. See src/lib/eos/constants.ts for the category rubric this
 * must line up with.
 */
export type OpportunityAnalysisInput = {
  name: string;
  address1: string | null;
  city: string;
  region: string;
  postalCode: string | null;
  country: string;
  phone: string | null;
  email: string | null;
  websiteUrl: string | null;
  notes: string | null;
  leadTypeName: string;
  userId?: string;
};

export type OpportunityAnalysisEvidence = {
  category: ScoringCategory;
  sourceUrl: string | null;
  evidenceSummary: string;
  verificationStatus: EvidenceVerificationStatus;
  reliability: EvidenceReliability;
};

export type OpportunityAnalysisResult = {
  categoryScores: EosCategoryScores;
  confidenceLevel: ConfidenceLevel;
  primaryClassification: PrimaryClassification;
  secondaryTags: SecondaryTag[];
  salesPriorityScore: number | null;
  scoreExplanation: string;
  verifiedEvidenceSummary: string;
  inferredEvidenceSummary: string;
  missingInformation: string;
  recommendedSalesApproach: string;
  recommendedNextAction: string;
  evidence: OpportunityAnalysisEvidence[];
  // Only ever used to fill Company.email when it's currently null — never
  // overwrites an existing value. Contact fields beyond email (a specific
  // decision-maker's name/title) are out of scope for v1; that context
  // lives in the free-text summaries above instead.
  foundEmail: string | null;
  // Set only when the provider finds a genuine contradiction of a trusted
  // input fact (e.g. the business appears permanently closed, the name at
  // this address doesn't match) — never a mechanism for changing the
  // trusted fields themselves.
  conflict: { found: boolean; reason: string | null };
};

/** Runs a deep, per-Company AI research pass that fills in the same 10 EOS-1.0
 * categories a human would via recordHistoricalScore() (src/app/(dashboard)/
 * companies/[id]/eos/actions.ts) — distinct from ScoringProvider above, which
 * ranks lead-search candidates against a search prompt, not CRM companies. */
export interface OpportunityAnalysisProvider {
  analyze(input: OpportunityAnalysisInput): Promise<OpportunityAnalysisResult>;
}
