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

const CANDIDATE_SCHEMA = {
  type: "object",
  properties: {
    candidates: {
      type: "array",
      items: {
        type: "object",
        properties: {
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
          evidence: {
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
          },
          sources: {
            type: "array",
            items: {
              type: "object",
              properties: { url: { type: "string" }, title: { type: ["string", "null"] } },
              required: ["url", "title"],
              additionalProperties: false,
            },
          },
        },
        required: [
          "name",
          "address1",
          "city",
          "region",
          "postalCode",
          "country",
          "phone",
          "email",
          "websiteUrl",
          "triviaStatus",
          "competitorName",
          "evidence",
          "sources",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["candidates"],
  additionalProperties: false,
} as const;

const EOS_CATEGORY_KEYS = Object.keys(EOS_CATEGORY_MAXIMA) as (keyof typeof EOS_CATEGORY_MAXIMA)[];

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
    categoryScores: {
      type: "object",
      properties: Object.fromEntries(EOS_CATEGORY_KEYS.map((key) => [key, { type: "integer", minimum: 0, maximum: EOS_CATEGORY_MAXIMA[key] }])),
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

function modeInstructions(mode: DiscoverParams["mode"], competitorName?: string): string {
  switch (mode) {
    case "TRIVIA_GAP":
      return "Find locations that offer regular events (live music, karaoke, other entertainment) but do NOT currently offer trivia. Do not include any location with positive evidence of an existing trivia night.";
    case "TRIVIA_CONFIRMED":
      return "Find locations with POSITIVE, verifiable evidence that they currently run a trivia night (a schedule page, event listing, or social post naming a specific recurring trivia event). Uncertain or ambiguous evidence must be marked triviaStatus \"UNCERTAIN\", never \"CURRENT_TRIVIA\".";
    case "COMPETITOR":
      return `Find locations using the trivia service "${competitorName}". Only set competitorName when there is direct evidence (the competitor's own name, branding, or host credit) tying the location to that service.`;
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
  async discover(params: DiscoverParams): Promise<ResearchCandidate[]> {
    const { model, maxSearchToolUses } = await resolveResearchSettings();
    // Up to maxSearchToolUses web_search + maxSearchToolUses web_fetch tool
    // round-trips for a broad query (e.g. no city filter, or "all pubs in a
    // city") can genuinely take several minutes — the run-search job itself
    // is designed for that (expireInSeconds: 3600 in boss-client.ts, with
    // per-candidate checkpointing run in concurrent batches, see
    // run-search.ts's CANDIDATE_CONCURRENCY), but this call's own timeout
    // was originally set well below that. Confirmed by an actual live run: a
    // real search consistently hit the old 120s ceiling before Claude
    // finished working through its tool calls.
    return callProvider({ providerName: "anthropic-discovery", timeoutMs: 300_000 }, async (signal) => {
      const locationScope = params.cities.length > 0 ? params.cities.join(", ") : `all of ${params.region} (no city filter given)`;

      const response = await client().messages.create(
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
                "Only report facts you can support with a web_search or web_fetch result. Do not invent addresses, phone numbers, or emails — leave a field null rather than guessing. Every evidence entry must cite a sourceUrl you actually fetched or found in search results.",
            },
          ],
        },
        { signal },
      );

      await recordUsage({ operation: "discover", model, usage: response.usage, searchId: params.searchId, userId: params.userId });
      assertNotTruncated(response.stop_reason, "anthropic-discovery");

      const jsonBlock = response.content.find((block) => block.type === "text");
      if (!jsonBlock || !("text" in jsonBlock)) return [];
      const parsed = JSON.parse(jsonBlock.text) as { candidates: ResearchCandidate[] };
      return parsed.candidates.map((candidate) => ({ ...candidate, contactData: null }));
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
              schema: CANDIDATE_SCHEMA.properties.candidates.items,
            },
          },
          messages: [
            {
              role: "user",
              content:
                `${modeInstructions(params.mode, params.competitorName)}\n\nVerify and refresh the evidence for this specific candidate, re-checking its website/public listings:\n\n${JSON.stringify(candidate)}`,
            },
          ],
        },
        { signal },
      );
      await recordUsage({ operation: "verify", model, usage: response.usage, searchId: params.searchId, userId: params.userId });
      assertNotTruncated(response.stop_reason, "anthropic-verification");
      const jsonBlock = response.content.find((block) => block.type === "text");
      if (!jsonBlock || !("text" in jsonBlock)) return candidate;
      return { ...candidate, ...(JSON.parse(jsonBlock.text) as Partial<ResearchCandidate>) };
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
export class AnthropicOpportunityAnalysisProvider implements OpportunityAnalysisProvider {
  async analyze(input: OpportunityAnalysisInput): Promise<OpportunityAnalysisResult> {
    const { model, maxSearchToolUses } = await resolveResearchSettings();
    return callProvider({ providerName: "anthropic-opportunity-analysis", timeoutMs: 300_000 }, async (signal) => {
      const response = await client().messages.create(
        {
          model,
          // Confirmed live: 4000 was too tight and got truncated (same
          // failure discover() hit before its own max_tokens was raised
          // 8000->16000 — see that comment above) — this response is a
          // single company, but has six substantial free-text summary
          // fields plus a whole evidence array on top of the 10 category
          // scores, more prose than discover()'s per-candidate shape.
          max_tokens: 8000,
          tools: [
            { type: "web_search_20260209", name: "web_search", max_uses: maxSearchToolUses },
            { type: "web_fetch_20260209", name: "web_fetch", max_uses: maxSearchToolUses },
          ],
          output_config: { format: { type: "json_schema", schema: OPPORTUNITY_ANALYSIS_SCHEMA } },
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
                "Only set conflict.found to true if you discover a genuine contradiction of one of the trusted facts above (e.g. the business appears permanently closed, or the name at this address doesn't match) — never as a way to change the trusted facts themselves; otherwise leave conflict.found false.",
            },
          ],
        },
        { signal },
      );
      await recordUsage({ operation: "analyzeOpportunity", model, usage: response.usage, userId: input.userId });
      assertNotTruncated(response.stop_reason, "anthropic-opportunity-analysis");
      const jsonBlock = response.content.find((block) => block.type === "text");
      if (!jsonBlock || !("text" in jsonBlock)) {
        throw new Error("Opportunity analysis provider returned no output.");
      }
      return JSON.parse(jsonBlock.text) as OpportunityAnalysisResult;
    });
  }
}
