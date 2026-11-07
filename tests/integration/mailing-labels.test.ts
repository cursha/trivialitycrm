import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, createLeadTypeFixture, createPipelineStageFixture, createCompanyFixture, fetchAuthenticatedUser, loginAs } from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { resolveDraft, batchAccess } from "../../src/lib/mailing-labels/service";
import {
  saveLabelFilters,
  setLabelContact,
  setLabelRemoved,
  setLabelSheet,
  reviewLabelJob,
  generateLabelBatch,
  createReprint,
  confirmBatchMailed,
  confirmBatchPrinted,
} from "../../src/app/(dashboard)/mailing-labels/actions";
import { saveLabelSheet } from "../../src/app/(dashboard)/settings/label-sheets/actions";
import { GET as batchPdf } from "../../src/app/api/mailing-labels/batches/[id]/pdf/route";

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
  await testPrisma.organizationSettings.create({
    data: { id: 1, organizationName: "Test", defaultCountry: "Canada", defaultTimezone: "America/Toronto", defaultCurrency: "CAD", defaultDateFormat: "yyyy-MM-dd" },
  });
});

// A test geometry in mm: 30 labels (3 x 10) on US Letter. Not a product preset.
const SHEET = {
  name: "Test 30-up",
  pageWidthMm: 215.9,
  pageHeightMm: 279.4,
  rows: 10,
  columns: 3,
  labelWidthMm: 66.675,
  labelHeightMm: 25.4,
  topMm: 12.7,
  leftMm: 4.7625,
  gapXMm: 3.175,
  gapYMm: 0,
  paddingMm: 2,
  preferredFontPt: 9,
  minFontPt: 6,
  lineHeight: 1.1,
};

async function setup() {
  const adminRole = await createRoleWithPermissions("Administrator", ["view_all_leads", "use_mailing_labels", "manage_label_sheets"]);
  const salesRole = await createRoleWithPermissions("Salesperson", ["view_assigned_leads", "use_mailing_labels"]);
  const admin = await createTestUser({ name: "Admin", roleId: adminRole.id });
  const rep = await createTestUser({ name: "Rep", roleId: salesRole.id });
  const leadType = await createLeadTypeFixture("Pub");
  const newStage = await createPipelineStageFixture("New", { isDefault: true });
  const wonStage = await createPipelineStageFixture("Won");
  await loginAs(admin.id);
  const sheet = await saveLabelSheet(null, SHEET);
  if (!sheet.ok) throw new Error(sheet.error);
  return { admin, rep, leadType, newStage, wonStage, sheetId: sheet.id };
}

async function company(ctx: Awaited<ReturnType<typeof setup>>, name: string, patch: Record<string, unknown> = {}, opts: { assignedToId?: string | null; city?: string; region?: string; stageId?: string } = {}) {
  const created = await createCompanyFixture({
    name,
    leadTypeId: ctx.leadType.id,
    pipelineStageId: opts.stageId ?? ctx.newStage.id,
    assignedToId: opts.assignedToId === undefined ? ctx.admin.id : opts.assignedToId,
    createdById: ctx.admin.id,
    city: opts.city ?? "Milton",
    region: opts.region ?? "ON",
  });
  return testPrisma.company.update({ where: { id: created.id }, data: { address1: "123 Main Street", postalCode: "L9T 1A1", ...patch } });
}

async function draftFor(userId: string) {
  return testPrisma.mailingLabelDraft.findUniqueOrThrow({ where: { ownerId: userId } });
}

/** Apply filters, choose the sheet, preview: the normal path to Generate. */
async function prepare(userId: string, sheetId: string, filters: object, allConfirmed = false, startPosition = 1) {
  let draft = await testPrisma.mailingLabelDraft.findUnique({ where: { ownerId: userId } });
  const r1 = await saveLabelFilters({ revision: draft?.revision ?? 0, filters, allConfirmed });
  if (!r1.ok) throw new Error(r1.error);
  const r2 = await setLabelSheet({ revision: r1.revision, templateId: sheetId, alignmentProfileId: null, startPosition });
  if (!r2.ok) throw new Error(r2.error);
  const review = await reviewLabelJob({ revision: r2.revision });
  draft = await draftFor(userId);
  return { review, revision: draft.revision };
}

describe("resolving recipients", () => {
  it("one label per company, alphabetical, primary contact or Manager, across all matches", async () => {
    const ctx = await setup();
    const b = await company(ctx, "beta pub");
    const a = await company(ctx, "Alpha Pub");
    await company(ctx, "The Crown");
    const jane = await testPrisma.contact.create({ data: { companyId: a.id, firstName: "Jane", lastName: "Smith" } });
    await testPrisma.contact.create({ data: { companyId: a.id, firstName: "Other", lastName: "Person" } });
    await testPrisma.company.update({ where: { id: a.id }, data: { primaryContactId: jane.id } });
    await testPrisma.contact.create({ data: { companyId: b.id, firstName: "Not", lastName: "Primary" } });

    const user = await fetchAuthenticatedUser(ctx.admin.id);
    const r = await resolveDraft(user, { filters: {}, allConfirmed: true, removedCompanyIds: [], contactOverrides: {} });
    expect(r.included.map((c) => c.companyName)).toEqual(["Alpha Pub", "beta pub", "The Crown"]);
    expect(r.included[0].lines.map((l) => l.text)).toEqual(["ALPHA PUB", "Attn: Jane Smith", "123 Main Street", "Milton, ON", "L9T 1A1"]);
    expect(r.included[1].attention).toBe("Manager"); // a non-primary contact is never picked
    expect(new Set(r.included.map((c) => c.companyId)).size).toBe(3);
    expect((await testPrisma.company.findUniqueOrThrow({ where: { id: a.id } })).name).toBe("Alpha Pub");
  });

  it("requires a deliberate choice when there are no filters", async () => {
    const ctx = await setup();
    await company(ctx, "Pub");
    const user = await fetchAuthenticatedUser(ctx.admin.id);
    const r = await resolveDraft(user, { filters: {}, allConfirmed: false, removedCompanyIds: [], contactOverrides: {} });
    expect(r).toMatchObject({ needsConfirmAll: true, matched: 1, included: [] });
  });

  it("combines filters with AND, values within one filter with OR, and tags Any/All", async () => {
    const ctx = await setup();
    await company(ctx, "Milton New", { secondaryTags: ["EASY_WIN"] });
    await company(ctx, "Milton Won", { secondaryTags: ["EASY_WIN", "REVENUE_READY"] }, { stageId: ctx.wonStage.id });
    await company(ctx, "Oakville New", { secondaryTags: ["REVENUE_READY"] }, { city: "Oakville" });
    await company(ctx, "Springfield IL", { country: "United States", postalCode: "62701" }, { city: "Milton", region: "IL" });
    const user = await fetchAuthenticatedUser(ctx.admin.id);
    const names = async (filters: object) => (await resolveDraft(user, { filters, allConfirmed: false, removedCompanyIds: [], contactOverrides: {} })).candidates.map((c) => c.companyName);

    expect(await names({ cities: [{ city: "milton", region: "on" }] })).toEqual(["Milton New", "Milton Won"]);
    expect(await names({ cities: [{ city: "Milton", region: "ON" }, { city: "Oakville", region: "ON" }] })).toEqual(["Milton New", "Milton Won", "Oakville New"]);
    expect(await names({ cities: [{ city: "Milton", region: "ON" }], stageIds: [ctx.wonStage.id] })).toEqual(["Milton Won"]);
    expect(await names({ tags: ["EASY_WIN", "REVENUE_READY"], tagMode: "any" })).toEqual(["Milton New", "Milton Won", "Oakville New"]);
    expect(await names({ tags: ["EASY_WIN", "REVENUE_READY"], tagMode: "all" })).toEqual(["Milton Won"]);
    // A province/state is matched with its country.
    expect(await names({ regions: [{ region: "IL", country: "Canada" }] })).toEqual([]);
    expect(await names({ regions: [{ region: "IL", country: "United States" }] })).toEqual(["Springfield IL"]);
  });

  it("only shows a salesperson their own companies, and never archived or do-not-contact ones", async () => {
    const ctx = await setup();
    await company(ctx, "Mine", {}, { assignedToId: ctx.rep.id });
    await company(ctx, "Not mine");
    await company(ctx, "Archived", { status: "ARCHIVED" }, { assignedToId: ctx.rep.id });
    await company(ctx, "Do not contact", { doNotContact: true }, { assignedToId: ctx.rep.id });
    const user = await fetchAuthenticatedUser(ctx.rep.id);
    const r = await resolveDraft(user, { filters: {}, allConfirmed: true, removedCompanyIds: [], contactOverrides: {} });
    expect(r.matched).toBe(2);
    expect(r.included.map((c) => c.companyName)).toEqual(["Mine"]);
    expect(r.excluded.map((c) => [c.companyName, c.reasons])).toEqual([["Do not contact", ["Company is marked do not contact"]]]);
  });

  it("lists incomplete addresses with reasons, and keeps distinct companies at one address", async () => {
    const ctx = await setup();
    await company(ctx, "No street", { address1: null });
    await company(ctx, "No postal", { postalCode: "" });
    await company(ctx, "Twin A");
    await company(ctx, "Twin B");
    const user = await fetchAuthenticatedUser(ctx.admin.id);
    const r = await resolveDraft(user, { filters: {}, allConfirmed: true, removedCompanyIds: [], contactOverrides: {} });
    expect(r.excluded.map((c) => [c.companyName, c.reasons[0]])).toEqual([
      ["No postal", "Missing postal/ZIP code"],
      ["No street", "Missing street address"],
    ]);
    expect(r.included.map((c) => c.companyName)).toEqual(["Twin A", "Twin B"]);
    expect(r.included[0].warnings.join()).toMatch(/Same address as Twin B/);
  });
});

describe("the draft", () => {
  it("rejects a contact from another company, and an override never changes the company's primary contact", async () => {
    const ctx = await setup();
    const a = await company(ctx, "A");
    const b = await company(ctx, "B");
    const other = await testPrisma.contact.create({ data: { companyId: b.id, firstName: "Other", lastName: "Co" } });
    const bob = await testPrisma.contact.create({ data: { companyId: a.id, firstName: "Bob", lastName: "Lee" } });
    const r1 = await saveLabelFilters({ revision: 0, filters: {}, allConfirmed: true });
    if (!r1.ok) throw new Error(r1.error);
    expect(await setLabelContact({ revision: r1.revision, companyId: a.id, choice: other.id })).toEqual({ ok: false, error: "That contact doesn't belong to this company." });
    const r2 = await setLabelContact({ revision: r1.revision, companyId: a.id, choice: bob.id });
    expect(r2.ok).toBe(true);
    const user = await fetchAuthenticatedUser(ctx.admin.id);
    const resolved = await resolveDraft(user, await draftFor(ctx.admin.id));
    expect(resolved.included.find((c) => c.companyId === a.id)?.attention).toBe("Bob Lee");
    expect((await testPrisma.company.findUniqueOrThrow({ where: { id: a.id } })).primaryContactId).toBeNull();
  });

  it("refuses a save from a stale tab instead of overwriting", async () => {
    const ctx = await setup();
    const a = await company(ctx, "A");
    const r1 = await saveLabelFilters({ revision: 0, filters: {}, allConfirmed: true });
    if (!r1.ok) throw new Error(r1.error);
    expect((await setLabelRemoved({ revision: r1.revision, companyId: a.id, removed: true })).ok).toBe(true);
    const stale = await setLabelRemoved({ revision: r1.revision, companyId: a.id, removed: false });
    expect(stale).toMatchObject({ ok: false, conflict: true });
    expect((await draftFor(ctx.admin.id)).removedCompanyIds).toEqual([a.id]);
  });
});

describe("generating", () => {
  it("needs a preview, freezes the snapshot, and a double click makes one batch", async () => {
    const ctx = await setup();
    await company(ctx, "A");
    await company(ctx, "B");
    const r1 = await saveLabelFilters({ revision: 0, filters: {}, allConfirmed: true });
    if (!r1.ok) throw new Error(r1.error);
    const r2 = await setLabelSheet({ revision: r1.revision, templateId: ctx.sheetId, alignmentProfileId: null, startPosition: 29 });
    if (!r2.ok) throw new Error(r2.error);
    expect(await generateLabelBatch({ revision: r2.revision })).toEqual({ ok: false, error: "Preview the labels before generating them." });

    const review = await reviewLabelJob({ revision: r2.revision });
    expect(review).toMatchObject({ ok: true, summary: { labels: 2, skipped: 28, sheets: 1 } });
    const [first, second] = await Promise.all([generateLabelBatch({ revision: r2.revision }), generateLabelBatch({ revision: r2.revision })]);
    expect(first.ok && second.ok && first.batchId === second.batchId).toBe(true);
    expect(await testPrisma.mailingLabelBatch.count()).toBe(1);
    const batch = await testPrisma.mailingLabelBatch.findFirstOrThrow({ include: { recipients: { orderBy: { sequence: "asc" } } } });
    expect(batch).toMatchObject({ recipientCount: 2, pageCount: 1, startPosition: 29, printedAt: null, mailedAt: null });
    expect(batch.recipients.map((r) => r.companyName)).toEqual(["A", "B"]);
  });

  it("requires a fresh preview when a company changed after review", async () => {
    const ctx = await setup();
    const a = await company(ctx, "A");
    const { review, revision } = await prepare(ctx.admin.id, ctx.sheetId, {}, true);
    expect(review.ok).toBe(true);
    await testPrisma.company.update({ where: { id: a.id }, data: { address1: "999 New Road" } });
    expect(await generateLabelBatch({ revision })).toMatchObject({ ok: false, error: expect.stringMatching(/changed since you previewed/) });
    expect(await testPrisma.mailingLabelBatch.count()).toBe(0);
  });

  it("won't generate with nothing to print", async () => {
    const ctx = await setup();
    await company(ctx, "No street", { address1: null });
    const { review } = await prepare(ctx.admin.id, ctx.sheetId, {}, true);
    expect(review).toMatchObject({ ok: false, error: expect.stringMatching(/No companies are ready/) });
  });

  it("blocks a label that can't fit and names the company and field", async () => {
    const ctx = await setup();
    await company(ctx, "A".repeat(80));
    const { review } = await prepare(ctx.admin.id, ctx.sheetId, {}, true);
    expect(review).toMatchObject({ ok: false, overflows: [{ companyName: "A".repeat(80), field: "company name" }] });
  });

  it("refuses more than the batch limit rather than cutting it short", async () => {
    const ctx = await setup();
    await testPrisma.mailingLabelSettings.create({ data: { id: 1, maxLabelsPerBatch: 1 } });
    await company(ctx, "A");
    await company(ctx, "B");
    const { review } = await prepare(ctx.admin.id, ctx.sheetId, {}, true);
    expect(review).toMatchObject({ ok: false, error: expect.stringMatching(/more than the 1 allowed/) });
  });
});

describe("batches", () => {
  async function generated() {
    const ctx = await setup();
    await company(ctx, "A");
    const b = await company(ctx, "B");
    const { revision } = await prepare(ctx.admin.id, ctx.sheetId, {}, true);
    const result = await generateLabelBatch({ revision });
    if (!result.ok) throw new Error(result.error);
    return { ctx, b, batchId: result.batchId };
  }

  it("re-draws the exact PDF, and only for its owner", async () => {
    const { ctx, batchId } = await generated();
    const response = await batchPdf(new Request(`http://test/api/mailing-labels/batches/${batchId}/pdf?download=1`), { params: Promise.resolve({ id: batchId }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(response.headers.get("Content-Disposition")).toMatch(/^attachment; filename="triviality-mailing-labels-\d{4}-\d{2}-\d{2}-[a-z0-9]+\.pdf"$/);

    await loginAs(ctx.rep.id);
    const other = await batchPdf(new Request(`http://test/x`), { params: Promise.resolve({ id: batchId }) });
    expect(other.status).toBe(404);
  });

  it("blocks a reprint once a company on it is marked do not contact", async () => {
    const { ctx, b, batchId } = await generated();
    await testPrisma.company.update({ where: { id: b.id }, data: { doNotContact: true } });
    const user = await fetchAuthenticatedUser(ctx.admin.id);
    expect(await batchAccess(user, batchId)).toMatchObject({ ok: false, status: 403 });
    expect(await createReprint({ batchId, startPosition: 1, sequences: null })).toMatchObject({ ok: false });
  });

  it("a reprint keeps the original's lines and points back to it", async () => {
    const { batchId } = await generated();
    const result = await createReprint({ batchId, startPosition: 30, sequences: [2] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const reprint = await testPrisma.mailingLabelBatch.findUniqueOrThrow({ where: { id: result.batchId }, include: { recipients: true } });
    expect(reprint).toMatchObject({ parentBatchId: batchId, startPosition: 30, recipientCount: 1, pageCount: 1 });
    expect(reprint.recipients.map((r) => r.companyName)).toEqual(["B"]);
    const original = await testPrisma.mailingLabelBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect(original.startPosition).toBe(1);
  });

  it("printed and mailed are only set when confirmed, and never change the stage", async () => {
    const { ctx, batchId } = await generated();
    expect((await testPrisma.mailingLabelBatch.findUniqueOrThrow({ where: { id: batchId } })).printedAt).toBeNull();
    await confirmBatchPrinted(batchId);
    await confirmBatchMailed(batchId, "November flyer");
    const batch = await testPrisma.mailingLabelBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect(batch.printedAt).not.toBeNull();
    expect(batch).toMatchObject({ mailedNote: "November flyer", mailedById: ctx.admin.id });
    const stages = await testPrisma.company.findMany({ select: { pipelineStageId: true } });
    expect(stages.every((s) => s.pipelineStageId === ctx.newStage.id)).toBe(true);
  });
});

describe("label sheets", () => {
  it("rejects measurements that don't fit, and an edit makes a new version", async () => {
    const ctx = await setup();
    await loginAs(ctx.admin.id);
    expect(await saveLabelSheet(null, { ...SHEET, name: "Too wide", columns: 4 })).toMatchObject({ ok: false, error: expect.stringMatching(/don't fit across/) });
    const saved = await saveLabelSheet(ctx.sheetId, { ...SHEET, topMm: 13 });
    expect(saved.ok).toBe(true);
    expect(await testPrisma.labelSheetTemplateVersion.count({ where: { templateId: ctx.sheetId } })).toBe(2);
  });

  it("is administrator-only", async () => {
    const ctx = await setup();
    await loginAs(ctx.rep.id);
    await expect(saveLabelSheet(null, { ...SHEET, name: "Rep sheet" })).rejects.toThrow();
  });
});
