"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { requireUser, type AuthenticatedUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { checkRateLimit } from "@/lib/rate-limit/postgres-bucket";
import { getEnrichmentProvider } from "@/lib/enrichment/providers/factory";
import { computeNormalizedFields } from "@/lib/duplicates/match";
import { computeAddressNormalizedFields, computeContactNormalizedFields } from "@/lib/data-quality/normalize";

export type EnrichmentActionResult = { error?: string } | undefined;

const PATH = "/data-quality/enrichment";

// Consent/suppression fields are deliberately never enrichment-eligible —
// Module Six's consent state is only ever changed through
// src/lib/comms/consent.ts's recordConsent(), never by an enrichment
// suggestion, "respecting Module 6 consent/suppression data" per the plan.
const COMPANY_ENRICHABLE_FIELDS = ["name", "address1", "city", "region", "postalCode", "country", "phone", "email", "websiteUrl"] as const;
const CONTACT_ENRICHABLE_FIELDS = ["firstName", "lastName", "title", "phone", "email"] as const;

async function requireEnrichmentReviewer(): Promise<AuthenticatedUser> {
  const user = await requireUser();
  requirePermission(user, "review_enrichment");
  return user;
}

export async function requestEnrichmentSuggestions(entityType: "COMPANY" | "CONTACT", recordId: string): Promise<EnrichmentActionResult> {
  const user = await requireEnrichmentReviewer();

  const rateLimit = await checkRateLimit(`enrichment-request:${user.id}`, { windowMs: 60_000, limit: 10 });
  if (!rateLimit.allowed) return { error: "Too many enrichment requests — please wait a moment and try again." };

  const fields = entityType === "COMPANY" ? COMPANY_ENRICHABLE_FIELDS : CONTACT_ENRICHABLE_FIELDS;
  const currentValues: Record<string, string | null> =
    entityType === "COMPANY"
      ? await prisma.company.findUniqueOrThrow({ where: { id: recordId }, select: Object.fromEntries(fields.map((f) => [f, true])) as never })
      : await prisma.contact.findUniqueOrThrow({ where: { id: recordId }, select: Object.fromEntries(fields.map((f) => [f, true])) as never });

  const requestId = randomUUID();
  const provider = getEnrichmentProvider();
  const suggestions = await provider.suggest({ entityType, recordId, currentValues, fields: [...fields], requestId });

  await prisma.$transaction(
    suggestions.map((suggestion) =>
      prisma.enrichmentRecord.create({
        data: {
          entityType,
          companyId: entityType === "COMPANY" ? recordId : null,
          contactId: entityType === "CONTACT" ? recordId : null,
          field: suggestion.field,
          previousValue: currentValues[suggestion.field] ?? null,
          suggestedValue: suggestion.suggestedValue,
          provider: provider.name,
          sourceUrl: suggestion.sourceUrl ?? null,
          evidence: suggestion.evidence,
          confidence: suggestion.confidence,
          requestId,
          estimatedCostUsd: suggestion.estimatedCostUsd,
        },
      }),
    ),
  );

  await prisma.dataQualityAuditEvent.create({
    data: { action: "ENRICHMENT_SUGGESTED", actorId: user.id, companyId: entityType === "COMPANY" ? recordId : null, contactId: entityType === "CONTACT" ? recordId : null, metadata: { requestId, fieldCount: suggestions.length } as never },
  });

  revalidatePath(PATH);
  return undefined;
}

export async function acceptEnrichmentSuggestion(id: string): Promise<EnrichmentActionResult> {
  const user = await requireEnrichmentReviewer();

  const suggestion = await prisma.enrichmentRecord.findUnique({ where: { id } });
  if (!suggestion) return { error: "Suggestion not found." };
  if (suggestion.decision !== "PENDING") return { error: "This suggestion has already been decided." };

  if (suggestion.entityType === "COMPANY" && suggestion.companyId) {
    const company = await prisma.company.findUniqueOrThrow({ where: { id: suggestion.companyId } });
    const updateData: Record<string, unknown> = { [suggestion.field]: suggestion.suggestedValue, updatedById: user.id };
    if (["name", "phone", "email", "websiteUrl"].includes(suggestion.field)) {
      Object.assign(updateData, computeNormalizedFields({ ...company, [suggestion.field]: suggestion.suggestedValue }));
    }
    if (["city", "region", "postalCode", "country"].includes(suggestion.field)) {
      Object.assign(updateData, computeAddressNormalizedFields({ ...company, [suggestion.field]: suggestion.suggestedValue }));
    }
    await prisma.company.update({ where: { id: suggestion.companyId }, data: updateData });
  } else if (suggestion.entityType === "CONTACT" && suggestion.contactId) {
    const contact = await prisma.contact.findUniqueOrThrow({ where: { id: suggestion.contactId } });
    const updateData: Record<string, unknown> = { [suggestion.field]: suggestion.suggestedValue };
    if (["firstName", "lastName", "phone", "email"].includes(suggestion.field)) {
      Object.assign(updateData, computeContactNormalizedFields({ ...contact, [suggestion.field]: suggestion.suggestedValue }));
    }
    await prisma.contact.update({ where: { id: suggestion.contactId }, data: updateData });
  } else {
    return { error: "This suggestion has no linked record." };
  }

  await prisma.enrichmentRecord.update({ where: { id }, data: { decision: "ACCEPTED", decidedAt: new Date(), decidedById: user.id } });
  await prisma.dataQualityAuditEvent.create({
    data: { action: "ENRICHMENT_ACCEPTED", actorId: user.id, enrichmentRecordId: id, companyId: suggestion.companyId, contactId: suggestion.contactId, beforeData: { value: suggestion.previousValue } as never, afterData: { value: suggestion.suggestedValue } as never },
  });

  revalidatePath(PATH);
  return undefined;
}

export async function rejectEnrichmentSuggestion(id: string): Promise<EnrichmentActionResult> {
  const user = await requireEnrichmentReviewer();

  const suggestion = await prisma.enrichmentRecord.findUnique({ where: { id } });
  if (!suggestion) return { error: "Suggestion not found." };
  if (suggestion.decision !== "PENDING") return { error: "This suggestion has already been decided." };

  // Kept, not deleted — rejected suggestions are retained for audit
  // (Section 9's explicit requirement).
  await prisma.enrichmentRecord.update({ where: { id }, data: { decision: "REJECTED", decidedAt: new Date(), decidedById: user.id } });
  await prisma.dataQualityAuditEvent.create({ data: { action: "ENRICHMENT_REJECTED", actorId: user.id, enrichmentRecordId: id, companyId: suggestion.companyId, contactId: suggestion.contactId } });

  revalidatePath(PATH);
  return undefined;
}
