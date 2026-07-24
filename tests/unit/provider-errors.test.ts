import { describe, it, expect } from "vitest";
import { AuthenticationError, RateLimitError, InternalServerError, BadRequestError, APIConnectionTimeoutError } from "@anthropic-ai/sdk";
import { classifyProviderError } from "../../src/lib/integrations/provider-errors";
import { ProviderRateLimitError, ProviderTimeoutError } from "../../src/lib/research/providers/http";
import { EmailProviderRateLimitError, EmailProviderTimeoutError } from "../../src/lib/comms/providers/http";
import { ResendApiError } from "../../src/lib/transactional/providers/resend";

describe("classifyProviderError", () => {
  it("classifies the app's own rate-limit errors (research and email) as rate_limited", () => {
    expect(classifyProviderError(new ProviderRateLimitError("anthropic-discovery")).category).toBe("rate_limited");
    expect(classifyProviderError(new EmailProviderRateLimitError("resend")).category).toBe("rate_limited");
  });

  it("classifies the app's own timeout errors (research and email) as timeout", () => {
    expect(classifyProviderError(new ProviderTimeoutError("anthropic-discovery", 30000)).category).toBe("timeout");
    expect(classifyProviderError(new EmailProviderTimeoutError("resend", 30000)).category).toBe("timeout");
  });

  it("classifies Anthropic SDK AuthenticationError as authentication", () => {
    const error = new AuthenticationError(401, { type: "authentication_error", message: "invalid key" }, "invalid key", new Headers());
    expect(classifyProviderError(error).category).toBe("authentication");
  });

  it("classifies Anthropic SDK RateLimitError as rate_limited", () => {
    const error = new RateLimitError(429, { type: "rate_limit_error", message: "too many requests" }, "too many requests", new Headers());
    expect(classifyProviderError(error).category).toBe("rate_limited");
  });

  it("classifies Anthropic SDK InternalServerError as temporary_outage", () => {
    const error = new InternalServerError(500, { type: "api_error", message: "oops" }, "oops", new Headers());
    expect(classifyProviderError(error).category).toBe("temporary_outage");
  });

  it("classifies Anthropic SDK BadRequestError as invalid_response", () => {
    const error = new BadRequestError(400, { type: "invalid_request_error", message: "bad" }, "bad", new Headers());
    expect(classifyProviderError(error).category).toBe("invalid_response");
  });

  it("classifies Anthropic SDK APIConnectionTimeoutError as timeout", () => {
    const error = new APIConnectionTimeoutError();
    expect(classifyProviderError(error).category).toBe("timeout");
  });

  it.each([
    ["missing_api_key", "authentication"],
    ["invalid_api_key", "authentication"],
    ["monthly_quota_exceeded", "budget_exceeded"],
    ["daily_quota_exceeded", "budget_exceeded"],
    ["rate_limit_exceeded", "rate_limited"],
    ["validation_error", "permanent_rejection"],
    ["invalid_from_address", "configuration"],
    ["internal_server_error", "temporary_outage"],
    ["invalid_idempotency_key", "temporary_deferral"],
    ["not_found", "unknown"],
  ] as const)("classifies Resend error code %s as %s", (code, expectedCategory) => {
    expect(classifyProviderError(new ResendApiError(code, "message")).category).toBe(expectedCategory);
  });

  it("classifies a plain configuration-message Error as configuration", () => {
    expect(classifyProviderError(new Error("RESEND_API_KEY is not set — required to use the Resend transactional provider.")).category).toBe("configuration");
  });

  it("falls back to unknown for an unrecognized error", () => {
    expect(classifyProviderError(new Error("something weird happened")).category).toBe("unknown");
    expect(classifyProviderError("not even an Error instance").category).toBe("unknown");
  });

  it("never includes the original error's raw message in the safe message", () => {
    const raw = "super-secret-internal-detail-12345";
    const result = classifyProviderError(new Error(raw));
    expect(result.safeMessage).not.toContain(raw);
  });
});
