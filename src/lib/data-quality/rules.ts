// Pure rule-evaluation core, shared by the full scan (src/lib/data-quality/
// scan.ts) and the targeted single-rule re-check after a correction
// (Section 10 of the plan — src/app/(dashboard)/data-quality/corrections
// actions). Table-driven: every check reads its behavior from a
// DataQualityRule row, never a hardcoded per-entity check.
import { z } from "zod";
import { isValidEmailFormat, isValidNorthAmericanPhone, isValidUrl } from "./validators";

export const RuleConfigSchemas = {
  REQUIRED_FIELD: z.object({}).strict(),
  INVALID_EMAIL_FORMAT: z.object({}).strict(),
  INVALID_PHONE_FORMAT: z.object({}).strict(),
  INVALID_URL_FORMAT: z.object({}).strict(),
  DUPLICATE_EXACT_MATCH: z.object({}).strict(),
  DUPLICATE_NORMALIZED_MATCH: z.object({}).strict(),
  DUPLICATE_FUZZY_MATCH: z.object({ minSimilarity: z.number().min(0).max(100).default(85) }).strict(),
  STALE_RECORD: z.object({ staleDays: z.number().int().positive().default(180) }).strict(),
  CUSTOM_REVIEW_FLAG: z.object({}).strict(),
} as const;

export type DataQualityRuleTypeKey = keyof typeof RuleConfigSchemas;

export type DuplicateFuzzyConfig = z.infer<typeof RuleConfigSchemas.DUPLICATE_FUZZY_MATCH>;
export type StaleRecordConfig = z.infer<typeof RuleConfigSchemas.STALE_RECORD>;

/**
 * Validates and defaults a rule's `config` JSON against its ruleType's
 * schema — called on every rule create/update, never trusted raw. Throws
 * a ZodError (caller surfaces .issues[0]?.message) on invalid config.
 */
export function parseRuleConfig(ruleType: DataQualityRuleTypeKey, config: unknown): Record<string, unknown> {
  return RuleConfigSchemas[ruleType].parse(config ?? {});
}

// Rule types resolved by the pairwise duplicate-scan phase
// (company-match.ts/contact-match.ts), never by evaluateCompanyRule/
// evaluateContactRule below.
export const DUPLICATE_RULE_TYPES = new Set<DataQualityRuleTypeKey>([
  "DUPLICATE_EXACT_MATCH",
  "DUPLICATE_NORMALIZED_MATCH",
  "DUPLICATE_FUZZY_MATCH",
]);

export type RuleEvaluationResult = { violates: boolean; description?: string };

const COMPANY_TEXT_FIELDS = new Set(["address1", "phone", "email", "websiteUrl", "notes", "city", "region", "postalCode", "name"]);
const CONTACT_TEXT_FIELDS = new Set(["firstName", "lastName", "phone", "email", "title"]);

function fieldLabel(field: string): string {
  return field.replace(/([A-Z])/g, " $1").toLowerCase().replace(/^./, (c) => c.toUpperCase());
}

type CompanyLike = {
  address1?: string | null;
  phone?: string | null;
  email?: string | null;
  websiteUrl?: string | null;
  name?: string | null;
  activities?: { occurredAt: Date }[];
  createdAt: Date;
};

/**
 * Evaluates one non-duplicate rule against one Company row. `field` is
 * allow-listed against COMPANY_TEXT_FIELDS — an unrecognized field name
 * (e.g. a rule saved before a field was removed) is treated as "no
 * violation" rather than an unsafe dynamic property access.
 */
export function evaluateCompanyRule(
  rule: { ruleType: DataQualityRuleTypeKey; field: string; config: unknown },
  company: CompanyLike,
): RuleEvaluationResult {
  if (DUPLICATE_RULE_TYPES.has(rule.ruleType) || rule.ruleType === "CUSTOM_REVIEW_FLAG") {
    return { violates: false };
  }

  // STALE_RECORD doesn't read `field` as a Company column at all (its
  // config carries the threshold, not a field reference) — evaluated
  // before the field-allowlist gate below, which only applies to
  // column-reading rule types.
  if (rule.ruleType === "STALE_RECORD") {
    const config = RuleConfigSchemas.STALE_RECORD.parse(rule.config ?? {});
    const lastActivity = company.activities?.[0]?.occurredAt ?? company.createdAt;
    const daysSince = (Date.now() - lastActivity.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince >= config.staleDays) {
      return { violates: true, description: `No activity in ${Math.floor(daysSince)} days (threshold: ${config.staleDays}).` };
    }
    return { violates: false };
  }

  if (!COMPANY_TEXT_FIELDS.has(rule.field)) return { violates: false };

  const value = (company as Record<string, unknown>)[rule.field] as string | null | undefined;

  if (rule.ruleType === "REQUIRED_FIELD") {
    if (!value || !value.trim()) {
      return { violates: true, description: `${fieldLabel(rule.field)} is missing.` };
    }
    return { violates: false };
  }

  if (!value || !value.trim()) return { violates: false }; // format rules don't fire on an absent value — that's REQUIRED_FIELD's job

  if (rule.ruleType === "INVALID_EMAIL_FORMAT") {
    const result = isValidEmailFormat(value);
    return { violates: !result.valid, description: result.reason };
  }
  if (rule.ruleType === "INVALID_PHONE_FORMAT") {
    const result = isValidNorthAmericanPhone(value);
    return { violates: !result.valid, description: result.reason };
  }
  if (rule.ruleType === "INVALID_URL_FORMAT") {
    const result = isValidUrl(value);
    return { violates: !result.valid, description: result.reason };
  }

  return { violates: false };
}

type ContactLike = {
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  email?: string | null;
  title?: string | null;
  createdAt: Date;
};

export function evaluateContactRule(
  rule: { ruleType: DataQualityRuleTypeKey; field: string; config: unknown },
  contact: ContactLike,
): RuleEvaluationResult {
  if (DUPLICATE_RULE_TYPES.has(rule.ruleType) || rule.ruleType === "CUSTOM_REVIEW_FLAG" || rule.ruleType === "STALE_RECORD") {
    // STALE_RECORD has no meaningful "last activity" signal on Contact
    // (Activity is company-scoped only — see the plan's Conflict #1); this
    // rule type is COMPANY-only in practice, enforced at rule-save time by
    // entityType, not re-derived here.
    return { violates: false };
  }
  if (!CONTACT_TEXT_FIELDS.has(rule.field)) return { violates: false };

  const value = (contact as Record<string, unknown>)[rule.field] as string | null | undefined;

  if (rule.ruleType === "REQUIRED_FIELD") {
    if (!value || !value.trim()) {
      return { violates: true, description: `${fieldLabel(rule.field)} is missing.` };
    }
    return { violates: false };
  }

  if (!value || !value.trim()) return { violates: false };

  if (rule.ruleType === "INVALID_EMAIL_FORMAT") {
    const result = isValidEmailFormat(value);
    return { violates: !result.valid, description: result.reason };
  }
  if (rule.ruleType === "INVALID_PHONE_FORMAT") {
    const result = isValidNorthAmericanPhone(value);
    return { violates: !result.valid, description: result.reason };
  }

  return { violates: false };
}
