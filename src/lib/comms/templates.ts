// No `import "server-only"` — a pure string-transform function with no I/O,
// same reasoning as token-crypto.ts: nothing here stops it running inside
// the worker once Phase C's sequence-step runner needs to resolve a
// template's placeholders too.
import { escapeHtml } from "./sanitize-html";
import { BUSINESS_TIMEZONE } from "../timezone";

/** Data a template's placeholders may reference. Every field is optional
 * because a contact (and its name/email) may not exist for a company-only
 * send. */
export type TemplatePlaceholderData = {
  contact?: { firstName?: string | null; lastName?: string | null; email?: string | null };
  company?: { name?: string | null };
  sender?: { name?: string | null; mailingAddress?: string | null };
  /** The signed, one-click unsubscribe URL for this send's contact — built
   * by send-email.ts at send time (src/lib/comms/unsubscribe-token.ts),
   * since it depends on which contact is receiving the email, not on
   * static template data. */
  unsubscribeLink?: string | null;
};

const PLACEHOLDER_PATTERN = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

function lookupPlaceholder(token: string, data: TemplatePlaceholderData): string | undefined {
  switch (token) {
    case "contact.firstName":
      return data.contact?.firstName ?? undefined;
    case "contact.lastName":
      return data.contact?.lastName ?? undefined;
    case "contact.email":
      return data.contact?.email ?? undefined;
    case "company.name":
      return data.company?.name ?? undefined;
    case "sender.name":
      return data.sender?.name ?? undefined;
    case "sender.mailingAddress":
      return data.sender?.mailingAddress ?? undefined;
    case "unsubscribeLink":
      return data.unsubscribeLink ?? undefined;
    case "today":
      // Resolved fresh here, not passed through TemplatePlaceholderData —
      // unlike every other token, "today" needs no per-send data, only the
      // instant resolution actually happens (matters for a scheduled send,
      // which must show the date it was actually sent, not when it was
      // composed/scheduled). Formatted in the business timezone
      // (src/lib/timezone.ts), not server-local time, so it can't read a
      // day early/late for a server running in a different zone.
      return new Intl.DateTimeFormat("en-US", { timeZone: BUSINESS_TIMEZONE, year: "numeric", month: "long", day: "numeric" }).format(new Date());
    default:
      return undefined;
  }
}

/** Every placeholder token this codebase knows how to resolve — used both to
 * validate a template at save time (an unknown token is always unresolved,
 * so it's flagged there too) and to render a placeholder picker in the
 * template editor. */
export const KNOWN_PLACEHOLDERS = [
  "contact.firstName",
  "contact.lastName",
  "contact.email",
  "company.name",
  "sender.name",
  "sender.mailingAddress",
  "unsubscribeLink",
  "today",
] as const;

/** Every outbound template must include this placeholder (CAN-SPAM requires
 * a working unsubscribe mechanism in every commercial email) — checked at
 * template save time and, as a second gate, at send time itself, since a
 * composer send may not go through a saved template at all. */
export const UNSUBSCRIBE_PLACEHOLDER_TOKEN = "unsubscribeLink";

export function hasUnsubscribePlaceholder(text: string): boolean {
  return extractPlaceholderTokens(text).includes(UNSUBSCRIBE_PLACEHOLDER_TOKEN);
}

/**
 * Replaces every `{{token}}` in `text` using `data`. A token with no value
 * (unknown token, or a known token whose data is missing/blank) is left in
 * place — untouched, not blanked out — and reported in `unresolved`, so a
 * caller can block sending rather than silently deliver a literal
 * `{{contact.firstName}}` to a lead.
 *
 * `context` controls how a *substituted value* is escaped — never how the
 * surrounding `text` itself is treated. `"text"` (the default, used for the
 * subject line, which is always plain text) substitutes the value as-is.
 * `"html"` (used for the body, which is real HTML from the rich-text
 * editor — see src/components/ui/rich-text-editor.tsx) HTML-escapes the
 * value before splicing it in, so a contact/company name containing `<` or
 * `&` can never break the surrounding markup or inject new tags — the
 * template's own HTML markup around the token is left untouched either
 * way, only the token's replacement value is escaped.
 */
export function resolveTemplatePlaceholders(
  text: string,
  data: TemplatePlaceholderData,
  context: "text" | "html" = "text",
): { resolved: string; unresolved: string[] } {
  const unresolved: string[] = [];

  const resolved = text.replace(PLACEHOLDER_PATTERN, (match, token: string) => {
    const value = lookupPlaceholder(token, data);
    if (value === undefined || value === "") {
      if (!unresolved.includes(token)) unresolved.push(token);
      return match;
    }
    return context === "html" ? escapeHtml(value) : value;
  });

  return { resolved, unresolved };
}

/** Every `{{token}}` referenced in `text`, known or not — used at template
 * save time to reject a template that references a token this codebase
 * doesn't know how to resolve, before it ever reaches a real send. */
export function extractPlaceholderTokens(text: string): string[] {
  const tokens: string[] = [];
  for (const match of text.matchAll(PLACEHOLDER_PATTERN)) {
    const token = match[1];
    if (!tokens.includes(token)) tokens.push(token);
  }
  return tokens;
}

/** Unknown-token names referenced by `text` — a template containing one of
 * these can never resolve cleanly and should be rejected at save time. */
export function unknownPlaceholderTokens(text: string): string[] {
  return extractPlaceholderTokens(text).filter((token) => !(KNOWN_PLACEHOLDERS as readonly string[]).includes(token));
}
