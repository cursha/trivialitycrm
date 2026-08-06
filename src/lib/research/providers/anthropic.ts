// No `import "server-only"` and only relative imports — this module now runs
// exclusively in the worker (and, for refine(), inside a Next.js server
// action, which is also fine — server-only isn't needed either way since
// nothing here is meant to be reachable from client code). See run-search.ts
// for the fuller explanation of why the research module tree dropped this
// guard.
import Anthropic from "@anthropic-ai/sdk";
import { callProvider } from "./http";
import { estimateCostUsd } from "./pricing";
import { prisma } from "../../prisma";
import { getAiSettings } from "../../ai/budget";
import { EOS_CATEGORY_MAXIMA, EOS_CATEGORY_LABELS } from "../../eos/constants";
import type {
  CandidateDiscoveryProvider,
  DiscoverParams,
  DiscoveryProgressUpdate,
  EvidenceVerificationProvider,
  OpportunityAnalysisInput,
  OpportunityAnalysisProvider,
  OpportunityAnalysisResult,
  PromptAssistant,
  ResearchCandidate,
  ScoringProvider,
} from "./types";

// Real provider (requirement 12): uses Claude's server-side web_search /
// web_fetch tools so discovery, evidence-gathering, and citations come from
// one pipeline without a separate paid Maps/SERP dependency (see the
// provider comparison in MODULE_2_REPORT.md for the cost/legal rationale).
// Not exercised by automated tests — those always use the mock provider
// (src/lib/research/providers/mock.ts). Verify with a live smoke test
// against a real AI_API_KEY before relying on this in production; the
// combination of server-side tool use with structured JSON output is
// implemented to the documented API contract but hasn't been exercised
// against the live API in this environment.
// Module 8A: the model is now Administrator-configurable
// (AiSettings.approvedModel, src/app/(dashboard)/administration/ai-settings/)
// rather than hardcoded — resolveModel() below reads it. This fallback is
// used only if that DB read somehow fails (matches WorkspaceSettings' own
// defensive-fallback convention) — never silently used otherwise.
const FALLBACK_MODEL = "claude-sonnet-5";
// Module Ten: matches AiSettings.maxSearchToolUsesPerCall's own schema
// default — only used if that DB read itself fails, same defensive-fallback
// convention as FALLBACK_MODEL above.
const FALLBACK_MAX_SEARCH_TOOL_USES = 8;
// Matches AiSettings.maxSearchToolUsesPerOpportunityAnalysis's own schema
// default — see that field's schema.prisma comment for why it's lower than
// FALLBACK_MAX_SEARCH_TOOL_USES above.
const FALLBACK_MAX_SEARCH_TOOL_USES_OPPORTUNITY_ANALYSIS = 4;
// COMPETITOR pass-1 discovery's own fixed, much smaller search budget —
// deliberately NOT the shared, admin-configurable maxSearchToolUsesPerCall
// (up to 20) — a small, fixed cap instead, to keep this pass genuinely
// fast rather than configurably slow. Was 5, initially set that low while
// still chasing the real slowness cause. Confirmed live once the actual
// bottleneck (web_search's automatic code_execution dynamic filtering,
// see discoverCompetitorTwoStep()'s own comment) was fixed: a 5-search
// budget finished a whole-Ontario search in 66s but only surfaced 11
// candidates for a competitor known to have 20+ real locations — each
// search is now fast and cheap on its own (no more dynamic-filtering
// overhead), so there's real room to trade a little of that speed back
// for broader coverage.
const COMPETITOR_PASS1_MAX_SEARCH_USES = 15;

async function resolveModel(): Promise<string> {
  try {
    const settings = await getAiSettings();
    return settings.approvedModel;
  } catch {
    return FALLBACK_MODEL;
  }
}

/** Like resolveModel(), but also returns the admin-configurable
 * web_search/web_fetch max_uses budget — for discover()/verify() only,
 * the two call sites that actually use search tools. */
async function resolveResearchSettings(): Promise<{ model: string; maxSearchToolUses: number }> {
  try {
    const settings = await getAiSettings();
    return { model: settings.approvedModel, maxSearchToolUses: settings.maxSearchToolUsesPerCall };
  } catch {
    return { model: FALLBACK_MODEL, maxSearchToolUses: FALLBACK_MAX_SEARCH_TOOL_USES };
  }
}

/**
 * Split from resolveResearchSettings() — opportunity analysis
 * (AnthropicOpportunityAnalysisProvider below) runs against one
 * already-known Company at a time, not a fresh discovery search, and has
 * different cost/time characteristics: confirmed live, a business with thin
 * web presence can otherwise burn many search/fetch rounds for no useful
 * result before eventually hitting the timeout. Its own admin setting
 * defaults lower so that case fails fast and cheap instead.
 */
async function resolveOpportunityAnalysisSettings(): Promise<{ model: string; maxSearchToolUses: number }> {
  try {
    const settings = await getAiSettings();
    return { model: settings.approvedModel, maxSearchToolUses: settings.maxSearchToolUsesPerOpportunityAnalysis };
  } catch {
    return { model: FALLBACK_MODEL, maxSearchToolUses: FALLBACK_MAX_SEARCH_TOOL_USES_OPPORTUNITY_ANALYSIS };
  }
}

// Shared item schema is built by a function, not one shared literal object —
// verify() (which must always keep gathering full evidence/contactData,
// since pass-2 verification is now the ONLY place that happens for
// COMPETITOR mode, see discover() below) and discover() for TRIVIA_GAP/
// TRIVIA_CONFIRMED both need the full shape; a pass-1 COMPETITOR discover()
// call needs a smaller one. Mutating one shared object would have silently
// stripped evidence/contactData from verify()'s own output too.
function buildCandidateItemSchema(options: { includeDeepEvidence: boolean }) {
  const properties: Record<string, unknown> = {
    name: { type: "string" },
    address1: { type: ["string", "null"] },
    city: { type: "string" },
    region: { type: "string" },
    postalCode: { type: ["string", "null"] },
    country: { type: "string" },
    phone: { type: ["string", "null"] },
    email: { type: ["string", "null"] },
    websiteUrl: { type: ["string", "null"] },
    triviaStatus: { type: "string", enum: ["CURRENT_TRIVIA", "NO_CURRENT_TRIVIA", "UNCERTAIN"] },
    competitorName: { type: ["string", "null"] },
    // No "enum" here, same reason as OPPORTUNITY_ANALYSIS_SCHEMA's
    // competitorFound.day below: Anthropic's structured-output validator
    // rejects "enum" combined with a ["string", "null"] type. The prompt
    // states the allowed values instead; normalizeWeekday() below cleans up
    // the raw string (or nulls it out) before it ever reaches a candidate.
    day: { type: ["string", "null"] },
    // Kept even in the lightweight pass-1 shape — cheap (just url+title per
    // entry, no analysis text) and still useful to a reviewer before the
    // deep-dive research pass runs.
    sources: {
      type: "array",
      items: {
        type: "object",
        properties: { url: { type: "string" }, title: { type: ["string", "null"] } },
        required: ["url", "title"],
        additionalProperties: false,
      },
    },
  };
  const required = ["name", "address1", "city", "region", "postalCode", "country", "phone", "email", "websiteUrl", "triviaStatus", "competitorName", "day", "sources"];

  if (options.includeDeepEvidence) {
    // Every useful role found for the venue (owner/GM/venue/marketing/
    // events/entertainment manager), not just one — an empty array, never
    // omitted, when nothing is publicly available. Always an array (not
    // nullable) to sidestep any untested Anthropic structured-output
    // interaction between a nullable type and an "array" schema — same
    // reasoning as evidence below, also a plain non-nullable array.
    properties.contactData = {
      type: "array",
      items: {
        type: "object",
        properties: {
          firstName: { type: ["string", "null"] },
          lastName: { type: ["string", "null"] },
          phone: { type: ["string", "null"] },
          email: { type: ["string", "null"] },
          title: { type: ["string", "null"] },
          note: { type: ["string", "null"] },
        },
        required: ["firstName", "lastName", "phone", "email", "title", "note"],
        additionalProperties: false,
      },
    };
    properties.evidence = {
      type: "array",
      items: {
        type: "object",
        properties: {
          category: { type: "string" },
          note: { type: "string" },
          sourceUrl: { type: ["string", "null"] },
          verificationStatus: { type: "string", enum: ["VERIFIED", "INFERRED", "UNVERIFIED"] },
        },
        required: ["category", "note", "sourceUrl", "verificationStatus"],
        additionalProperties: false,
      },
    };
    required.push("contactData", "evidence");
  }

  return { type: "object", properties, required, additionalProperties: false };
}

function wrapCandidatesSchema(itemSchema: ReturnType<typeof buildCandidateItemSchema>) {
  return {
    type: "object",
    properties: { candidates: { type: "array", items: itemSchema } },
    required: ["candidates"],
    additionalProperties: false,
  };
}

const CANDIDATE_ITEM_SCHEMA = buildCandidateItemSchema({ includeDeepEvidence: true });
const CANDIDATE_SCHEMA = wrapCandidatesSchema(CANDIDATE_ITEM_SCHEMA);

// Pass-1 COMPETITOR discovery only: identification info (name/address/etc.)
// without evidence/contactData. Confirmed live: a broad COMPETITOR discover()
// call gathering deep per-candidate evidence for many venues in one response
// burned $2.44 (988K input tokens, heavy web_fetch use) and then discarded
// its ENTIRE candidate list because the JSON hit the 16000-token output cap
// mid-object and failed to parse. Keeping pass-1 to identification-only data
// keeps each candidate's footprint small enough that a broad search can
// enumerate far more venues before hitting that cap, and defers the
// expensive per-venue research to the existing opt-in "Research this
// business" action (researchResult(), results/actions.ts) — the same
// two-pass pattern GENERAL mode already uses.
const COMPETITOR_DISCOVERY_SCHEMA = wrapCandidatesSchema(buildCandidateItemSchema({ includeDeepEvidence: false }));

const EOS_CATEGORY_KEYS = Object.keys(EOS_CATEGORY_MAXIMA) as (keyof typeof EOS_CATEGORY_MAXIMA)[];

const WEEKDAY_VALUES = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"] as const;

const SCORING_CATEGORY_VALUES = [
  "FOOD_BEVERAGE_FOCUS",
  "WEEKNIGHT_REVENUE_OPPORTUNITY",
  "COMMUNITY_ENGAGEMENT",
  "EXISTING_EVENT_CULTURE",
  "GROUP_SEATING_LAYOUT",
  "CAPACITY_OPERATIONAL_SUITABILITY",
  "DECISION_MAKER_ACCESSIBILITY",
  "MARKETING_ACTIVITY_VISIBILITY",
  "TURNKEY_IMPLEMENTATION_READINESS",
  "COMPETITIVE_OPPORTUNITY",
] as const;

// Mirrors the 10 fixed EOS-1.0 categories (src/lib/eos/constants.ts) exactly
// — this is the same rubric a human fills in by hand via recordHistoricalScore()
// (src/app/(dashboard)/companies/[id]/eos/actions.ts), so the two can never
// silently drift apart.
const OPPORTUNITY_ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
    // "minimum"/"maximum" are NOT supported on an "integer" property by
    // Anthropic's structured-output JSON Schema (confirmed live: 400
    // "output_config.format.schema: For 'integer' type, properties maximum,
    // minimum are not supported") — every prior "truncation" theory for
    // this failure was wrong; it was this schema, from the very first
    // call. Each category's max is stated in the prompt rubric instead
    // (opportunityCategoryRubric()) and enforced server-side afterward by
    // validateCategoryScores() (src/lib/eos/validation.ts), same as the
    // human-entry form.
    categoryScores: {
      type: "object",
      properties: Object.fromEntries(EOS_CATEGORY_KEYS.map((key) => [key, { type: "integer", description: `0-${EOS_CATEGORY_MAXIMA[key]}` }])),
      required: EOS_CATEGORY_KEYS,
      additionalProperties: false,
    },
    confidenceLevel: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
    primaryClassification: { type: "string", enum: ["ENTERTAINMENT_READY", "GREENFIELD", "REPLACEMENT", "NEEDS_QUALIFICATION", "EXISTING_CUSTOMER"] },
    secondaryTags: { type: "array", items: { type: "string", enum: ["EASY_WIN", "REVENUE_READY", "NO_HOST_READY"] } },
    salesPriorityScore: { type: ["integer", "null"] },
    scoreExplanation: { type: "string" },
    verifiedEvidenceSummary: { type: "string" },
    inferredEvidenceSummary: { type: "string" },
    missingInformation: { type: "string" },
    recommendedSalesApproach: { type: "string" },
    recommendedNextAction: { type: "string" },
    evidence: {
      type: "array",
      items: {
        type: "object",
        properties: {
          category: { type: "string", enum: SCORING_CATEGORY_VALUES },
          sourceUrl: { type: ["string", "null"] },
          evidenceSummary: { type: "string" },
          verificationStatus: { type: "string", enum: ["VERIFIED", "INFERRED", "UNVERIFIED", "OUTDATED", "CONTRADICTORY"] },
          reliability: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
        },
        required: ["category", "sourceUrl", "evidenceSummary", "verificationStatus", "reliability"],
        additionalProperties: false,
      },
    },
    foundEmail: { type: ["string", "null"] },
    conflict: {
      type: "object",
      properties: { found: { type: "boolean" }, reason: { type: ["string", "null"] } },
      required: ["found", "reason"],
      additionalProperties: false,
    },
    // Tri-state, deliberately its own top-level field rather than folded
    // into categoryScores/salesPriorityScore — a black-and-white hard
    // requirement the app enforces deterministically afterward (see
    // analyze-opportunity.ts), not a soft signal left to the model's own
    // score-adjustment discretion. null = genuinely unconfirmed; true/false
    // only from an explicit finding, never inferred from silence.
    hasTvs: { type: ["boolean", "null"] },
    // Trivia-specific competitor already running at this venue, if any —
    // see OpportunityAnalysisResult.competitorFound's doc comment. null when
    // no positive evidence was found; day is independently nullable within
    // the object when a competitor is confirmed but the specific night
    // isn't.
    competitorFound: {
      type: ["object", "null"],
      properties: {
        providerName: { type: "string" },
        // No "enum" here deliberately: confirmed live, Anthropic's
        // structured-output validator rejects `enum` combined with a
        // `type` array (`["string", "null"]`) — 400 "Enum value 'MONDAY'
        // does not match declared type" — even though "MONDAY" plainly is
        // a string. Every real (non-mock) opportunity analysis failed
        // outright because of this until it was caught by a live smoke
        // test. The prompt states the allowed values instead, and the
        // result is normalized back to a real Weekday (or null) below in
        // normalizeCompetitorFound() — never trusted to have come back
        // clean from the model.
        day: { type: ["string", "null"] },
        sourceUrl: { type: ["string", "null"] },
      },
      required: ["providerName", "day", "sourceUrl"],
      additionalProperties: false,
    },
  },
  required: [
    "categoryScores",
    "confidenceLevel",
    "primaryClassification",
    "secondaryTags",
    "salesPriorityScore",
    "scoreExplanation",
    "verifiedEvidenceSummary",
    "inferredEvidenceSummary",
    "missingInformation",
    "recommendedSalesApproach",
    "recommendedNextAction",
    "evidence",
    "foundEmail",
    "conflict",
    "hasTvs",
    "competitorFound",
  ],
  additionalProperties: false,
} as const;

function opportunityCategoryRubric(): string {
  return EOS_CATEGORY_KEYS.map((key) => `- ${key} (max ${EOS_CATEGORY_MAXIMA[key]} points): ${EOS_CATEGORY_LABELS[key]}`).join("\n");
}

function client(): Anthropic {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) {
    throw new Error("AI_API_KEY is not set — required to use the Anthropic research provider.");
  }
  // maxRetries set explicitly (matching callProvider's own retry policy
  // description) rather than left at the SDK default, so retry behavior here
  // is a deliberate, documented choice instead of an implicit one: retries
  // connection errors and pre-response 429/5xx with backoff+jitter, never a
  // request that was aborted by our own timeout (see callProvider in
  // ./http.ts, and the {signal} passthrough on every call below that makes
  // that timeout actually cancel the in-flight request instead of just
  // abandoning it while Anthropic keeps processing — and billing — it).
  return new Anthropic({ apiKey, maxRetries: 2 });
}

type ProviderUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  server_tool_use?: { web_search_requests?: number; web_fetch_requests?: number } | null;
};

/** Persists one AiUsageRecord per provider call, immediately after the response
 * returns — so cost is visible even if the enclosing search job later fails.
 * Never logs or stores the prompt/response text itself, only token counts and
 * the derived cost estimate (see ./pricing.ts). Best-effort: a failure to
 * write the usage row must never fail the research call itself. */
async function recordUsage(params: {
  operation: "discover" | "verify" | "score" | "promptAssist" | "analyzeOpportunity";
  model: string;
  usage: ProviderUsage;
  searchId?: string;
  userId?: string;
}): Promise<void> {
  try {
    const webSearchRequests = params.usage.server_tool_use?.web_search_requests ?? 0;
    const webFetchRequests = params.usage.server_tool_use?.web_fetch_requests ?? 0;

    const estimatedCostUsd = estimateCostUsd({
      model: params.model,
      inputTokens: params.usage.input_tokens,
      outputTokens: params.usage.output_tokens,
      cacheReadTokens: params.usage.cache_read_input_tokens ?? 0,
      cacheCreationTokens: params.usage.cache_creation_input_tokens ?? 0,
      webSearchRequests,
      webFetchRequests,
    });

    await prisma.aiUsageRecord.create({
      data: {
        searchId: params.searchId ?? null,
        userId: params.userId ?? null,
        provider: "anthropic",
        operation: params.operation,
        model: params.model,
        inputTokens: params.usage.input_tokens,
        outputTokens: params.usage.output_tokens,
        cacheReadTokens: params.usage.cache_read_input_tokens ?? 0,
        cacheCreationTokens: params.usage.cache_creation_input_tokens ?? 0,
        serverToolUses: webSearchRequests + webFetchRequests,
        estimatedCostUsd,
      },
    });
  } catch {
    // Usage tracking is observability, not correctness — never let a
    // logging failure surface as a research-call failure.
  }
}

/**
 * Structured JSON output is only guaranteed well-formed if the response
 * finishes before max_tokens is hit — a response cut off mid-schema still
 * comes back as stop_reason "max_tokens" with truncated text, which fails
 * JSON.parse with a confusing "Expected property name or '}'" error rather
 * than a clear one. Confirmed live: the discovery call's response was cut
 * off exactly this way on a broad query before its max_tokens was raised.
 */
function assertNotTruncated(stopReason: string | null, providerName: string): void {
  if (stopReason === "max_tokens") {
    throw new Error(`Provider "${providerName}" response was truncated (hit max_tokens) before it finished — its output is incomplete, not just slow to parse.`);
  }
}

/**
 * The schema can no longer constrain `day` to the real Weekday values (see
 * the schema's own comment on why "enum" had to be dropped) — normalize
 * here instead, right where the model's raw output crosses into the app's
 * typed result. A non-matching value becomes null rather than propagating
 * into Company.competitorTriviaDay, whose Postgres enum column would
 * otherwise reject the whole write.
 */
function normalizeWeekday(raw: unknown): (typeof WEEKDAY_VALUES)[number] | null {
  return typeof raw === "string" && (WEEKDAY_VALUES as readonly string[]).includes(raw.toUpperCase()) ? (raw.toUpperCase() as (typeof WEEKDAY_VALUES)[number]) : null;
}

function normalizeCompetitorFound(raw: OpportunityAnalysisResult["competitorFound"]): OpportunityAnalysisResult["competitorFound"] {
  if (!raw) return null;
  return { ...raw, day: normalizeWeekday(raw.day) };
}

// Shared across every prompt that produces a `day` field (both
// modeInstructions() call sites below, plus discoverCompetitorTwoStep()'s
// bespoke step-2 prompt) — one instruction, not restated per mode, so the
// allowed-values wording (see the schema's own "no enum" comment) never
// drifts between them.
const DAY_FIELD_INSTRUCTION =
  "Set day to the weekday its trivia night runs (SCREAMING_SNAKE_CASE, e.g. THURSDAY) only when a specific night is stated; leave it null when trivia is confirmed but the night isn't, or there's no trivia night to report.";

// Shared by discover() (every non-COMPETITOR mode — see
// discoverCompetitorTwoStep()'s own comment for why COMPETITOR mode no
// longer uses this at all) and verify() (every mode, including COMPETITOR's
// own step-2-equivalent structuring pass does NOT use this — that prompt is
// bespoke, see discoverCompetitorTwoStep()).
function modeInstructions(mode: DiscoverParams["mode"], competitorName?: string): string {
  switch (mode) {
    case "TRIVIA_GAP":
      return "Find locations that offer regular events (live music, karaoke, other entertainment) but do NOT currently offer trivia. Do not include any location with positive evidence of an existing trivia night.";
    case "TRIVIA_CONFIRMED":
      return "Find locations with POSITIVE, verifiable evidence that they currently run a trivia night (a schedule page, event listing, or social post naming a specific recurring trivia event). Uncertain or ambiguous evidence must be marked triviaStatus \"UNCERTAIN\", never \"CURRENT_TRIVIA\".";
    case "COMPETITOR":
      return (
        `Find pubs, bars, breweries, taprooms, restaurants, or similar licensed venues currently running trivia hosted by the service "${competitorName}". ` +
        `Only set competitorName to "${competitorName}" when there is direct, current evidence (the competitor's own name, branding, or host credit on the venue's own listing, event calendar, or official social-media page) tying the location to that specific service — never a generic "trivia night" mention with no named host. ` +
        `If a location clearly runs trivia through a DIFFERENT named provider, still report it with that other provider's name in competitorName rather than omitting it — the caller filters mismatches, don't guess or force a match. ` +
        "Exclude: venues that are permanently closed or out of business; a trivia event that was a one-time or cancelled occurrence rather than a regular recurring night; any listing you cannot reasonably confirm reflects the current/recent state (treat a listing with no date or evidence of freshness as stale, not current); private/members-only events that aren't a standing public venue offering; and any evidence quality below your own \"VERIFIED\" bar — mark those UNVERIFIED/INFERRED rather than reporting the location with unfounded confidence. " +
        "Every evidence entry that supports the competitor match must cite a sourceUrl actually fetched or found in search results, and be marked \"VERIFIED\" only when that source itself is current."
      );
    default:
      return "Find locations matching the business criteria below. Only mark triviaStatus \"CURRENT_TRIVIA\" with positive evidence; use \"UNCERTAIN\" rather than guessing.";
  }
}

// A real production incident traced back to this: the assistant had no
// instruction about output format, so it reasonably (but wrongly, for how
// this app actually works) produced a fill-in-the-blank template with
// bracket placeholders like "[LOCATION/REGION]" — which then got saved
// and used verbatim as the real search prompt, giving the discovery AI
// nothing concrete to act on. Location and lead type are ALWAYS appended
// automatically at search time (see discover()'s "Location: .../Lead
// type: ..." lines below) — the saved prompt itself must never reference
// them, and must never contain a placeholder of any kind.
//
// A first attempt at this instruction (appended after the task, not
// repeated) was NOT enough for the "improve an existing prompt" path
// specifically: telling the model to "keep its intent" while the existing
// prompt's own intent/structure WAS a fill-in-the-blank template caused it
// to keep the template shape anyway, format rules notwithstanding —
// confirmed live, the exact same bracket-laden output came back even after
// the first fix. This version puts the rules first (not last), states
// explicitly that "keep its intent" means the research criteria only,
// never the template structure, and repeats the core "no brackets, no
// placeholders" instruction a second time at the end for emphasis.
const PROMPT_ASSIST_FORMAT_RULES =
  "STRICT OUTPUT FORMAT — read this before doing anything else:\n" +
  "- Output ONLY the finished prompt text itself. No headings, no title, no meta-commentary, no \"Here's your prompt:\" preamble, no markdown section dividers.\n" +
  "- It must be complete and ready to use as-is, right now, with zero further editing required. It must NEVER be a fill-in-the-blank template.\n" +
  "- NEVER include a bracket placeholder of any kind — no [LOCATION], no [YOUR PRODUCT OR SERVICE], no [e.g., ...], nothing in square brackets at all.\n" +
  "- NEVER mention a specific location, city, region, or lead type/business category, or leave a placeholder for one — those are supplied automatically, separately, every single time this prompt is actually used, regardless of where or what it searches for.\n" +
  "- Write only the qualifying signals and criteria that distinguish a genuinely good match from a bad one (e.g. \"prioritize independently-owned venues with an active events calendar and a public contact page\" — concrete guidance, not a category to fill in).\n" +
  "- If asked to improve an existing prompt that is itself a bracket-filled template, do NOT preserve that template structure — \"keep its intent\" means keep the underlying research criteria/goal, never the placeholder format. Rewrite it as concrete, ready-to-use guidance.\n" +
  "Reminder: your response must contain no square-bracket placeholders whatsoever.";

export class AnthropicPromptAssistant implements PromptAssistant {
  async refine(input: { description: string; currentPrompt?: string; userId?: string }): Promise<{ prompt: string }> {
    const model = await resolveModel();
    return callProvider({ providerName: "anthropic-prompt-assist" }, async (signal) => {
      const response = await client().messages.create(
        {
          model,
          max_tokens: 1024,
          messages: [
            {
              role: "user",
              content: input.currentPrompt
                ? `${PROMPT_ASSIST_FORMAT_RULES}\n\nImprove this reusable business-research prompt for clarity and specificity, keeping its research intent (not its format, per the rules above):\n\n${input.currentPrompt}\n\nAdditional guidance from the user: ${input.description}`
                : `${PROMPT_ASSIST_FORMAT_RULES}\n\nWrite a reusable, specific business-research prompt for AI-assisted lead discovery based on this description:\n\n${input.description}`,
            },
          ],
        },
        { signal },
      );
      await recordUsage({ operation: "promptAssist", model, usage: response.usage, userId: input.userId });
      const text = response.content.find((block) => block.type === "text");
      return { prompt: text && "text" in text ? text.text.trim() : input.description };
    });
  }
}

export class AnthropicCandidateDiscoveryProvider implements CandidateDiscoveryProvider {
  async discover(params: DiscoverParams, onProgress?: (update: DiscoveryProgressUpdate) => Promise<void>): Promise<ResearchCandidate[]> {
    // COMPETITOR mode gets its own two-step implementation — see
    // discoverCompetitorTwoStep()'s own comment for why. Every other mode
    // keeps this original one-shot shape, unchanged.
    if (params.mode === "COMPETITOR") {
      return this.discoverCompetitorTwoStep(params, onProgress);
    }

    const { model, maxSearchToolUses } = await resolveResearchSettings();
    // Up to maxSearchToolUses web_search + maxSearchToolUses web_fetch tool
    // round-trips for a broad query (e.g. no city filter, or a competitor
    // with genuine market presence across a whole region) can genuinely take
    // well past 5 minutes — confirmed live: a single-province COMPETITOR
    // search with 10+ real locations hit the old 300s ceiling and failed
    // outright. This call runs inside the worker's run-search job, never
    // behind Railway's HTTP proxy the way a web-request-driven call would
    // be (see AnthropicOpportunityAnalysisProvider's own comment on that
    // proxy timeout) — so the only real ceiling is the run-search queue's
    // own expireInSeconds: 3600 (boss-client.ts), which leaves generous
    // headroom for verification/scoring afterward even at 900s here.
    // Streamed (like AnthropicOpportunityAnalysisProvider) primarily for
    // progress visibility, not proxy survival: without it, LeadSearch's own
    // progressMessage/heartbeatAt never update for the full duration of a
    // long call, making a legitimately-still-working search look identical
    // to a dead one on its own status page.
    return callProvider({ providerName: "anthropic-discovery", timeoutMs: 900_000 }, async (signal) => {
      const locationScope = params.cities.length > 0 ? params.cities.join(", ") : `all of ${params.region} (no city filter given)`;

      const stream = client().messages.stream(
        {
          model,
          // Was 8000 — too tight for a broad, no-city-filter query returning
          // several candidates each with an evidence list and a sources
          // list; confirmed live by a truncated (stop_reason "max_tokens")
          // response that failed JSON.parse. 16000 stays under the ~16K
          // ceiling non-streaming requests are safe at (see http.ts/SDK
          // docs) while giving real headroom.
          max_tokens: 16000,
          tools: [
            { type: "web_search_20260209", name: "web_search", max_uses: maxSearchToolUses },
            { type: "web_fetch_20260209", name: "web_fetch", max_uses: maxSearchToolUses },
          ],
          output_config: { format: { type: "json_schema", schema: CANDIDATE_SCHEMA } },
          messages: [
            {
              role: "user",
              content:
                `${modeInstructions(params.mode, params.competitorName)}\n\n` +
                `Business criteria: ${params.promptText}\n\n` +
                `Location: ${locationScope}, ${params.country}. Lead type: ${params.leadTypeName}.\n\n` +
                "Only report facts you can support with a web_search or web_fetch result. Do not invent addresses, phone numbers, or emails — leave a field null rather than guessing. Every evidence entry must cite a sourceUrl you actually fetched or found in search results. address1 must be the street address ONLY (e.g. \"123 Main St\") — never append city, region, postal code, or country, since those are already separate fields. " +
                DAY_FIELD_INSTRUCTION,
            },
          ],
        },
        { signal },
      );

      // Fire-and-forget, like AnthropicOpportunityAnalysisProvider's own
      // onProgress calls — a progress-write failure (see run-search.ts's
      // best-effort try/catch) must never affect the actual discovery call.
      stream.on("contentBlock", (block) => {
        if (block.type === "server_tool_use") {
          void onProgress?.({ kind: "message", message: serverToolProgressMessage(block.name, block.input) });
        } else if (block.type === "thinking") {
          void onProgress?.({ kind: "message", message: "Reasoning about candidates found so far..." });
        }
      });
      let lastThinkingHeartbeat = 0;
      stream.on("streamEvent", (event) => {
        if (event.type !== "content_block_delta" || event.delta.type !== "thinking_delta") return;
        const now = Date.now();
        if (now - lastThinkingHeartbeat < 5000) return;
        lastThinkingHeartbeat = now;
        void onProgress?.({ kind: "message", message: "Reasoning about candidates found so far..." });
      });

      let finalMessage;
      try {
        finalMessage = await stream.finalMessage();
      } catch (error) {
        // Same "a timed-out/aborted call is still billed" reasoning as
        // AnthropicOpportunityAnalysisProvider — record best-effort partial
        // usage so a call that grinds the full 900s before timing out isn't
        // invisible to the cost dashboard and checkAiBudget() enforcement.
        const partialUsage = stream.currentMessage?.usage;
        if (partialUsage) {
          await recordUsage({ operation: "discover", model, usage: partialUsage, searchId: params.searchId, userId: params.userId });
        }
        throw error;
      }

      await recordUsage({ operation: "discover", model, usage: finalMessage.usage, searchId: params.searchId, userId: params.userId });
      assertNotTruncated(finalMessage.stop_reason, "anthropic-discovery");

      const jsonBlock = finalMessage.content.find((block) => block.type === "text");
      if (!jsonBlock || !("text" in jsonBlock)) return [];
      const parsed = JSON.parse(jsonBlock.text) as { candidates: ResearchCandidate[] };
      return parsed.candidates.map((candidate) => ({ ...candidate, contactData: candidate.contactData ?? [], day: normalizeWeekday(candidate.day) }));
    });
  }

  /**
   * COMPETITOR mode's discovery, split into two calls instead of one.
   * Confirmed live: combining broad, open-ended web_search exploration
   * with strict json_schema structured output in a single call was
   * unreliable — 15-20 minute runs, sometimes timing out outright,
   * sometimes "succeeding" with zero candidates, and repeatedly invoking
   * undeclared "code_execution"/"bash_code_execution" tools with no
   * identifiable cause (confirmed against Anthropic's own docs: there is
   * no automatic internal code_execution step for json_schema output). A
   * plain, schema-free conversational question for the exact same search
   * ("pubs in Ontario that host Ruby trivia") answered correctly in under
   * a minute — the web research itself was never the slow part; combining
   * it with constrained-grammar generation was.
   *
   * Step 1 does the broad research as free text (no schema, so no grammar
   * constraint), matching that fast shape. Step 2 is a small, bounded,
   * tool-free pass that structures the ALREADY-FOUND text into
   * COMPETITOR_DISCOVERY_SCHEMA — the schema constraint now only applies
   * to a short, fixed piece of input, not to open-ended exploration.
   */
  private async discoverCompetitorTwoStep(
    params: DiscoverParams,
    onProgress?: (update: DiscoveryProgressUpdate) => Promise<void>,
  ): Promise<ResearchCandidate[]> {
    const { model } = await resolveResearchSettings();
    const locationScope = params.cities.length > 0 ? params.cities.join(", ") : `all of ${params.region} (no city filter given)`;

    const researchText = await callProvider({ providerName: "anthropic-discovery-research", timeoutMs: 300_000 }, async (signal) => {
      const stream = client().messages.stream(
        {
          model,
          // Was 4000 — raised since each venue's line now also carries
          // address/phone/email/website when visible, not just name/city/
          // day, so a broad search finding many venues needs more headroom
          // per candidate than before.
          max_tokens: 8000,
          // ACTUAL root cause of every slow/failed run tonight, found by
          // reading Anthropic's own web_search tool docs directly (not
          // guessed): web_search_20260209's `allowed_callers` defaults to
          // ["code_execution_20260120"], meaning the API automatically
          // routes every search through a "Dynamic Filtering" pass — Claude
          // invokes code_execution/bash_code_execution to filter results
          // before they reach the context window. This runs on EVERY
          // attempt regardless of tool budget, effort level, or schema
          // presence (confirmed: it happened even in this schema-free call)
          // — none of those were ever the actual lever. Restricting to
          // "direct" calling disables that automatic filtering pass,
          // matching a plain conversational web_search call's fast,
          // unfiltered behavior.
          tools: [{ type: "web_search_20260209", name: "web_search", max_uses: COMPETITOR_PASS1_MAX_SEARCH_USES, allowed_callers: ["direct"] }],
          messages: [
            {
              role: "user",
              content:
                `Find ${params.leadTypeName} venues in ${locationScope}, ${params.country} that currently run trivia hosted by the service "${params.competitorName}". ` +
                `Business criteria: ${params.promptText}\n\n` +
                "Search the web and list every plausible venue you find — name, city/town, and day of the week if mentioned, plus address, phone number, email, and website whenever they're visible directly in the search results or listing snippet (don't fetch full pages digging for these — only what's already shown). " +
                "One line per PHYSICAL LOCATION, never one line per chain/brand: if a chain has multiple branches running this competitor's trivia, list each branch on its own line with its own city (e.g. \"St. Louis Bar & Grill — Burlington\" and \"St. Louis Bar & Grill — Newmarket\" as two separate lines) — never summarize them together as one entry like \"St. Louis Bar & Grill (multiple locations)\", which throws away real, distinct leads. " +
                "If a location clearly runs trivia through a DIFFERENT named provider, still list it and note that provider's name — don't omit or guess.",
            },
          ],
        },
        { signal },
      );
      stream.on("contentBlock", (block) => {
        if (block.type === "server_tool_use") {
          void onProgress?.({ kind: "message", message: serverToolProgressMessage(block.name, block.input) });
        }
      });

      let finalMessage;
      try {
        finalMessage = await stream.finalMessage();
      } catch (error) {
        const partialUsage = stream.currentMessage?.usage;
        if (partialUsage) {
          await recordUsage({ operation: "discover", model, usage: partialUsage, searchId: params.searchId, userId: params.userId });
        }
        throw error;
      }
      await recordUsage({ operation: "discover", model, usage: finalMessage.usage, searchId: params.searchId, userId: params.userId });
      assertNotTruncated(finalMessage.stop_reason, "anthropic-discovery-research");
      // Confirmed live: taking only the FIRST text block (the old
      // .find(...) here) silently discarded the model's actual venue list.
      // With web_search tool use interleaved into the response, the model
      // produces multiple separate text blocks across turns — e.g. a short
      // intro sentence ("Based on extensive searching, here is a
      // comprehensive list...") as one block, then the real list in a
      // LATER block once it's done searching. A real search burned $1.14
      // doing genuine research and this bug threw all of it away, leaving
      // only the 299-character intro paragraph. Concatenate every text
      // block, in order, instead of just the first.
      const researchText = finalMessage.content
        .filter((block): block is Extract<typeof block, { type: "text" }> => block.type === "text")
        .map((block) => block.text)
        .join("\n");
      return researchText;
    });

    if (!researchText.trim()) return [];

    void onProgress?.({ kind: "message", message: "Organizing what was found into a candidate list..." });

    return callProvider({ providerName: "anthropic-discovery-structure", timeoutMs: 120_000 }, async (signal) => {
      const response = await client().messages.create(
        {
          model,
          max_tokens: 12000,
          output_config: { format: { type: "json_schema", schema: COMPETITOR_DISCOVERY_SCHEMA } },
          messages: [
            {
              role: "user",
              content:
                "Convert these research notes into a structured candidate list. Only include venues actually named in the notes — never invent one. Leave a field null when the notes don't say. address1 must be the street address ONLY (no city, region, postal code, or country). " +
                "Each candidate must be one specific physical location with a real city — if a note groups several branches together (e.g. \"multiple locations\" or similar, with no single city given), skip that note entirely rather than creating one candidate with a vague or non-city value in the city field. " +
                `Region: ${params.region}, Country: ${params.country}. Only set competitorName to "${params.competitorName}" when the notes tie that venue to this specific service — if the notes name a different provider for a venue, use that provider's name instead. ` +
                `${DAY_FIELD_INSTRUCTION}\n\n` +
                `Research notes:\n${researchText}`,
            },
          ],
        },
        { signal },
      );
      await recordUsage({ operation: "discover", model, usage: response.usage, searchId: params.searchId, userId: params.userId });
      assertNotTruncated(response.stop_reason, "anthropic-discovery-structure");
      const jsonBlock = response.content.find((block) => block.type === "text");
      if (!jsonBlock || !("text" in jsonBlock)) return [];
      const parsed = JSON.parse(jsonBlock.text) as { candidates: ResearchCandidate[] };
      // COMPETITOR_DISCOVERY_SCHEMA omits evidence/contactData entirely, so
      // those keys are simply absent from the model's JSON, not null —
      // default them here so every ResearchCandidate downstream keeps its
      // required array shape regardless of which schema produced it.
      return parsed.candidates.map((candidate) => ({
        ...candidate,
        contactData: candidate.contactData ?? [],
        evidence: candidate.evidence ?? [],
        sources: candidate.sources ?? [],
        day: normalizeWeekday(candidate.day),
      }));
    });
  }
}

export class AnthropicEvidenceVerificationProvider implements EvidenceVerificationProvider {
  async verify(candidate: ResearchCandidate, params: DiscoverParams): Promise<ResearchCandidate> {
    const { model, maxSearchToolUses } = await resolveResearchSettings();
    // Was scaled down from discover()'s 300s to 120s under the assumption
    // that a smaller tool budget (3+3 vs 8+8) means proportionally less
    // latency — confirmed wrong live: this call hit the 120s ceiling
    // repeatedly even after discover() was consistently succeeding at 300s,
    // so per-call fixed overhead (not tool count) dominates here. Matching
    // discover()'s budget instead of guessing at a smaller number. Now uses
    // the same admin-configurable maxSearchToolUsesPerCall as discover() —
    // previously hardcoded to a smaller fixed 3, independently of it.
    return callProvider({ providerName: "anthropic-verification", timeoutMs: 300_000 }, async (signal) => {
      const response = await client().messages.create(
        {
          model,
          max_tokens: 2000,
          tools: [
            { type: "web_search_20260209", name: "web_search", max_uses: maxSearchToolUses },
            { type: "web_fetch_20260209", name: "web_fetch", max_uses: maxSearchToolUses },
          ],
          output_config: {
            format: {
              type: "json_schema",
              schema: CANDIDATE_ITEM_SCHEMA,
            },
          },
          messages: [
            {
              role: "user",
              content:
                `${modeInstructions(params.mode, params.competitorName)}\n\n${DAY_FIELD_INSTRUCTION}\n\nVerify and refresh the evidence for this specific candidate, re-checking its website/public listings:\n\n${JSON.stringify(candidate)}`,
            },
          ],
        },
        { signal },
      );
      await recordUsage({ operation: "verify", model, usage: response.usage, searchId: params.searchId, userId: params.userId });
      assertNotTruncated(response.stop_reason, "anthropic-verification");
      const jsonBlock = response.content.find((block) => block.type === "text");
      if (!jsonBlock || !("text" in jsonBlock)) return candidate;
      const merged = { ...candidate, ...(JSON.parse(jsonBlock.text) as Partial<ResearchCandidate>) };
      return { ...merged, day: normalizeWeekday(merged.day) };
    });
  }
}

export class AnthropicScoringProvider implements ScoringProvider {
  async score(candidate: ResearchCandidate, params: DiscoverParams): Promise<{ score: number; explanation: string }> {
    const model = await resolveModel();
    return callProvider({ providerName: "anthropic-scoring", timeoutMs: 30_000 }, async (signal) => {
      const response = await client().messages.create(
        {
          model,
          max_tokens: 500,
          output_config: {
            format: {
              type: "json_schema",
              schema: {
                type: "object",
                properties: { score: { type: "integer" }, explanation: { type: "string" } },
                required: ["score", "explanation"],
                additionalProperties: false,
              },
            },
          },
          messages: [
            {
              role: "user",
              content:
                `Score this research candidate 0-100 for lead quality against the search criteria "${params.promptText}" (lead type: ${params.leadTypeName}, mode: ${params.mode}). ` +
                `Weigh strength/count of evidence and how well the candidate fits the criteria. Candidate:\n\n${JSON.stringify(candidate)}`,
            },
          ],
        },
        { signal },
      );
      await recordUsage({ operation: "score", model, usage: response.usage, searchId: params.searchId, userId: params.userId });
      assertNotTruncated(response.stop_reason, "anthropic-scoring");
      const jsonBlock = response.content.find((block) => block.type === "text");
      if (!jsonBlock || !("text" in jsonBlock)) return { score: 0, explanation: "Scoring provider returned no output." };
      return JSON.parse(jsonBlock.text) as { score: number; explanation: string };
    });
  }
}

/**
 * The EOS-1.0 "opportunity analysis" engine: fills in the same 10 fixed
 * categories a human enters by hand via recordHistoricalScore() (src/app/
 * (dashboard)/companies/[id]/eos/actions.ts), for an already-existing CRM
 * Company rather than a lead-search candidate. Distinct from
 * AnthropicScoringProvider above (which ranks candidates against a search
 * prompt, not CRM companies) and takes no DiscoverParams — there's no
 * LeadSearch/mode/promptText for a bare Company.
 */
function serverToolProgressMessage(name: string, toolInput: unknown): string {
  const asRecord = toolInput && typeof toolInput === "object" ? (toolInput as Record<string, unknown>) : {};
  if (name === "web_search") {
    const query = typeof asRecord.query === "string" ? asRecord.query : null;
    return query ? `Searching the web for "${query}"...` : "Searching the web...";
  }
  if (name === "web_fetch") {
    const url = typeof asRecord.url === "string" ? asRecord.url : null;
    return url ? `Reading ${url}...` : "Fetching a page...";
  }
  return `Using ${name}...`;
}

export class AnthropicOpportunityAnalysisProvider implements OpportunityAnalysisProvider {
  async analyze(
    input: OpportunityAnalysisInput,
    onProgress?: (event: { message: string }) => void,
  ): Promise<OpportunityAnalysisResult> {
    const { model, maxSearchToolUses } = await resolveOpportunityAnalysisSettings();
    // Given to the model as known-name hints only (see the prompt below) —
    // matching the found provider back to one of these by exact name
    // happens deterministically in analyze-opportunity.ts, never trusted to
    // the model's own judgment of "is this the same competitor."
    const knownCompetitors = await prisma.competitor.findMany({ where: { active: true }, select: { name: true }, orderBy: { name: "asc" } });
    // 840s (14min), not the other providers' 300s: confirmed live, a
    // sparse-web-presence subject (e.g. small-town pubs) makes the model
    // burn many search/fetch rounds finding little, genuinely running past
    // 5 minutes. Streaming (below) is what makes that survivable at all on
    // Railway (up to 15min as long as bytes keep flowing) — but this
    // AbortController timeout is a separate, app-level ceiling that was
    // still left at 300_000, silently defeating the point of streaming for
    // exactly the slow cases it was built to tolerate. 840s leaves a safety
    // margin under Railway's 15min proxy ceiling.
    return callProvider({ providerName: "anthropic-opportunity-analysis", timeoutMs: 840_000 }, async (signal) => {
      // Streamed, not a single blocking create() call: this request can
      // legitimately run close to (or past) 5 minutes doing real web
      // research, and Railway's edge proxy closes any HTTP request with no
      // data transferred for 5 minutes straight (confirmed against
      // Railway's own current docs) — a blocking create() call sends
      // nothing back until it's fully done, so it was getting killed by
      // the proxy before the response ever returned. Streaming keeps bytes
      // flowing continuously (Railway allows up to 15 minutes as long as
      // data keeps transferring), and as a direct benefit, each
      // "contentBlock" the model actually produces (a real web_search/
      // web_fetch call) becomes a genuine, verifiable progress update for
      // the caller — not a synthetic timer.
      const stream = client().messages.stream(
        {
          model,
          // Raised twice: 4000 -> 8000 (still truncated) -> 16000, matching
          // discover()'s budget. The earlier fix only ever addressed the
          // ceiling, not the actual driver: confirmed against Anthropic's
          // current docs, output_config.effort defaults to "high" whenever
          // it's omitted (exactly this call, until now) — and effort
          // governs ALL tokens in the response, thinking AND tool calls
          // included, all sharing this same max_tokens budget with the
          // final structured output. That's the real reason this call both
          // grinds long (confirmed live: still timing out at 14min even
          // after capping maxSearchToolUses down to 4) and still
          // occasionally truncates at 16000 despite the cap. "medium" is
          // Anthropic's own documented recommendation for Sonnet 5 as a
          // cost/speed step-down "comparable to Sonnet 4.6 at high effort"
          // — appropriate here since this is a bounded, rubric-driven
          // scoring task (10 fixed categories, cite evidence), not
          // open-ended exploratory research.
          max_tokens: 16000,
          tools: [
            { type: "web_search_20260209", name: "web_search", max_uses: maxSearchToolUses },
            { type: "web_fetch_20260209", name: "web_fetch", max_uses: maxSearchToolUses },
          ],
          output_config: { effort: "medium", format: { type: "json_schema", schema: OPPORTUNITY_ANALYSIS_SCHEMA } },
          messages: [
            {
              role: "user",
              content:
                `Score this business as a sales opportunity for "${input.leadTypeName}" against these 10 fixed categories — each has its own maximum point value, do not exceed it:\n${opportunityCategoryRubric()}\n\n` +
                "Trusted facts — already verified, do NOT re-check or dispute these; research everything else about the business instead:\n" +
                `Name: ${input.name}\nAddress: ${input.address1 ?? "(none on file)"}, ${input.city}, ${input.region} ${input.postalCode ?? ""}, ${input.country}\n` +
                `Phone: ${input.phone ?? "(none on file)"}\nWebsite: ${input.websiteUrl ?? "(none on file)"}\n\n` +
                `Currently on file: email ${input.email ?? "(none — research and report any public email you find as foundEmail)"}. Existing notes: ${input.notes ?? "(none)"}.\n\n` +
                "Use web_search/web_fetch to research what's missing (public contact info, decision-maker accessibility, marketing presence, community engagement, etc.) and to find supporting evidence for each category score. " +
                "Every evidence entry must cite a sourceUrl you actually found or fetched, and its category must be one of the 10 category keys above, in SCREAMING_SNAKE_CASE. " +
                "Specifically check whether the venue has TVs/screens — trivia hosting requires a screen to display questions, so this is reported as its own field (hasTvs), separate from the category scores. Real signals: menus, \"watch the game\"/sports-bar branding, review mentions, or an explicit no-TV/conversation-focused policy. Set hasTvs true or false ONLY on a genuine explicit finding either way; a plain absence of any mention is NOT evidence of no TVs — leave hasTvs null when unconfirmed, and do not let this uncertainty lower turnkeyImplementationReadiness or salesPriorityScore on its own. " +
                "Specifically check whether this venue ALREADY runs a trivia night through some other trivia company — not karaoke, live music, or other unrelated entertainment, only trivia/quiz nights. Look for a schedule page, event listing, or social post naming the trivia host, and use that finding as real evidence for the competitiveOpportunity category score. " +
                (knownCompetitors.length > 0
                  ? `Known trivia providers we track (use this EXACT spelling as providerName if you find a match): ${knownCompetitors.map((c) => c.name).join(", ")}. If you find a different, unlisted trivia provider instead, report its name exactly as found. `
                  : "") +
                "Report this as competitorFound: set providerName to the trivia provider's name and day to the weekday its trivia night runs (SCREAMING_SNAKE_CASE, e.g. THURSDAY) ONLY on a genuine positive finding, citing sourceUrl. Leave day null if a competitor is confirmed but the specific night isn't. Leave competitorFound entirely null if you find no positive evidence of an existing trivia competitor — a plain absence of any mention is NOT evidence of no competitor, so do not guess. " +
                "Only set conflict.found to true if you discover a genuine contradiction of one of the trusted facts above (e.g. the business appears permanently closed, or the name at this address doesn't match) — never as a way to change the trusted facts themselves; otherwise leave conflict.found false.",
            },
          ],
        },
        { signal },
      );

      stream.on("contentBlock", (block) => {
        if (block.type === "server_tool_use") {
          onProgress?.({ message: serverToolProgressMessage(block.name, block.input) });
        } else if (block.type === "thinking") {
          onProgress?.({ message: "Reasoning through the evidence gathered so far..." });
        }
      });

      // contentBlock above fires once per block, but a single thinking block
      // can itself run for a long stretch (many seconds) with no further
      // events — confirmed the source of real-world complaints that a
      // multi-minute analysis "doesn't look like it's doing anything" for
      // long gaps. thinking_delta deltas arrive continuously while the model
      // is actually generating reasoning tokens, so throttling a repeat of
      // the same message off of them is still a real, verifiable activity
      // signal (tokens are actually being produced right now), not a
      // synthetic timer — it just surfaces an existing signal more often
      // instead of only at each block's start.
      let lastThinkingHeartbeat = 0;
      stream.on("streamEvent", (event) => {
        if (event.type !== "content_block_delta" || event.delta.type !== "thinking_delta") return;
        const now = Date.now();
        if (now - lastThinkingHeartbeat < 5000) return;
        lastThinkingHeartbeat = now;
        onProgress?.({ message: "Reasoning through the evidence gathered so far..." });
      });

      let finalMessage;
      try {
        finalMessage = await stream.finalMessage();
      } catch (error) {
        // A timed-out/aborted call still gets billed by Anthropic for every
        // token it generated before the abort — confirmed live, a call that
        // ground for the full 14 minutes before timing out never showed up
        // in AiUsageRecord at all, because recordUsage() below only ran on
        // the success path. That leaves both the cost dashboard and
        // checkAiBudget()'s enforcement blind to exactly the calls that cost
        // the most. currentMessage is the SDK's running-accumulated Message
        // as events arrive, including the latest usage snapshot from
        // message_delta events — a best-effort record of real spend, not a
        // decorative fallback.
        const partialUsage = stream.currentMessage?.usage;
        if (partialUsage) {
          await recordUsage({ operation: "analyzeOpportunity", model, usage: partialUsage, userId: input.userId });
        }
        throw error;
      }
      await recordUsage({ operation: "analyzeOpportunity", model, usage: finalMessage.usage, userId: input.userId });
      assertNotTruncated(finalMessage.stop_reason, "anthropic-opportunity-analysis");
      const jsonBlock = finalMessage.content.find((block) => block.type === "text");
      if (!jsonBlock || !("text" in jsonBlock)) {
        throw new Error("Opportunity analysis provider returned no output.");
      }
      const parsed = JSON.parse(jsonBlock.text) as OpportunityAnalysisResult;
      return { ...parsed, competitorFound: normalizeCompetitorFound(parsed.competitorFound) };
    });
  }
}
