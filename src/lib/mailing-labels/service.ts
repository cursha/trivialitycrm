// Mailing labels: turning a user's draft into the exact recipients, sheet
// and layout, generating immutable batches, and checking access to them.
// Every count, preview, PDF and reprint goes through companyScope(), so a
// user only ever sees companies they're allowed to see.
import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { AuthenticatedUser } from "@/lib/auth/current-user";
import { companyScope } from "@/lib/companies/scope";
import { countrySpellings } from "@/lib/constants/countries";
import type { Prisma } from "@/generated/prisma/client";
import { checkAddress, labelLines, tidy, type LabelLine } from "./address";
import { chooseAttention, compareCompanies, contactDisplayName, contactUsable, MANAGER } from "./contact";
import { capacity, pageCount, unusedOnLastPage, validateGeometry, validStartPosition, offsetKeepsLabelsOnPage, type SheetGeometry } from "./geometry";
import { fontMetrics, layoutLabels, type Layout } from "./render";
import { EMPTY_FILTERS, filtersAreEmpty, parseStoredFilters, parseStoredOverrides, type LabelFilters } from "@/lib/validation/mailing-labels";

/** Hard ceiling on companies one filter may pull back for review, whatever
 * the batch limit, so an unfiltered query on a huge CRM stays bounded. */
const MAX_MATCHED = 10_000;

export async function getLabelSettings() {
  return prisma.mailingLabelSettings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
}

/** The CRM's own country, for telling domestic from international mail. */
export async function getSenderCountry(): Promise<string | null> {
  const settings = await prisma.organizationSettings.findUnique({ where: { id: 1 }, select: { defaultCountry: true } });
  return tidy(settings?.defaultCountry);
}

/** Companies matching the filters within what this user may see. */
export function filterWhere(user: AuthenticatedUser, filters: LabelFilters): Prisma.CompanyWhereInput | null {
  const scope = companyScope(user);
  if (!scope) return null;
  const and: Prisma.CompanyWhereInput[] = [scope, { status: "ACTIVE" }];
  if (filters.cities.length > 0)
    and.push({ OR: filters.cities.map((c) => ({ city: { equals: c.city, mode: "insensitive" as const }, region: { equals: c.region, mode: "insensitive" as const } })) });
  if (filters.regions.length > 0)
    and.push({ OR: filters.regions.map((r) => ({ region: { equals: r.region, mode: "insensitive" as const }, country: { in: countrySpellings(r.country), mode: "insensitive" as const } })) });
  if (filters.stageIds.length > 0) and.push({ pipelineStageId: { in: filters.stageIds } });
  if (filters.salespersonIds.length > 0) and.push({ assignedToId: { in: filters.salespersonIds } });
  if (filters.tags.length > 0) and.push(filters.tagMode === "all" ? { secondaryTags: { hasEvery: filters.tags } } : { secondaryTags: { hasSome: filters.tags } });
  if (filters.companyIds.length > 0) and.push({ id: { in: filters.companyIds } });
  return { AND: and };
}

const CANDIDATE_SELECT = {
  id: true,
  name: true,
  address1: true,
  city: true,
  region: true,
  postalCode: true,
  country: true,
  doNotContact: true,
  primaryContactId: true,
  contacts: { select: { id: true, firstName: true, lastName: true, doNotContact: true, status: true }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { id: "asc" }] },
} satisfies Prisma.CompanySelect;

export type Candidate = {
  companyId: string;
  companyName: string;
  state: "included" | "removed" | "excluded";
  /** Why a company can't be printed (excluded), in plain words. */
  reasons: string[];
  /** Things to double-check that don't block printing. */
  warnings: string[];
  attention: string;
  attentionNote: string | null;
  contactId: string | null;
  /** This job's contact choice, if any ("MANAGER" or a contact id). */
  override: string | null;
  /** Contacts that may be chosen instead (active, not do-not-contact, named). */
  contactOptions: { id: string; name: string }[];
  lines: LabelLine[];
};

export type Resolution = {
  filters: LabelFilters;
  needsConfirmAll: boolean;
  matched: number;
  candidates: Candidate[];
  included: Candidate[];
  excluded: Candidate[];
  removed: Candidate[];
  /** Fingerprint of exactly what would print, to catch changes after preview. */
  digest: string;
  tooMany: boolean;
};

/**
 * Resolve a draft against the current CRM: every matching company the user
 * may see, across all pages, once each (by company id), in print order,
 * marked included / removed by the user / excluded with the reason.
 */
export async function resolveDraft(
  user: AuthenticatedUser,
  draft: { filters: unknown; allConfirmed: boolean; removedCompanyIds: string[]; contactOverrides: unknown },
): Promise<Resolution> {
  const filters = parseStoredFilters(draft.filters);
  const overrides = parseStoredOverrides(draft.contactOverrides);
  const empty = filtersAreEmpty(filters);
  const base: Omit<Resolution, "digest"> = { filters, needsConfirmAll: false, matched: 0, candidates: [], included: [], excluded: [], removed: [], tooMany: false };

  const where = filterWhere(user, filters);
  if (!where) return { ...base, digest: "" };
  const matched = await prisma.company.count({ where });
  if (empty && !draft.allConfirmed) return { ...base, needsConfirmAll: true, matched, digest: "" };
  if (matched > MAX_MATCHED) return { ...base, matched, tooMany: true, digest: "" };

  const [companies, sender] = await Promise.all([prisma.company.findMany({ where, select: CANDIDATE_SELECT }), getSenderCountry()]);
  companies.sort(compareCompanies);
  const removed = new Set(draft.removedCompanyIds);

  const candidates: Candidate[] = companies.map((company) => {
    const override = overrides[company.id];
    const attention = chooseAttention(company.primaryContactId, company.contacts, override);
    const contactOptions = company.contacts
      .filter(contactUsable)
      .map((contact) => ({ id: contact.id, name: contactDisplayName(contact) }))
      .filter((option): option is { id: string; name: string } => option.name !== null);
    const reasons: string[] = [];
    if (company.doNotContact) reasons.push("Company is marked do not contact");
    const address = checkAddress(company, sender);
    if (!address.ok) reasons.push(...address.reasons);
    const warnings = address.ok ? [...address.warnings] : [];
    if (override && override !== MANAGER && !attention.overridden) warnings.push("The contact chosen for this job can't be used any more; using the default");
    const state: Candidate["state"] = reasons.length > 0 ? "excluded" : removed.has(company.id) ? "removed" : "included";
    return {
      companyId: company.id,
      companyName: company.name,
      state,
      reasons,
      warnings,
      attention: attention.name,
      attentionNote: attention.note,
      contactId: attention.contactId,
      override: override ?? null,
      contactOptions,
      lines: address.ok ? labelLines(company.name, attention.name, address) : [],
    };
  });

  // Distinct companies at one address stay distinct; just flag them.
  const byAddress = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    if (candidate.state !== "included") continue;
    const key = candidate.lines.slice(2).map((line) => line.text.toLowerCase()).join("|");
    byAddress.set(key, [...(byAddress.get(key) ?? []), candidate]);
  }
  for (const group of byAddress.values()) {
    if (group.length < 2) continue;
    for (const candidate of group) candidate.warnings.push(`Same address as ${group.filter((other) => other !== candidate).map((other) => other.companyName).join(", ")}`);
  }

  const included = candidates.filter((c) => c.state === "included");
  const digest = createHash("sha256")
    .update(JSON.stringify(included.map((c) => [c.companyId, c.contactId, c.lines])))
    .digest("hex");
  return {
    ...base,
    matched,
    candidates,
    included,
    excluded: candidates.filter((c) => c.state === "excluded"),
    removed: candidates.filter((c) => c.state === "removed"),
    digest,
  };
}

export async function getOrCreateDraft(user: AuthenticatedUser) {
  return prisma.mailingLabelDraft.upsert({
    where: { ownerId: user.id },
    create: { ownerId: user.id, filters: EMPTY_FILTERS },
    update: {},
  });
}

export function geometryOf(version: SheetGeometry): SheetGeometry {
  return {
    pageWidthMm: version.pageWidthMm,
    pageHeightMm: version.pageHeightMm,
    rows: version.rows,
    columns: version.columns,
    labelWidthMm: version.labelWidthMm,
    labelHeightMm: version.labelHeightMm,
    topMm: version.topMm,
    leftMm: version.leftMm,
    gapXMm: version.gapXMm,
    gapYMm: version.gapYMm,
    paddingMm: version.paddingMm,
    preferredFontPt: version.preferredFontPt,
    minFontPt: version.minFontPt,
    lineHeight: version.lineHeight,
  };
}

/** The sheet's latest version, or null if the sheet doesn't exist. */
export async function latestVersion(templateId: string) {
  return prisma.labelSheetTemplateVersion.findFirst({ where: { templateId }, orderBy: { version: "desc" }, include: { template: true } });
}

export type SheetChoice = {
  version: NonNullable<Awaited<ReturnType<typeof latestVersion>>>;
  geometry: SheetGeometry;
  offsetXMm: number;
  offsetYMm: number;
  profileName: string | null;
};

/** The draft's chosen sheet and printer correction, checked; or why not. */
export async function sheetChoice(user: AuthenticatedUser, draft: { templateId: string | null; alignmentProfileId: string | null; startPosition: number }): Promise<{ ok: true; choice: SheetChoice } | { ok: false; error: string }> {
  if (!draft.templateId) return { ok: false, error: "Choose a label sheet." };
  const version = await latestVersion(draft.templateId);
  if (!version || !version.template.active) return { ok: false, error: "That label sheet isn't available any more. Choose another." };
  const geometry = geometryOf(version);
  const problems = validateGeometry(geometry);
  if (problems.length > 0) return { ok: false, error: `The "${version.template.name}" sheet's measurements need fixing: ${problems[0]}` };
  if (!validStartPosition(geometry, draft.startPosition)) return { ok: false, error: `Choose a starting position from 1 to ${capacity(geometry)}.` };
  let offsetXMm = 0;
  let offsetYMm = 0;
  let profileName: string | null = null;
  if (draft.alignmentProfileId) {
    const profile = await prisma.labelAlignmentProfile.findFirst({ where: { id: draft.alignmentProfileId, userId: user.id, templateId: draft.templateId } });
    if (profile) {
      offsetXMm = profile.offsetXMm;
      offsetYMm = profile.offsetYMm;
      profileName = profile.name;
    }
  }
  if (!offsetKeepsLabelsOnPage(geometry, offsetXMm, offsetYMm)) return { ok: false, error: "The printer correction pushes labels off the page. Reduce it." };
  return { ok: true, choice: { version, geometry, offsetXMm, offsetYMm, profileName } };
}

export type SheetSummary = { labels: number; perSheet: number; skipped: number; sheets: number; unusedOnLast: number };
export function summarize(count: number, start: number, geometry: SheetGeometry): SheetSummary {
  const perSheet = capacity(geometry);
  return { labels: count, perSheet, skipped: count > 0 ? start - 1 : 0, sheets: pageCount(count, start, perSheet), unusedOnLast: unusedOnLastPage(count, start, perSheet) };
}

/** Lay out the included recipients on the chosen sheet. */
export async function layoutFor(included: Pick<Candidate, "companyId" | "lines">[], choice: Pick<SheetChoice, "geometry" | "offsetXMm" | "offsetYMm">, start: number): Promise<Layout> {
  const metrics = await fontMetrics();
  return layoutLabels(
    included.map((c) => ({ key: c.companyId, lines: c.lines })),
    choice.geometry,
    start,
    choice.offsetXMm,
    choice.offsetYMm,
    metrics,
  );
}

/** "triviality-mailing-labels-2026-11-06-ab12cd34.pdf", in the workspace's time zone. */
export async function batchFilename(batchId: string, createdAt: Date): Promise<string> {
  const settings = await prisma.organizationSettings.findUnique({ where: { id: 1 }, select: { defaultTimezone: true } });
  let date: string;
  try {
    date = new Intl.DateTimeFormat("en-CA", { timeZone: settings?.defaultTimezone ?? "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).format(createdAt);
  } catch {
    date = createdAt.toISOString().slice(0, 10);
  }
  return `triviality-mailing-labels-${date}-${batchId.slice(-8).replace(/[^a-z0-9]/gi, "")}.pdf`;
}

/**
 * Whether this user may re-draw this batch now: it's theirs, its names and
 * addresses haven't been cleared by retention, and every company on it is
 * still one they may see, still active and not marked do not contact.
 */
export async function batchAccess(user: AuthenticatedUser, batchId: string) {
  const batch = await prisma.mailingLabelBatch.findFirst({
    where: { id: batchId, ownerId: user.id },
    include: { recipients: { orderBy: { sequence: "asc" } }, templateVersion: true },
  });
  if (!batch) return { ok: false as const, status: 404, error: "That label batch wasn't found." };
  if (batch.recipientsPurgedAt) return { ok: false as const, status: 410, batch, error: "This batch's names and addresses were cleared under the retention policy. Start a new draft from current data instead." };
  const scope = companyScope(user);
  if (!scope) return { ok: false as const, status: 403, batch, error: "You don't have access to these companies any more." };
  const ids = [...new Set(batch.recipients.map((r) => r.companyId))];
  const allowed = await prisma.company.findMany({ where: { AND: [scope, { id: { in: ids } }, { status: "ACTIVE" }, { doNotContact: false }] }, select: { id: true } });
  const allowedIds = new Set(allowed.map((c) => c.id));
  const blocked = batch.recipients.filter((r) => !allowedIds.has(r.companyId));
  if (blocked.length > 0) {
    const names = blocked.slice(0, 3).map((r) => r.companyName).join(", ");
    return {
      ok: false as const,
      status: 403,
      batch,
      error: `${blocked.length} ${blocked.length === 1 ? "company on this batch is" : "companies on this batch are"} no longer available to you, archived, or marked do not contact (${names}${blocked.length > 3 ? ", ..." : ""}). Start a new draft from current data instead.`,
    };
  }
  return { ok: true as const, batch };
}

/** Lines stored on a recipient, as label lines. */
export function storedLines(value: unknown): LabelLine[] {
  return Array.isArray(value) ? value.filter((l): l is LabelLine => typeof l?.text === "string" && typeof l?.bold === "boolean") : [];
}
