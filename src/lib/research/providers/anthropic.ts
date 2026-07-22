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
import type {
  CandidateDiscoveryProvider,
  DiscoverParams,
  EvidenceVerificationProvider,
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

async function resolveModel(): Promise<string> {
  try {
    const settings = await getAiSettings();
    return settings.approvedModel;
  } catch {
    return FALLBACK_MODEL;
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
  operation: "discover" | "verify" | "score" | "promptAssist";
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
                ? `Improve this reusable business-research prompt for clarity and specificity, keeping its intent:\n\n${input.currentPrompt}\n\nAdditional guidance from the user: ${input.description}`
                : `Write a reusable, specific business-research prompt for AI-assisted lead discovery based on this description:\n\n${input.description}`,
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
    const model = await resolveModel();
    return callProvider({ providerName: "anthropic-discovery", timeoutMs: 120_000 }, async (signal) => {
      const locationScope = params.cities.length > 0 ? params.cities.join(", ") : `all of ${params.region} (no city filter given)`;

      const response = await client().messages.create(
        {
          model,
          max_tokens: 8000,
          tools: [
            { type: "web_search_20260209", name: "web_search", max_uses: 8 },
            { type: "web_fetch_20260209", name: "web_fetch", max_uses: 8 },
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

      const jsonBlock = response.content.find((block) => block.type === "text");
      if (!jsonBlock || !("text" in jsonBlock)) return [];
      const parsed = JSON.parse(jsonBlock.text) as { candidates: ResearchCandidate[] };
      return parsed.candidates.map((candidate) => ({ ...candidate, contactData: null }));
    });
  }
}

export class AnthropicEvidenceVerificationProvider implements EvidenceVerificationProvider {
  async verify(candidate: ResearchCandidate, params: DiscoverParams): Promise<ResearchCandidate> {
    const model = await resolveModel();
    return callProvider({ providerName: "anthropic-verification", timeoutMs: 60_000 }, async (signal) => {
      const response = await client().messages.create(
        {
          model,
          max_tokens: 2000,
          tools: [
            { type: "web_search_20260209", name: "web_search", max_uses: 3 },
            { type: "web_fetch_20260209", name: "web_fetch", max_uses: 3 },
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
      const jsonBlock = response.content.find((block) => block.type === "text");
      if (!jsonBlock || !("text" in jsonBlock)) return { score: 0, explanation: "Scoring provider returned no output." };
      return JSON.parse(jsonBlock.text) as { score: number; explanation: string };
    });
  }
}
