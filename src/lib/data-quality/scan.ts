// The data-quality scan's core logic — deliberately mirrors
// src/lib/research/run-search.ts's shape: re-fetch the job row, never throw
// internally (persist FAILED/errorMessage on the row itself instead), poll
// a cooperative isCancelled() between batches. The per-record issue-
// evaluation phase is cursor-paginated and restart-safe (a crash resumes
// from DataQualityScan.lastProcessedCompanyId/ContactId rather than
// restarting). The duplicate-detection phase re-scans fully on every run —
// safe because every PotentialDuplicate/DataQualityIssue write is an
// idempotent upsert, not because of a cursor — documented here rather than
// overclaiming a resumable design that phase doesn't actually have.
//
// Deliberately no `import "server-only"` — worker/handlers/data-quality-scan.ts
// (running under plain tsx, not Next's "react-server" bundler condition)
// needs runDataQualityScan too, and that guard throws under plain Node/tsx
// execution. Same reasoning as src/lib/prisma.ts and src/lib/research/
// run-search.ts's identical omission.
import { prisma } from "../prisma";
import { Prisma } from "../../generated/prisma/client";
import { logger } from "../logger";
import { computeAddressNormalizedFields, computeContactNormalizedFields } from "./normalize";
import { evaluateCompanyRule, evaluateContactRule, DUPLICATE_RULE_TYPES, RuleConfigSchemas, type DataQualityRuleTypeKey } from "./rules";
import { scoreCompanyMatch, type CompanyMatchInput } from "./company-match";
import { scoreContactMatch, type ContactMatchInput } from "./contact-match";

const BATCH_SIZE = 200;

export type ScanOptions = {
  isCancelled?: () => Promise<boolean>;
};

async function upsertIssue(params: {
  entityType: "COMPANY" | "CONTACT";
  companyId?: string;
  contactId?: string;
  ruleId: string;
  field: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  violates: boolean;
  description?: string;
}): Promise<{ created: boolean }> {
  const where = params.companyId ? { companyId_ruleId: { companyId: params.companyId, ruleId: params.ruleId } } : { contactId_ruleId: { contactId: params.contactId!, ruleId: params.ruleId } };

  const existing = await prisma.dataQualityIssue.findUnique({ where });

  if (!params.violates) {
    if (existing && (existing.status === "OPEN" || existing.status === "DEFERRED" || existing.status === "REOPENED")) {
      await prisma.dataQualityIssue.update({
        where: { id: existing.id },
        data: { status: "RESOLVED", resolvedAt: new Date(), resolvedById: null, resolutionAction: "auto: rule no longer applies" },
      });
    }
    return { created: false };
  }

  if (!existing) {
    await prisma.dataQualityIssue.create({
      data: {
        entityType: params.entityType,
        companyId: params.companyId ?? null,
        contactId: params.contactId ?? null,
        ruleId: params.ruleId,
        field: params.field,
        severity: params.severity,
        description: params.description ?? "Data quality rule violation.",
      },
    });
    return { created: true };
  }

  if (existing.status === "RESOLVED" || existing.status === "IGNORED") {
    await prisma.dataQualityIssue.update({
      where: { id: existing.id },
      data: { status: "REOPENED", severity: params.severity, description: params.description ?? existing.description, detectedAt: new Date() },
    });
  } else {
    await prisma.dataQualityIssue.update({
      where: { id: existing.id },
      data: { severity: params.severity, description: params.description ?? existing.description },
    });
  }
  return { created: false };
}

async function runCompanyIssueScan(scan: { id: string; lastProcessedCompanyId: string | null }, rules: CompanyRuleRow[], options: ScanOptions): Promise<{ scanned: number; found: number }> {
  let cursor = scan.lastProcessedCompanyId ?? undefined;
  let scanned = 0;
  let found = 0;

  for (;;) {
    if (options.isCancelled && (await options.isCancelled())) break;

    const batch = await prisma.company.findMany({
      where: { status: "ACTIVE", ...(cursor ? { id: { gt: cursor } } : {}) },
      orderBy: { id: "asc" },
      take: BATCH_SIZE,
      select: {
        id: true,
        name: true,
        address1: true,
        phone: true,
        email: true,
        websiteUrl: true,
        city: true,
        region: true,
        country: true,
        postalCode: true,
        normalizedCity: true,
        normalizedRegion: true,
        normalizedPostalCode: true,
        createdAt: true,
        activities: { orderBy: { occurredAt: "desc" }, take: 1, select: { occurredAt: true } },
      },
    });

    if (batch.length === 0) break;

    for (const company of batch) {
      // Self-heal address normalization for a pre-existing row that
      // predates this module — "populated going forward" precedent
      // (PipelineStageHistory), applied here as "repaired on first scan."
      if (!company.normalizedCity && !company.normalizedRegion && !company.normalizedPostalCode) {
        const computed = computeAddressNormalizedFields(company);
        if (computed.normalizedCity || computed.normalizedRegion || computed.normalizedPostalCode) {
          await prisma.company.update({ where: { id: company.id }, data: computed });
        }
      }

      for (const rule of rules) {
        const result = evaluateCompanyRule(rule, company);
        const outcome = await upsertIssue({
          entityType: "COMPANY",
          companyId: company.id,
          ruleId: rule.id,
          field: rule.field,
          severity: rule.severity,
          violates: result.violates,
          description: result.description,
        });
        if (outcome.created) found += 1;
      }
    }

    scanned += batch.length;
    cursor = batch[batch.length - 1].id;
    await prisma.dataQualityScan.update({ where: { id: scan.id }, data: { lastProcessedCompanyId: cursor, recordsScanned: { increment: batch.length }, heartbeatAt: new Date() } });

    if (batch.length < BATCH_SIZE) break;
  }

  return { scanned, found };
}

async function runContactIssueScan(scan: { id: string; lastProcessedContactId: string | null }, rules: ContactRuleRow[], options: ScanOptions): Promise<{ scanned: number; found: number }> {
  let cursor = scan.lastProcessedContactId ?? undefined;
  let scanned = 0;
  let found = 0;

  for (;;) {
    if (options.isCancelled && (await options.isCancelled())) break;

    const batch = await prisma.contact.findMany({
      where: { status: "ACTIVE", ...(cursor ? { id: { gt: cursor } } : {}) },
      orderBy: { id: "asc" },
      take: BATCH_SIZE,
      select: { id: true, firstName: true, lastName: true, phone: true, email: true, title: true, createdAt: true, normalizedFirstName: true, normalizedLastName: true, normalizedPhone: true, normalizedEmail: true },
    });

    if (batch.length === 0) break;

    for (const contact of batch) {
      if (!contact.normalizedFirstName && !contact.normalizedLastName) {
        const computed = computeContactNormalizedFields(contact);
        await prisma.contact.update({ where: { id: contact.id }, data: computed });
      }

      for (const rule of rules) {
        const result = evaluateContactRule(rule, contact);
        const outcome = await upsertIssue({
          entityType: "CONTACT",
          contactId: contact.id,
          ruleId: rule.id,
          field: rule.field,
          severity: rule.severity,
          violates: result.violates,
          description: result.description,
        });
        if (outcome.created) found += 1;
      }
    }

    scanned += batch.length;
    cursor = batch[batch.length - 1].id;
    await prisma.dataQualityScan.update({ where: { id: scan.id }, data: { lastProcessedContactId: cursor, recordsScanned: { increment: batch.length }, heartbeatAt: new Date() } });

    if (batch.length < BATCH_SIZE) break;
  }

  return { scanned, found };
}

function pairKey(idA: string, idB: string): [string, string] {
  return idA < idB ? [idA, idB] : [idB, idA];
}

async function upsertPotentialDuplicate(params: {
  entityType: "COMPANY" | "CONTACT";
  aId: string;
  bId: string;
  result: { score: number; confidence: "HIGH" | "MEDIUM" | "LOW"; reasons: string[]; matchedFields: string[]; conflictingFields: string[] };
  currentSnapshot: Record<string, string | null>;
}): Promise<{ created: boolean; reconsidered: boolean }> {
  const [aId, bId] = pairKey(params.aId, params.bId);
  const idField = params.entityType === "COMPANY" ? { companyAId_companyBId: { companyAId: aId, companyBId: bId } } : { contactAId_contactBId: { contactAId: aId, contactBId: bId } };

  const existing = await prisma.potentialDuplicate.findUnique({ where: idField as never });

  if (!existing) {
    await prisma.potentialDuplicate.create({
      data: {
        entityType: params.entityType,
        ...(params.entityType === "COMPANY" ? { companyAId: aId, companyBId: bId } : { contactAId: aId, contactBId: bId }),
        score: params.result.score,
        confidence: params.result.confidence,
        reasons: params.result.reasons,
        matchedFields: params.result.matchedFields,
        conflictingFields: params.result.conflictingFields,
      },
    });
    return { created: true, reconsidered: false };
  }

  if (existing.status === "MERGED") return { created: false, reconsidered: false };

  if (existing.status === "NOT_DUPLICATE") {
    const snapshot = (existing.dismissedFieldsSnapshot as Record<string, string | null> | null) ?? {};
    const changed = Object.entries(params.currentSnapshot).some(([field, value]) => snapshot[field] !== undefined && snapshot[field] !== value);
    if (changed) {
      await prisma.potentialDuplicate.update({
        where: { id: existing.id },
        data: {
          status: "PENDING",
          score: params.result.score,
          confidence: params.result.confidence,
          reasons: [...params.result.reasons, "Reconsidered: a previously-matched field has since changed."],
          matchedFields: params.result.matchedFields,
          conflictingFields: params.result.conflictingFields,
          lastSeenAt: new Date(),
          dismissedFieldsSnapshot: Prisma.DbNull,
        },
      });
      return { created: false, reconsidered: true };
    }
    await prisma.potentialDuplicate.update({ where: { id: existing.id }, data: { lastSeenAt: new Date() } });
    return { created: false, reconsidered: false };
  }

  await prisma.potentialDuplicate.update({
    where: { id: existing.id },
    data: {
      score: params.result.score,
      confidence: params.result.confidence,
      reasons: params.result.reasons,
      matchedFields: params.result.matchedFields,
      conflictingFields: params.result.conflictingFields,
      lastSeenAt: new Date(),
    },
  });
  return { created: false, reconsidered: false };
}

async function runCompanyDuplicateScan(rules: CompanyRuleRow[]): Promise<number> {
  const exactEnabled = rules.some((r) => r.ruleType === "DUPLICATE_EXACT_MATCH");
  const normalizedEnabled = rules.some((r) => r.ruleType === "DUPLICATE_NORMALIZED_MATCH");
  const fuzzyRule = rules.find((r) => r.ruleType === "DUPLICATE_FUZZY_MATCH");
  if (!exactEnabled && !normalizedEnabled && !fuzzyRule) return 0;

  const companies = await prisma.company.findMany({
    where: { status: "ACTIVE" },
    select: {
      id: true,
      name: true,
      normalizedName: true,
      address1: true,
      city: true,
      region: true,
      country: true,
      postalCode: true,
      normalizedRegion: true,
      normalizedCity: true,
      normalizedPostalCode: true,
      phone: true,
      normalizedPhone: true,
      email: true,
      normalizedEmail: true,
      websiteUrl: true,
      websiteDomain: true,
    },
  });

  const pairs = new Set<string>();
  const addPair = (a: string, b: string) => {
    if (a === b) return;
    const [x, y] = pairKey(a, b);
    pairs.add(`${x}:${y}`);
  };

  function groupAndPair(keyOf: (c: (typeof companies)[number]) => string | null) {
    const groups = new Map<string, string[]>();
    for (const c of companies) {
      const key = keyOf(c);
      if (!key) continue;
      const list = groups.get(key) ?? [];
      list.push(c.id);
      groups.set(key, list);
    }
    for (const ids of groups.values()) {
      if (ids.length < 2) continue;
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) addPair(ids[i], ids[j]);
      }
    }
  }

  if (exactEnabled) {
    groupAndPair((c) => c.normalizedEmail);
    groupAndPair((c) => c.normalizedPhone);
    groupAndPair((c) => c.websiteDomain);
  }
  if (normalizedEnabled) {
    groupAndPair((c) => c.normalizedName);
  }
  if (fuzzyRule) {
    // Blocked by city+region for tractability — an unbounded pairwise
    // comparison across the whole table doesn't scale; two companies with
    // similar names in different cities simply aren't compared. Documented
    // scope decision, not an oversight.
    groupAndPair((c) => (c.normalizedCity && c.normalizedRegion ? `${c.normalizedCity}|${c.normalizedRegion}` : null));
  }

  const byId = new Map(companies.map((c) => [c.id, c as CompanyMatchInput]));
  const minFuzzySimilarity = fuzzyRule ? RuleConfigSchemas.DUPLICATE_FUZZY_MATCH.parse(fuzzyRule.config ?? {}).minSimilarity : 100;

  let duplicatesFound = 0;
  for (const key of pairs) {
    const [aId, bId] = key.split(":");
    const a = byId.get(aId);
    const b = byId.get(bId);
    if (!a || !b) continue;

    const result = scoreCompanyMatch(a, b, minFuzzySimilarity);
    if (result.score === 0) continue;

    const outcome = await upsertPotentialDuplicate({
      entityType: "COMPANY",
      aId,
      bId,
      result,
      currentSnapshot: { name: a.normalizedName === b.normalizedName ? a.normalizedName : null, email: a.normalizedEmail, phone: a.normalizedPhone, websiteDomain: a.websiteDomain },
    });
    if (outcome.created || outcome.reconsidered) duplicatesFound += 1;
  }

  return duplicatesFound;
}

async function runContactDuplicateScan(rules: ContactRuleRow[]): Promise<number> {
  const exactEnabled = rules.some((r) => r.ruleType === "DUPLICATE_EXACT_MATCH");
  const normalizedEnabled = rules.some((r) => r.ruleType === "DUPLICATE_NORMALIZED_MATCH");
  const fuzzyRule = rules.find((r) => r.ruleType === "DUPLICATE_FUZZY_MATCH");
  if (!exactEnabled && !normalizedEnabled && !fuzzyRule) return 0;

  const contacts = await prisma.contact.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, companyId: true, firstName: true, lastName: true, normalizedFirstName: true, normalizedLastName: true, phone: true, normalizedPhone: true, email: true, normalizedEmail: true },
  });

  const pairs = new Set<string>();
  const addPair = (a: string, b: string) => {
    if (a === b) return;
    const [x, y] = pairKey(a, b);
    pairs.add(`${x}:${y}`);
  };

  function groupAndPair(keyOf: (c: (typeof contacts)[number]) => string | null) {
    const groups = new Map<string, string[]>();
    for (const c of contacts) {
      const key = keyOf(c);
      if (!key) continue;
      const list = groups.get(key) ?? [];
      list.push(c.id);
      groups.set(key, list);
    }
    for (const ids of groups.values()) {
      if (ids.length < 2) continue;
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) addPair(ids[i], ids[j]);
      }
    }
  }

  if (exactEnabled) groupAndPair((c) => c.normalizedEmail);
  if (normalizedEnabled) groupAndPair((c) => (c.normalizedFirstName && c.normalizedLastName ? `${c.normalizedFirstName}|${c.normalizedLastName}` : null));
  // Fuzzy contact matching is blocked by companyId (see company-match's
  // equivalent city/region blocking) — same-company corroboration, not an
  // unbounded whole-table comparison.
  if (fuzzyRule) groupAndPair((c) => c.companyId);

  const byId = new Map(contacts.map((c) => [c.id, c as ContactMatchInput]));
  const minFuzzySimilarity = fuzzyRule ? RuleConfigSchemas.DUPLICATE_FUZZY_MATCH.parse(fuzzyRule.config ?? {}).minSimilarity : 100;

  let duplicatesFound = 0;
  for (const key of pairs) {
    const [aId, bId] = key.split(":");
    const a = byId.get(aId);
    const b = byId.get(bId);
    if (!a || !b) continue;

    const result = scoreContactMatch(a, b, minFuzzySimilarity);
    if (result.score === 0) continue;

    const outcome = await upsertPotentialDuplicate({
      entityType: "CONTACT",
      aId,
      bId,
      result,
      currentSnapshot: { email: a.normalizedEmail, phone: a.normalizedPhone, name: `${a.normalizedFirstName ?? ""} ${a.normalizedLastName ?? ""}` },
    });
    if (outcome.created || outcome.reconsidered) duplicatesFound += 1;
  }

  return duplicatesFound;
}

type CompanyRuleRow = { id: string; ruleType: DataQualityRuleTypeKey; field: string; severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"; config: unknown };
type ContactRuleRow = CompanyRuleRow;

export async function runDataQualityScan(scanId: string, options: ScanOptions = {}): Promise<void> {
  const scan = await prisma.dataQualityScan.findUniqueOrThrow({ where: { id: scanId } });
  if (scan.status === "CANCELLED") return;

  try {
    await prisma.dataQualityScan.update({ where: { id: scanId }, data: { status: "RUNNING", startedAt: scan.startedAt ?? new Date(), heartbeatAt: new Date() } });

    const allRules = await prisma.dataQualityRule.findMany({ where: { enabled: true, archivedAt: null } });
    const companyRules = allRules.filter((r) => r.entityType === "COMPANY") as CompanyRuleRow[];
    const contactRules = allRules.filter((r) => r.entityType === "CONTACT") as ContactRuleRow[];
    const companyIssueRules = companyRules.filter((r) => !DUPLICATE_RULE_TYPES.has(r.ruleType) && r.ruleType !== "CUSTOM_REVIEW_FLAG");
    const contactIssueRules = contactRules.filter((r) => !DUPLICATE_RULE_TYPES.has(r.ruleType) && r.ruleType !== "CUSTOM_REVIEW_FLAG");

    let issuesFound = 0;

    if (!scan.entityType || scan.entityType === "COMPANY") {
      const result = await runCompanyIssueScan(scan, companyIssueRules, options);
      issuesFound += result.found;
    }
    if (options.isCancelled && (await options.isCancelled())) {
      await prisma.dataQualityScan.update({ where: { id: scanId }, data: { status: "CANCELLED", completedAt: new Date() } });
      return;
    }
    if (!scan.entityType || scan.entityType === "CONTACT") {
      const result = await runContactIssueScan(scan, contactIssueRules, options);
      issuesFound += result.found;
    }
    if (options.isCancelled && (await options.isCancelled())) {
      await prisma.dataQualityScan.update({ where: { id: scanId }, data: { status: "CANCELLED", completedAt: new Date() } });
      return;
    }

    let duplicatesFound = 0;
    if (!scan.entityType || scan.entityType === "COMPANY") {
      duplicatesFound += await runCompanyDuplicateScan(companyRules);
    }
    if (!scan.entityType || scan.entityType === "CONTACT") {
      duplicatesFound += await runContactDuplicateScan(contactRules);
    }

    await prisma.dataQualityScan.update({
      where: { id: scanId },
      data: { status: "SUCCEEDED", completedAt: new Date(), heartbeatAt: new Date(), issuesFound: { increment: issuesFound }, duplicatesFound },
    });
  } catch (error) {
    logger.error({ err: error, scanId }, "data-quality scan failed");
    await prisma.dataQualityScan.update({
      where: { id: scanId },
      data: { status: "FAILED", completedAt: new Date(), heartbeatAt: new Date(), errorMessage: error instanceof Error ? error.message : "Unknown error running the scan." },
    });
  }
}
