// Centralized badge color-coding — replaces 3 inconsistent per-file
// implementations (inline nested ternaries, a lookup object, and a
// copy-pasted single-condition ternary duplicated in 5+ files) and fills
// real gaps where nothing was color-coded at all before this: opportunity
// grade, confidence level, search-result disposition, and search job
// status all previously rendered as plain, uncolored text.

export type BadgeTone = "neutral" | "primary" | "secondary" | "accent" | "focus" | "success" | "warning" | "danger";

// success/warning use Tailwind's stock emerald/amber (universal semantic
// colors, not brand-identity ones — see BRAND_GUIDE.md). danger uses Mayhem
// Red-Dark via the --color-danger alias, never the brand's primary Mayhem
// Red, so a danger badge is never visually confusable with a primary CTA.
export const BADGE_TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: "bg-black/5 text-text-muted",
  primary: "bg-primary/10 text-primary",
  secondary: "bg-secondary/10 text-secondary",
  accent: "bg-accent/10 text-accent",
  focus: "bg-focus/10 text-focus",
  success: "bg-emerald-50 text-emerald-700",
  warning: "bg-amber-50 text-amber-700",
  danger: "bg-danger/10 text-danger",
};

/** Safe lookup with a guaranteed fallback — mirrors the one existing
 * lookup-object pattern in the codebase worth keeping (evidence-panel.tsx's
 * VERIFICATION_TONE), generalized for reuse. */
export function toneFor<T extends string>(map: Record<T, BadgeTone>, key: T | null | undefined, fallback: BadgeTone = "neutral"): BadgeTone {
  if (!key) return fallback;
  return map[key] ?? fallback;
}

export const ACTIVE_TONE: Record<"active" | "inactive", BadgeTone> = {
  active: "success",
  inactive: "neutral",
};

/** A→D never had a color scale at all before — every grade rendered
 * identical plain emerald regardless of value. Deep Navy/Mayhem Blue read
 * as "top-tier," fading through amber to Mayhem Red-Dark for the weakest
 * grade, so the color itself communicates quality at a glance. */
export const GRADE_TONE: Record<string, BadgeTone> = {
  A_PLUS: "accent",
  A: "accent",
  B: "secondary",
  C: "warning",
  D: "danger",
};
export const GRADE_LABEL: Record<string, string> = {
  A_PLUS: "A+",
  A: "A",
  B: "B",
  C: "C",
  D: "D",
};

export const CONFIDENCE_TONE: Record<string, BadgeTone> = {
  HIGH: "success",
  MEDIUM: "warning",
  LOW: "neutral",
};
export const CONFIDENCE_LABEL: Record<string, string> = {
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
};

export const TRIVIA_STATUS_TONE: Record<string, BadgeTone> = {
  CURRENT_TRIVIA: "warning",
  NO_CURRENT_TRIVIA: "success",
  UNCERTAIN: "neutral",
};
export const TRIVIA_STATUS_LABEL: Record<string, string> = {
  CURRENT_TRIVIA: "Current Trivia",
  NO_CURRENT_TRIVIA: "No Current Trivia",
  UNCERTAIN: "Uncertain",
};

export const DISPOSITION_TONE: Record<string, BadgeTone> = {
  NEW: "secondary",
  REVIEWED: "neutral",
  TRANSFERRED: "success",
  REJECTED: "danger",
  BELOW_SCORE: "warning",
  DUPLICATE: "neutral",
};
export const DISPOSITION_LABEL: Record<string, string> = {
  NEW: "New",
  REVIEWED: "Reviewed",
  TRANSFERRED: "Transferred",
  REJECTED: "Rejected",
  BELOW_SCORE: "Below Score",
  DUPLICATE: "Duplicate",
};

export const PROVIDER_CONNECTION_STATUS_TONE: Record<string, BadgeTone> = {
  CONNECTED: "success",
  EXPIRED: "warning",
  REVOKED: "neutral",
  ERROR: "danger",
};

export const SEARCH_STATUS_TONE: Record<string, BadgeTone> = {
  PENDING: "neutral",
  RUNNING: "focus",
  SUCCEEDED: "success",
  FAILED: "danger",
  CANCELLED: "neutral",
};
export const SEARCH_STATUS_LABEL: Record<string, string> = {
  PENDING: "Pending",
  RUNNING: "Running",
  SUCCEEDED: "Succeeded",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

export const VERIFICATION_TONE: Record<string, BadgeTone> = {
  VERIFIED: "success",
  INFERRED: "secondary",
  UNVERIFIED: "neutral",
  OUTDATED: "warning",
  CONTRADICTORY: "danger",
};

export const CLASSIFICATION_TONE: Record<string, BadgeTone> = {
  ENTERTAINMENT_READY: "success",
  GREENFIELD: "secondary",
  REPLACEMENT: "focus",
  NEEDS_QUALIFICATION: "warning",
  EXISTING_CUSTOMER: "accent",
};

// Module Seven: Data Quality, Duplicate Management, Record Merging, and
// Enrichment History. DUPLICATE_CONFIDENCE_TONE reuses the existing
// ConfidenceLevel enum's tone mapping (CONFIDENCE_TONE above) directly —
// PotentialDuplicate.confidence is that same enum, no separate map needed.
export const DATA_QUALITY_ISSUE_STATUS_TONE: Record<string, BadgeTone> = {
  OPEN: "warning",
  DEFERRED: "neutral",
  RESOLVED: "success",
  IGNORED: "neutral",
  REOPENED: "danger",
};

export const DUPLICATE_REVIEW_STATUS_TONE: Record<string, BadgeTone> = {
  PENDING: "warning",
  NOT_DUPLICATE: "neutral",
  CONFIRMED: "focus",
  DEFERRED: "neutral",
  MERGED: "success",
};

export const DATA_QUALITY_SEVERITY_TONE: Record<string, BadgeTone> = {
  LOW: "neutral",
  MEDIUM: "warning",
  HIGH: "danger",
  CRITICAL: "danger",
};

export const ENRICHMENT_DECISION_TONE: Record<string, BadgeTone> = {
  PENDING: "warning",
  ACCEPTED: "success",
  REJECTED: "neutral",
};

/** Fallback for any enum without a dedicated label map above: title-cases
 * "SOME_VALUE" -> "Some Value", replacing the app's previous convention of
 * leaving values SHOUTING ("CURRENT TRIVIA") after a bare underscore swap. */
export function humanizeEnum(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
