// Shared, provider-agnostic error classification for every external
// integration (AI research, transactional email). A single place to answer
// "what category of failure was this, and what's safe to show a user" —
// used by the run-search pipeline, the on-demand research action, the new
// AI test-connection action, sendSystemEmail(), and the admin test-send
// action, so every surface in the app describes provider failures the same
// way instead of leaking raw SDK error text (which can include request
// internals) in some places and not others.
import {
  APIError,
  AuthenticationError,
  PermissionDeniedError,
  RateLimitError,
  BadRequestError,
  UnprocessableEntityError,
  InternalServerError,
  APIConnectionError,
  APIConnectionTimeoutError,
} from "@anthropic-ai/sdk";
import { ProviderRateLimitError, ProviderTimeoutError } from "../research/providers/http";
import { EmailProviderRateLimitError, EmailProviderTimeoutError } from "../comms/providers/http";
import { ResendApiError } from "../transactional/providers/resend";

export type ProviderErrorCategory =
  | "configuration"
  | "authentication"
  | "rate_limited"
  | "budget_exceeded"
  | "timeout"
  | "temporary_outage"
  | "invalid_response"
  | "permanent_rejection"
  | "temporary_deferral"
  | "unknown";

export type ClassifiedProviderError = { category: ProviderErrorCategory; safeMessage: string };

// Reviewed, static text only — never interpolates the original error's
// message, which may contain request/response internals that shouldn't
// reach end users even though they aren't secrets.
const SAFE_MESSAGE: Record<ProviderErrorCategory, string> = {
  configuration: "This integration isn't configured correctly. Check its settings in Administration and try again.",
  authentication: "The provider rejected the configured credentials. Check the API key and try again.",
  rate_limited: "Too many requests right now — wait a moment and try again.",
  budget_exceeded: "The configured budget limit has been reached.",
  timeout: "The provider took too long to respond. Try again shortly.",
  temporary_outage: "The provider appears to be temporarily unavailable. Try again shortly.",
  invalid_response: "The provider returned a response we couldn't understand.",
  permanent_rejection: "The provider permanently rejected this request — it will not be retried.",
  temporary_deferral: "The provider temporarily deferred this request. It may succeed on retry.",
  unknown: "Something went wrong with this integration. Check the recent activity for details.",
};

function classified(category: ProviderErrorCategory): ClassifiedProviderError {
  return { category, safeMessage: SAFE_MESSAGE[category] };
}

/** Maps Resend's own RESEND_ERROR_CODE_KEY (resend@6.18.0's
 * ErrorResponse.name — confirmed against the installed SDK's type defs, not
 * assumed) onto this app's shared category taxonomy. */
function classifyResendErrorCode(code: string): ProviderErrorCategory {
  switch (code) {
    case "missing_api_key":
    case "invalid_api_key":
    case "restricted_api_key":
      return "authentication";
    case "monthly_quota_exceeded":
    case "daily_quota_exceeded":
      return "budget_exceeded";
    case "rate_limit_exceeded":
      return "rate_limited";
    case "validation_error":
    case "missing_required_field":
    case "invalid_parameter":
    case "invalid_attachment":
      return "permanent_rejection";
    case "invalid_from_address":
    case "invalid_region":
    case "invalid_access":
      return "configuration";
    case "internal_server_error":
    case "application_error":
      return "temporary_outage";
    case "invalid_idempotency_key":
    case "invalid_idempotent_request":
    case "concurrent_idempotent_requests":
      return "temporary_deferral";
    default:
      return "unknown";
  }
}

/**
 * Classifies any error thrown by an AI or email provider call into a safe,
 * user-displayable category. Order matters — most specific checks first.
 * Unrecognized errors fall back to "unknown" rather than guessing.
 */
export function classifyProviderError(error: unknown): ClassifiedProviderError {
  if (error instanceof ProviderRateLimitError || error instanceof EmailProviderRateLimitError) {
    return classified("rate_limited");
  }
  if (error instanceof ProviderTimeoutError || error instanceof EmailProviderTimeoutError) {
    return classified("timeout");
  }

  if (error instanceof ResendApiError) {
    return classified(classifyResendErrorCode(error.code));
  }

  if (error instanceof AuthenticationError || error instanceof PermissionDeniedError) {
    return classified("authentication");
  }
  if (error instanceof RateLimitError) {
    return classified("rate_limited");
  }
  if (error instanceof BadRequestError || error instanceof UnprocessableEntityError) {
    // Confirmed live: an exhausted Anthropic account balance comes back as
    // a plain BadRequestError ("Your credit balance is too low...") —
    // structurally identical to a genuine malformed-schema 400, but a
    // completely different problem for an admin to act on. Without this
    // check it fell into "invalid_response" ("The provider returned a
    // response we couldn't understand"), which sends whoever's debugging
    // it looking at the request shape instead of the account's billing.
    if (error instanceof Error && /credit balance/i.test(error.message)) {
      return classified("budget_exceeded");
    }
    return classified("invalid_response");
  }
  if (error instanceof InternalServerError) {
    return classified("temporary_outage");
  }
  if (error instanceof APIConnectionTimeoutError) {
    return classified("timeout");
  }
  if (error instanceof APIConnectionError) {
    return classified("temporary_outage");
  }
  if (error instanceof APIError) {
    // Any other status code from the API itself — treat 5xx as a temporary
    // outage, everything else as an invalid/unexpected response rather than
    // guessing at a more specific category.
    return classified(typeof error.status === "number" && error.status >= 500 ? "temporary_outage" : "invalid_response");
  }

  if (error instanceof Error) {
    if (/not set|not configured|requires? .*api key/i.test(error.message)) return classified("configuration");
    if (/truncated/i.test(error.message)) return classified("invalid_response");
  }

  return classified("unknown");
}
