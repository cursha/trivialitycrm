// AI campaign-message personalization — deliberately a small, self-contained
// direct Anthropic call (mirroring AnthropicPromptAssistant.refine()'s
// simple non-streaming shape in src/lib/research/providers/anthropic.ts),
// not a new multi-method ResearchProviders-style interface: this is one
// bounded generation task per recipient, not an open-ended research pass, so
// it doesn't need web_search/web_fetch tools, streaming, or a shared
// provider-selection apparatus beyond the same mock/live env-var switch
// every other AI-touching feature in this app already uses.
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { getAiSettings } from "@/lib/ai/budget";
import { estimateCostUsd } from "@/lib/research/providers/pricing";

const FALLBACK_MODEL = "claude-sonnet-5";

export type CampaignPersonalizationInput = {
  company: {
    name: string;
    city: string;
    region: string;
    leadTypeName: string;
    scoreExplanation: string | null;
    verifiedEvidenceSummary: string | null;
    triviaStatus: string;
    competitorTriviaProvider: string | null;
  };
  contact: { firstName: string; lastName: string; title: string | null };
  /** Instructions entered for this specific campaign. */
  campaignInstructions: string;
  /** Reusable, administrator-created campaign instructions, if the creator
   * chose to apply one. */
  reusableInstructions: string | null;
  /** Subject/body instructions from an approved email template, if the
   * creator chose to guide the campaign with one — a starting structure/
   * tone, not literal boilerplate to insert unedited. */
  templateGuidance: string | null;
  userId?: string;
};

export type CampaignPersonalizationResult = { subject: string; body: string };

export interface CampaignPersonalizationProvider {
  generate(input: CampaignPersonalizationInput): Promise<CampaignPersonalizationResult>;
}

/** Deterministic, no network — the only provider ever active under
 * NODE_ENV=test, same convention as every mock provider in this app. */
export class MockCampaignPersonalizationProvider implements CampaignPersonalizationProvider {
  async generate(input: CampaignPersonalizationInput): Promise<CampaignPersonalizationResult> {
    return {
      subject: `[Mock] A quick note for ${input.company.name}`,
      body:
        `Hi ${input.contact.firstName},\n\n[Mock personalized message for ${input.company.name} in ${input.company.city}, ${input.company.region}.]\n\n` +
        `{{unsubscribeLink}}`,
    };
  }
}

const CAMPAIGN_MESSAGE_SCHEMA = {
  type: "object",
  properties: {
    subject: { type: "string" },
    body: { type: "string" },
  },
  required: ["subject", "body"],
  additionalProperties: false,
} as const;

function client(): Anthropic {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) throw new Error("AI_API_KEY is not set — required to use the Anthropic campaign personalization provider.");
  return new Anthropic({ apiKey, maxRetries: 2 });
}

async function resolveModel(): Promise<string> {
  try {
    return (await getAiSettings()).approvedModel;
  } catch {
    return FALLBACK_MODEL;
  }
}

export class AnthropicCampaignPersonalizationProvider implements CampaignPersonalizationProvider {
  async generate(input: CampaignPersonalizationInput): Promise<CampaignPersonalizationResult> {
    const model = await resolveModel();

    const response = await client().messages.create({
      model,
      max_tokens: 2048,
      output_config: { format: { type: "json_schema", schema: CAMPAIGN_MESSAGE_SCHEMA } },
      messages: [
        {
          role: "user",
          content:
            "Write one short, personalized sales outreach email for the company below. " +
            "Only state facts given here as trusted, or explicitly listed in the campaign instructions as an approved offer — " +
            "never invent facts, contact names, relationships, prices, promises, or venue details not given below. " +
            "If a fact isn't provided, write around it rather than guessing or fabricating it.\n\n" +
            "Trusted facts:\n" +
            `Company: ${input.company.name}, ${input.company.city}, ${input.company.region}\n` +
            `Lead type: ${input.company.leadTypeName}\n` +
            `Contact: ${input.contact.firstName} ${input.contact.lastName}${input.contact.title ? `, ${input.contact.title}` : ""}\n` +
            `Trivia status: ${input.company.triviaStatus}\n` +
            (input.company.competitorTriviaProvider ? `Existing trivia provider on file: ${input.company.competitorTriviaProvider}\n` : "") +
            (input.company.scoreExplanation ? `EOS opportunity notes: ${input.company.scoreExplanation}\n` : "") +
            (input.company.verifiedEvidenceSummary ? `Verified evidence on file: ${input.company.verifiedEvidenceSummary}\n` : "") +
            "\nCampaign instructions for this message:\n" +
            `${input.campaignInstructions}\n` +
            (input.reusableInstructions ? `\nReusable house instructions:\n${input.reusableInstructions}\n` : "") +
            (input.templateGuidance ? `\nApproved template guidance (tone/structure reference, not literal text to copy verbatim):\n${input.templateGuidance}\n` : "") +
            "\nThe email body MUST include the literal text {{unsubscribeLink}} exactly once, unresolved — do not write out an actual unsubscribe URL yourself, the token is resolved separately at send time. " +
            "Write a short subject line and a short, genuinely personalized body — no generic form-letter filler.",
        },
      ],
    });

    await recordUsage({ model, usage: response.usage, userId: input.userId });

    const jsonBlock = response.content.find((block) => block.type === "text");
    if (!jsonBlock || !("text" in jsonBlock)) throw new Error("Campaign personalization returned no content.");
    return JSON.parse(jsonBlock.text) as CampaignPersonalizationResult;
  }
}

type ProviderUsage = { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null };

async function recordUsage(params: { model: string; usage: ProviderUsage; userId?: string }): Promise<void> {
  try {
    const estimatedCostUsd = estimateCostUsd({
      model: params.model,
      inputTokens: params.usage.input_tokens,
      outputTokens: params.usage.output_tokens,
      cacheReadTokens: params.usage.cache_read_input_tokens ?? 0,
      cacheCreationTokens: params.usage.cache_creation_input_tokens ?? 0,
      webSearchRequests: 0,
      webFetchRequests: 0,
    });
    await prisma.aiUsageRecord.create({
      data: {
        userId: params.userId ?? null,
        provider: "anthropic",
        operation: "personalizeCampaign",
        model: params.model,
        inputTokens: params.usage.input_tokens,
        outputTokens: params.usage.output_tokens,
        cacheReadTokens: params.usage.cache_read_input_tokens ?? 0,
        cacheCreationTokens: params.usage.cache_creation_input_tokens ?? 0,
        estimatedCostUsd,
      },
    });
  } catch {
    // Best-effort — a failure to record usage must never fail the actual
    // personalization call, matching every other recordUsage() in this app.
  }
}

export function getCampaignPersonalizationProvider(): CampaignPersonalizationProvider {
  const aiProvider = (process.env.AI_PROVIDER || "mock").toLowerCase();
  switch (aiProvider) {
    case "mock":
      return new MockCampaignPersonalizationProvider();
    case "anthropic":
      return new AnthropicCampaignPersonalizationProvider();
    default:
      throw new Error(`Unknown AI_PROVIDER "${aiProvider}" — expected "mock" or "anthropic".`);
  }
}
