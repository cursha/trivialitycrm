// Provider interfaces for the AI-assisted research pipeline. Every real
// integration (Anthropic, a future OpenAI/Places/etc. provider) and the
// mock/demo provider implement these same shapes, so run-search.ts and the
// prompt-assist action never depend on a specific vendor. See getProviders()
// in factory.ts for how AI_PROVIDER/SEARCH_PROVIDER selects an implementation.
import type { LeadSearchMode, TriviaStatus, ConfidenceLevel, PrimaryClassification, SecondaryTag, ScoringCategory, EvidenceVerificationStatus, EvidenceReliability, Weekday } from "../../../generated/prisma/enums";
import type { EosCategoryScores } from "../../eos/constants";

export type EvidenceEntry = {
  category: string;
  note: string;
  sourceUrl: string | null;
  verificationStatus: "VERIFIED" | "INFERRED" | "UNVERIFIED";
  // Server-stamped (never model-self-reported) ISO 8601 timestamp of when
  // this entry was last confirmed VERIFIED with a sourceUrl — see
  // stampEvidenceVerificationDates() in result-explanation.ts. Optional so
  // every existing row/consumer written before this field existed keeps
  // reading as undefined rather than requiring a backfill.
  verifiedAt?: string | null;
};

export type SourceEntry = {
  url: string;
  title: string | null;
};

export type ContactDataEntry = {
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  title?: string;
  note?: string;
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
  // Array, not a single contact — Competition Locator (COMPETITOR mode)
  // collects every useful role (owner/GM/venue/marketing/events/
  // entertainment manager) found for a venue, not just one. Other modes
  // still only ever populate at most one entry today. See
  // readContactDataEntries() (contact-data.ts) for the compatibility shim
  // that lets every read site handle null/legacy-single-object/array
  // uniformly without a data migration (this is a Json column).
  contactData: ContactDataEntry[] | null;
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

// "city": the directory providers (GooglePlacesDiscoveryProvider/
// MockPlacesProvider), which genuinely process one city at a time.
// "message": a single-call AI provider (AnthropicCandidateDiscoveryProvider)
// discovering across a whole region in one streamed call — there's no
// per-city checkpoint to report, only a freeform activity line (a real
// web_search/web_fetch tool call, not a synthetic timer), same convention
// already used by AnthropicOpportunityAnalysisProvider's onProgress.
export type DiscoveryProgressUpdate =
  | { kind: "city"; city: string; cityIndex: number; totalCities: number; foundSoFar: number }
  | { kind: "message"; message: string };

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
  // Trivia-specific competitive finding — who (if anyone) already runs a
  // competing trivia night at this venue, and which night. Deliberately its
  // own top-level, structured field rather than folded into scoreExplanation
  // or the competitiveOpportunity category score, so it's a single
  // glanceable fact instead of something a reader has to dig prose for. null
  // means no positive evidence of an existing trivia competitor was found —
  // never a guess from silence (same rule as hasTvs below). day is
  // independently nullable: the provider may confirm a competitor exists
  // without being able to confirm which night. providerName is the name as
  // found; it may or may not match an existing Competitor record by exact
  // name — see analyze-opportunity.ts for how that link gets resolved.
  competitorFound: { providerName: string; day: Weekday | null; sourceUrl: string | null } | null;
  // Tri-state, deliberately separate from categoryScores/salesPriorityScore
  // above — a black-and-white hard requirement (trivia hosting needs a
  // screen), not a soft signal folded into a weighted score. null means
  // genuinely unconfirmed either way; true/false must only ever come from
  // an explicit finding (mention of TVs/sports-bar branding, or an explicit
  // no-TV/conversation-focused policy) — never inferred from silence. See
  // Company.hasTvs's schema.prisma comment for how this gets enforced
  // deterministically once it reaches analyze-opportunity.ts.
  hasTvs: boolean | null;
};

/** A real, verifiable sign of activity during a long analyze() call — e.g. a
 * web_search/web_fetch tool actually being invoked — not a synthetic timer.
 * Streamed to the browser as it happens so the connection keeps actively
 * transferring data (see AnthropicOpportunityAnalysisProvider's own comment
 * on why that matters for Railway's proxy specifically). */
export type OpportunityAnalysisProgressEvent = { message: string };

/** Runs a deep, per-Company AI research pass that fills in the same 10 EOS-1.0
 * categories a human would via recordHistoricalScore() (src/app/(dashboard)/
 * companies/[id]/eos/actions.ts) — distinct from ScoringProvider above, which
 * ranks lead-search candidates against a search prompt, not CRM companies. */
export interface OpportunityAnalysisProvider {
  analyze(input: OpportunityAnalysisInput, onProgress?: (event: OpportunityAnalysisProgressEvent) => void): Promise<OpportunityAnalysisResult>;
}
