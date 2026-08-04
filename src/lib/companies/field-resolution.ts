// Shared Company field-resolution logic. Originally lived only inside
// leads/transfer/actions.ts as a whole-record "replace"/"merge" choice;
// extracted here, unchanged in behavior, so Competition Locator's
// per-field keep-existing/use-new/override review UI (a finer-grained
// choice the whole-record modes can't express) can reuse the same field
// list and existing-company-comparison primitive instead of duplicating it.
//
// Deliberately its own, separate field list from data-quality/
// merge-company.ts's own MERGEABLE_COMPANY_FIELDS (a longer list including
// notes/EOS fields, for the full company-merge review flow) — that module's
// name is reused here as MERGEABLE_TRANSFER_FIELDS specifically to avoid an
// identically-named-but-different export existing in two places.
import type { Company } from "@/generated/prisma/client";

// Deliberately excludes leadTypeId/pipelineStageId/assignedToId/competitorId
// — an existing company already has a real place in the pipeline, and none
// of these resolution modes are a reason to reset that. competitorId in
// particular is handled by its own, separate conflict-gated logic (see
// Competition Locator's save action) — never through this generic path.
export const MERGEABLE_TRANSFER_FIELDS = ["name", "address1", "city", "region", "postalCode", "country", "phone", "email", "websiteUrl"] as const;

export type MergeableTransferField = (typeof MERGEABLE_TRANSFER_FIELDS)[number];

export type ResolvedCompanyFields = {
  name: string;
  address1: string | null;
  city: string;
  region: string;
  postalCode: string | null;
  country: string;
  phone: string | null;
  email: string | null;
  websiteUrl: string | null;
};

/**
 * "replace": every mergeable field takes the fresh value, unconditionally —
 * including nulling out a field the fresh data doesn't have, even if the
 * existing company had a value there.
 * "merge": the fresh (most recent) value wins wherever it has one; a field
 * only falls back to the existing company's value when the fresh data left
 * it blank — so merge can never destroy data the fresh pass didn't cover,
 * but does take the newer value whenever both sides have one.
 * Whole-record modes, used by the AI-research transfer flow's duplicateAction.
 * See resolveFieldDecisions() below for Competition Locator's per-field choice.
 */
export function resolveReplaceOrMergeFields(action: "replace" | "merge", fresh: ResolvedCompanyFields, existing: Company): ResolvedCompanyFields {
  if (action === "replace") return fresh;

  // Loosely typed as a plain string|null record for the loop — name/city/
  // region/country are typed as required `string` on ResolvedCompanyFields,
  // but callers already guarantee those are never blank, so freshIsBlank is
  // never true for them in practice; this cast just lets the one generic
  // loop handle every mergeable field instead of writing it out nine times.
  const resolved = { ...fresh } as Record<MergeableTransferField, string | null>;
  for (const field of MERGEABLE_TRANSFER_FIELDS) {
    const freshValue = fresh[field];
    const freshIsBlank = freshValue === null || freshValue.trim() === "";
    if (freshIsBlank) {
      resolved[field] = (existing[field] as string | null) ?? null;
    }
  }
  return resolved as ResolvedCompanyFields;
}

/** One field's resolution in Competition Locator's side-by-side review UI. */
export type FieldDecision = { mode: "keepExisting" } | { mode: "useNew" } | { mode: "override"; value: string };

/**
 * Per-field keep-existing/use-new/enter-different resolution — the
 * finer-grained choice the whole-record replace/merge modes above can't
 * express (e.g. keep the existing name but take the newly found phone
 * number). A field with no explicit decision defaults to "useNew" — the
 * review UI is expected to pre-select a default per field (see
 * competition-locator-buckets.ts's identical/blank/new/conflicting
 * classification) before the user ever submits, so this default only
 * matters for a field the UI genuinely never rendered a choice for.
 */
export function resolveFieldDecisions(
  decisions: Partial<Record<MergeableTransferField, FieldDecision>>,
  fresh: ResolvedCompanyFields,
  existing: Company,
): ResolvedCompanyFields {
  const resolved = { ...fresh } as Record<MergeableTransferField, string | null>;
  for (const field of MERGEABLE_TRANSFER_FIELDS) {
    const decision = decisions[field];
    if (!decision || decision.mode === "useNew") continue; // fresh[field] is already in resolved
    resolved[field] = decision.mode === "keepExisting" ? ((existing[field] as string | null) ?? null) : decision.value;
  }
  return resolved as ResolvedCompanyFields;
}
