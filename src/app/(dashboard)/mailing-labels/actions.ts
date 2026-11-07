"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser, type AuthenticatedUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { writeAuditEvent } from "@/lib/audit/log";
import { companyScope } from "@/lib/companies/scope";
import { contactDisplayName, contactUsable, MANAGER } from "@/lib/mailing-labels/contact";
import { batchAccess, filterWhere, geometryOf, getLabelSettings, getOrCreateDraft, layoutFor, resolveDraft, sheetChoice, storedLines, summarize, type SheetSummary } from "@/lib/mailing-labels/service";
import { LAYOUT_VERSION, fontMetrics } from "@/lib/mailing-labels/render";
import { capacity, validStartPosition, type SheetGeometry } from "@/lib/mailing-labels/geometry";
import { AlignmentProfileSchema, EMPTY_FILTERS, LabelFiltersSchema, parseStoredOverrides } from "@/lib/validation/mailing-labels";
import { createHash } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";

export type DraftResult = { ok: true; revision: number; message?: string } | { ok: false; error: string; conflict?: boolean };

const PATH = "/mailing-labels";
const CONFLICT = "This label job was changed in another tab or window. Reload the page to see the latest version.";

async function requireLabelUser() {
  const user = await requireUser();
  requirePermission(user, "use_mailing_labels");
  return user;
}

/**
 * Save a change to the user's draft only if nobody saved over it since this
 * page loaded (optimistic concurrency on `revision`). Every content change
 * clears the reviewed fingerprint, so generation needs a fresh preview.
 */
async function updateDraft(user: AuthenticatedUser, revision: number, data: Prisma.MailingLabelDraftUpdateManyMutationInput): Promise<DraftResult> {
  const draft = await getOrCreateDraft(user);
  const { count } = await prisma.mailingLabelDraft.updateMany({
    where: { id: draft.id, revision },
    data: { ...data, reviewedDigest: null, revision: { increment: 1 } },
  });
  if (count === 0) return { ok: false, error: CONFLICT, conflict: true };
  revalidatePath(PATH);
  return { ok: true, revision: revision + 1 };
}

/** Is this company one the user may see and that matches the draft? */
async function companyInDraft(user: AuthenticatedUser, companyId: string): Promise<boolean> {
  const draft = await getOrCreateDraft(user);
  const resolution = await resolveDraft(user, draft);
  return resolution.candidates.some((c) => c.companyId === companyId);
}

/**
 * New filters rebuild the candidate set. Removals and contact choices for
 * companies that no longer match are dropped (the page warned first), and
 * the message says how many.
 */
export async function saveLabelFilters(input: { revision: number; filters: unknown; allConfirmed: boolean }): Promise<DraftResult> {
  const user = await requireLabelUser();
  const parsed = LabelFiltersSchema.safeParse(input.filters);
  if (!parsed.success) return { ok: false, error: "Those filters aren't valid. Reset them and try again." };
  const draft = await getOrCreateDraft(user);
  const next = await resolveDraft(user, { ...draft, filters: parsed.data, allConfirmed: input.allConfirmed });
  const stillMatched = new Set(next.candidates.map((c) => c.companyId));
  const overrides = parseStoredOverrides(draft.contactOverrides);
  const keptRemovals = draft.removedCompanyIds.filter((id) => stillMatched.has(id));
  const keptOverrides = Object.fromEntries(Object.entries(overrides).filter(([id]) => stillMatched.has(id)));
  const dropped = draft.removedCompanyIds.length - keptRemovals.length + (Object.keys(overrides).length - Object.keys(keptOverrides).length);
  const result = await updateDraft(user, input.revision, {
    filters: parsed.data,
    allConfirmed: input.allConfirmed,
    removedCompanyIds: keptRemovals,
    contactOverrides: keptOverrides,
  });
  if (result.ok && dropped > 0) result.message = `${dropped} ${dropped === 1 ? "removal or contact choice" : "removals and contact choices"} for companies that no longer match were cleared.`;
  return result;
}

/**
 * "Print labels for N selected" on the Companies list: replace the user's
 * in-progress job with one for exactly those companies (the list asked
 * first). Only companies the user may see count; the sheet choice is kept.
 */
export async function startLabelsForCompanies(companyIds: string[]): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const user = await requireLabelUser();
  const ids = [...new Set(companyIds.filter((id) => typeof id === "string" && id.length > 0 && id.length <= 40))];
  if (ids.length === 0) return { ok: false, error: "Tick at least one company." };
  if (ids.length > 5000) return { ok: false, error: "Tick at most 5,000 companies at a time." };
  const filters = { ...EMPTY_FILTERS, companyIds: ids };
  const where = filterWhere(user, filters);
  if (!where) return { ok: false, error: "You don't have access to companies." };
  const count = await prisma.company.count({ where });
  if (count === 0) return { ok: false, error: "None of those companies can get labels (they may be archived or not yours)." };
  const draft = await getOrCreateDraft(user);
  await prisma.mailingLabelDraft.update({
    where: { id: draft.id },
    data: { filters, allConfirmed: false, removedCompanyIds: [], contactOverrides: {}, reviewedDigest: null, revision: { increment: 1 } },
  });
  revalidatePath(PATH);
  return { ok: true, count };
}

export async function setLabelRemoved(input: { revision: number; companyId: string; removed: boolean }): Promise<DraftResult> {
  const user = await requireLabelUser();
  if (!(await companyInDraft(user, input.companyId))) return { ok: false, error: "That company isn't in this label job." };
  const draft = await getOrCreateDraft(user);
  const removed = new Set(draft.removedCompanyIds);
  if (input.removed) removed.add(input.companyId);
  else removed.delete(input.companyId);
  return updateDraft(user, input.revision, { removedCompanyIds: [...removed] });
}

/** Choose who this company's label is addressed to, for this job only. */
export async function setLabelContact(input: { revision: number; companyId: string; choice: string | null }): Promise<DraftResult> {
  const user = await requireLabelUser();
  const scope = companyScope(user);
  if (!scope) return { ok: false, error: "You don't have access to companies." };
  const company = await prisma.company.findFirst({
    where: { AND: [scope, { id: input.companyId }] },
    select: { id: true, contacts: { select: { id: true, firstName: true, lastName: true, doNotContact: true, status: true } } },
  });
  if (!company || !(await companyInDraft(user, input.companyId))) return { ok: false, error: "That company isn't in this label job." };
  if (input.choice && input.choice !== MANAGER) {
    const contact = company.contacts.find((c) => c.id === input.choice);
    if (!contact) return { ok: false, error: "That contact doesn't belong to this company." };
    if (!contactUsable(contact) || !contactDisplayName(contact)) return { ok: false, error: "That contact can't be used on a label (no name, inactive, or do not contact)." };
  }
  const draft = await getOrCreateDraft(user);
  const overrides = parseStoredOverrides(draft.contactOverrides);
  if (input.choice) overrides[input.companyId] = input.choice;
  else delete overrides[input.companyId];
  return updateDraft(user, input.revision, { contactOverrides: overrides });
}

export async function setLabelSheet(input: { revision: number; templateId: string | null; alignmentProfileId: string | null; startPosition: number }): Promise<DraftResult> {
  const user = await requireLabelUser();
  let startPosition = Math.trunc(Number(input.startPosition)) || 1;
  if (input.templateId) {
    const template = await prisma.labelSheetTemplate.findFirst({ where: { id: input.templateId, active: true }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } });
    const version = template?.versions[0];
    if (!template || !version) return { ok: false, error: "That label sheet isn't available." };
    if (!validStartPosition(version, startPosition)) startPosition = 1;
    if (input.alignmentProfileId) {
      const profile = await prisma.labelAlignmentProfile.findFirst({ where: { id: input.alignmentProfileId, userId: user.id, templateId: template.id } });
      if (!profile) return { ok: false, error: "That printer setting isn't available for this sheet." };
    }
  }
  return updateDraft(user, input.revision, {
    templateId: input.templateId,
    alignmentProfileId: input.templateId ? input.alignmentProfileId : null,
    startPosition,
  });
}

/** The exact layout the PDF draws, for the on-page preview. */
export type PreviewLayout = {
  geometry: SheetGeometry;
  /** Font ascent per point of size, to place baselines like the PDF does. */
  ascent: number;
  pages: number;
  labels: { page: number; position: number; xMm: number; yMm: number; sizePt: number; rows: { text: string; bold: boolean }[] }[];
};

export type ReviewResult =
  | { ok: true; digest: string; summary: SheetSummary; warnings: number; preview: PreviewLayout }
  | { ok: false; error: string; conflict?: boolean; overflows?: { companyName: string; field: string; problem: string }[] };

/**
 * Check the whole job and lay it out exactly as it will print. On success
 * the recipient fingerprint is saved, and the preview shows this layout;
 * generating later requires the data to still match it.
 */
export async function reviewLabelJob(input: { revision: number }): Promise<ReviewResult> {
  const user = await requireLabelUser();
  const draft = await getOrCreateDraft(user);
  if (draft.revision !== input.revision) return { ok: false, error: CONFLICT, conflict: true };
  const resolution = await resolveDraft(user, draft);
  if (resolution.needsConfirmAll) return { ok: false, error: "Choose some filters, or confirm you want every matching company." };
  if (resolution.tooMany) return { ok: false, error: "Too many companies match. Narrow the filters." };
  if (resolution.included.length === 0) return { ok: false, error: "No companies are ready to print. Check the filters and the correction list." };
  const settings = await getLabelSettings();
  if (resolution.included.length > settings.maxLabelsPerBatch)
    return { ok: false, error: `${resolution.included.length} labels is more than the ${settings.maxLabelsPerBatch} allowed in one job. Narrow the filters or remove some companies, and print the rest as a second job.` };
  const sheet = await sheetChoice(user, draft);
  if (!sheet.ok) return { ok: false, error: sheet.error };
  const layout = await layoutFor(resolution.included, sheet.choice, draft.startPosition);
  if (!layout.ok) {
    const names = new Map(resolution.included.map((c) => [c.companyId, c.companyName]));
    return {
      ok: false,
      error: "Some labels don't fit on this sheet even at the smallest text size. Shorten those fields, or choose a sheet with bigger labels.",
      overflows: layout.overflows.map((o) => ({ companyName: names.get(o.key) ?? "", field: o.field, problem: o.problem })),
    };
  }
  const { count } = await prisma.mailingLabelDraft.updateMany({ where: { id: draft.id, revision: input.revision }, data: { reviewedDigest: resolution.digest } });
  if (count === 0) return { ok: false, error: CONFLICT, conflict: true };
  return {
    ok: true,
    digest: resolution.digest,
    summary: summarize(resolution.included.length, draft.startPosition, sheet.choice.geometry),
    warnings: resolution.included.filter((c) => c.warnings.length > 0).length,
    preview: {
      geometry: sheet.choice.geometry,
      ascent: (await fontMetrics()).ascent,
      pages: layout.pages,
      labels: layout.labels.map((l) => ({ page: l.page, position: l.position, xMm: l.xMm, yMm: l.yMm, sizePt: l.sizePt, rows: l.rows.map((r) => ({ text: r.text, bold: r.bold })) })),
    },
  };
}

export type GenerateResult = { ok: true; batchId: string } | { ok: false; error: string; conflict?: boolean };

/**
 * Freeze the reviewed job into an immutable batch. The CRM data must still
 * match what was previewed; a double click or retry returns the same batch.
 * Doesn't change any company's stage or claim anything was printed or
 * mailed.
 */
export async function generateLabelBatch(input: { revision: number }): Promise<GenerateResult> {
  const user = await requireLabelUser();
  const draft = await getOrCreateDraft(user);
  if (draft.revision !== input.revision) return { ok: false, error: CONFLICT, conflict: true };
  if (!draft.reviewedDigest) return { ok: false, error: "Preview the labels before generating them." };

  const resolution = await resolveDraft(user, draft);
  const idempotencyKey = `draft:${draft.id}:${draft.revision}:${draft.reviewedDigest}`;
  const existing = await prisma.mailingLabelBatch.findUnique({ where: { idempotencyKey }, select: { id: true, ownerId: true } });
  if (existing && existing.ownerId === user.id) return { ok: true, batchId: existing.id };
  if (resolution.digest !== draft.reviewedDigest) return { ok: false, error: "Some companies or contacts changed since you previewed. Preview again to see the latest before generating." };
  const settings = await getLabelSettings();
  if (resolution.included.length === 0) return { ok: false, error: "No companies are ready to print." };
  if (resolution.included.length > settings.maxLabelsPerBatch) return { ok: false, error: `More than the ${settings.maxLabelsPerBatch} labels allowed in one job.` };
  const sheet = await sheetChoice(user, draft);
  if (!sheet.ok) return { ok: false, error: sheet.error };
  const layout = await layoutFor(resolution.included, sheet.choice, draft.startPosition);
  if (!layout.ok) return { ok: false, error: "Some labels don't fit on this sheet. Preview again for details." };

  let batchId: string;
  try {
    const batch = await prisma.mailingLabelBatch.create({
      data: {
        ownerId: user.id,
        idempotencyKey,
        filters: resolution.filters,
        removedCompanyIds: draft.removedCompanyIds,
        exclusions: resolution.excluded.map((c) => ({ companyId: c.companyId, companyName: c.companyName, reasons: c.reasons })),
        templateVersionId: sheet.choice.version.id,
        templateName: sheet.choice.version.template.name,
        alignmentProfileName: sheet.choice.profileName,
        offsetXMm: sheet.choice.offsetXMm,
        offsetYMm: sheet.choice.offsetYMm,
        startPosition: draft.startPosition,
        layoutVersion: LAYOUT_VERSION,
        recipientCount: resolution.included.length,
        pageCount: layout.pages,
        layoutSha256: layout.sha256,
        recipients: {
          create: resolution.included.map((c, index) => ({
            sequence: index + 1,
            companyId: c.companyId,
            contactId: c.contactId,
            companyName: c.companyName,
            lines: c.lines,
          })),
        },
      },
      select: { id: true },
    });
    batchId = batch.id;
  } catch (error) {
    // A concurrent click won the unique idempotency key: hand back its batch.
    const winner = await prisma.mailingLabelBatch.findUnique({ where: { idempotencyKey }, select: { id: true, ownerId: true } });
    if (winner && winner.ownerId === user.id) return { ok: true, batchId: winner.id };
    throw error;
  }

  await writeAuditEvent({
    actorId: user.id,
    module: "mailing_labels",
    action: "batch.generated",
    entityType: "MailingLabelBatch",
    entityId: batchId,
    metadata: { labels: resolution.included.length, pages: layout.pages, excluded: resolution.excluded.length, sheet: sheet.choice.version.template.name, sheetVersion: sheet.choice.version.version, startPosition: draft.startPosition },
  });
  revalidatePath(PATH);
  return { ok: true, batchId };
}

// --- printer settings (alignment profiles) ---------------------------------

export type ProfileResult = { ok: true; id: string } | { ok: false; error: string };

export async function saveAlignmentProfile(input: { id?: string; name: string; templateId: string; offsetXMm: number; offsetYMm: number }): Promise<ProfileResult> {
  const user = await requireLabelUser();
  const parsed = AlignmentProfileSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the printer setting." };
  const template = await prisma.labelSheetTemplate.findUnique({ where: { id: parsed.data.templateId } });
  if (!template) return { ok: false, error: "That label sheet wasn't found." };
  try {
    if (input.id) {
      const { count } = await prisma.labelAlignmentProfile.updateMany({ where: { id: input.id, userId: user.id }, data: { name: parsed.data.name, offsetXMm: parsed.data.offsetXMm, offsetYMm: parsed.data.offsetYMm } });
      if (count === 0) return { ok: false, error: "That printer setting wasn't found." };
      revalidatePath(PATH);
      return { ok: true, id: input.id };
    }
    const profile = await prisma.labelAlignmentProfile.create({ data: { userId: user.id, ...parsed.data } });
    revalidatePath(PATH);
    return { ok: true, id: profile.id };
  } catch {
    return { ok: false, error: "You already have a printer setting with that name for this sheet." };
  }
}

export async function deleteAlignmentProfile(id: string): Promise<{ ok: boolean }> {
  const user = await requireLabelUser();
  await prisma.labelAlignmentProfile.deleteMany({ where: { id, userId: user.id } });
  await prisma.mailingLabelDraft.updateMany({ where: { ownerId: user.id, alignmentProfileId: id }, data: { alignmentProfileId: null, reviewedDigest: null, revision: { increment: 1 } } });
  revalidatePath(PATH);
  return { ok: true };
}

// --- batches ----------------------------------------------------------------

export async function confirmBatchPrinted(batchId: string): Promise<{ ok: boolean; error?: string }> {
  const user = await requireLabelUser();
  const { count } = await prisma.mailingLabelBatch.updateMany({ where: { id: batchId, ownerId: user.id, printedAt: null }, data: { printedAt: new Date(), printedById: user.id } });
  if (count > 0) await writeAuditEvent({ actorId: user.id, module: "mailing_labels", action: "batch.printed_confirmed", entityType: "MailingLabelBatch", entityId: batchId });
  revalidatePath(`${PATH}/history/${batchId}`);
  return { ok: true };
}

export async function confirmBatchMailed(batchId: string, note: string): Promise<{ ok: boolean; error?: string }> {
  const user = await requireLabelUser();
  const trimmed = note.trim().slice(0, 300) || null;
  const { count } = await prisma.mailingLabelBatch.updateMany({ where: { id: batchId, ownerId: user.id, mailedAt: null }, data: { mailedAt: new Date(), mailedById: user.id, mailedNote: trimmed } });
  if (count > 0) await writeAuditEvent({ actorId: user.id, module: "mailing_labels", action: "batch.mailed_confirmed", entityType: "MailingLabelBatch", entityId: batchId });
  revalidatePath(`${PATH}/history/${batchId}`);
  return { ok: true };
}

/**
 * A reprint of some or all of a batch's labels at a new starting position:
 * a new batch pointing back at the original, with the original's exact
 * lines, sheet version and printer correction (never current template
 * edits). Checked against current access first.
 */
export async function createReprint(input: { batchId: string; startPosition: number; sequences: number[] | null }): Promise<GenerateResult> {
  const user = await requireLabelUser();
  const access = await batchAccess(user, input.batchId);
  if (!access.ok) return { ok: false, error: access.error };
  const original = access.batch;
  const recipients = input.sequences ? original.recipients.filter((r) => input.sequences!.includes(r.sequence)) : original.recipients;
  if (recipients.length === 0) return { ok: false, error: "Choose at least one label to reprint." };
  const version = original.templateVersion;
  if (!validStartPosition(version, input.startPosition)) return { ok: false, error: `Choose a starting position from 1 to ${capacity(version)}.` };
  // The batch's own stored lines, sheet version and correction.
  const layout = await layoutFor(
    recipients.map((r) => ({ companyId: r.companyId, lines: storedLines(r.lines) })),
    { geometry: geometryOf(version), offsetXMm: original.offsetXMm, offsetYMm: original.offsetYMm },
    input.startPosition,
  );
  if (!layout.ok) return { ok: false, error: "These labels no longer lay out the same way. Start a new draft from current data instead." };
  const key = `reprint:${original.id}:${input.startPosition}:${createHash("sha256").update(recipients.map((r) => r.sequence).join(",")).digest("hex").slice(0, 16)}`;
  const existing = await prisma.mailingLabelBatch.findUnique({ where: { idempotencyKey: key }, select: { id: true, ownerId: true } });
  if (existing && existing.ownerId === user.id) return { ok: true, batchId: existing.id };
  const batch = await prisma.mailingLabelBatch.create({
    data: {
      ownerId: user.id,
      idempotencyKey: key,
      parentBatchId: original.id,
      filters: original.filters as Prisma.InputJsonValue,
      removedCompanyIds: original.removedCompanyIds,
      exclusions: [],
      templateVersionId: version.id,
      templateName: original.templateName,
      alignmentProfileName: original.alignmentProfileName,
      offsetXMm: original.offsetXMm,
      offsetYMm: original.offsetYMm,
      startPosition: input.startPosition,
      layoutVersion: LAYOUT_VERSION,
      recipientCount: recipients.length,
      pageCount: layout.pages,
      layoutSha256: layout.sha256,
      recipients: {
        create: recipients.map((r, index) => ({ sequence: index + 1, companyId: r.companyId, contactId: r.contactId, companyName: r.companyName, lines: r.lines as Prisma.InputJsonValue })),
      },
    },
    select: { id: true },
  });
  await writeAuditEvent({ actorId: user.id, module: "mailing_labels", action: "batch.reprinted", entityType: "MailingLabelBatch", entityId: batch.id, metadata: { parentBatchId: original.id, labels: recipients.length, startPosition: input.startPosition } });
  revalidatePath(`${PATH}/history`);
  return { ok: true, batchId: batch.id };
}

/** Start the draft again from a past batch's filters and choices, against
 * current CRM data (the batch itself is untouched). */
export async function draftFromBatch(batchId: string): Promise<{ ok: boolean; error?: string }> {
  const user = await requireLabelUser();
  const batch = await prisma.mailingLabelBatch.findFirst({ where: { id: batchId, ownerId: user.id }, include: { templateVersion: true } });
  if (!batch) return { ok: false, error: "That label batch wasn't found." };
  const draft = await getOrCreateDraft(user);
  await prisma.mailingLabelDraft.update({
    where: { id: draft.id },
    data: {
      filters: batch.filters as Prisma.InputJsonValue,
      allConfirmed: true,
      removedCompanyIds: batch.removedCompanyIds,
      contactOverrides: {},
      templateId: batch.templateVersion.templateId,
      alignmentProfileId: null,
      startPosition: 1,
      reviewedDigest: null,
      revision: { increment: 1 },
    },
  });
  revalidatePath(PATH);
  return { ok: true };
}
