import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import {
  createRoleWithPermissions,
  createTestUser,
  createLeadTypeFixture,
  createPipelineStageFixture,
  createCompetitorFixture,
  createLeadSearchFixture,
  createSearchResultFixture,
  createCompanyFixture,
  loginAs,
} from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { saveCompetitionLocatorResults } from "../../src/app/(dashboard)/leads/competition-locator/[runId]/review/actions";
import type { CompetitionLocatorRowDecision } from "../../src/lib/validation/competition-locator-review";
import { findScoredDuplicateMatches } from "../../src/lib/duplicates/scored-match";

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
});

async function baseFixtures() {
  const role = await createRoleWithPermissions("Administrator", ["transfer_leads"]);
  const user = await createTestUser({ roleId: role.id });
  const leadType = await createLeadTypeFixture("Pub");
  const stage = await createPipelineStageFixture("New", { isDefault: true });
  const competitor = await createCompetitorFixture("Geeks Who Drink");
  const runId = "test-run-1";
  const search = await createLeadSearchFixture({
    createdById: user.id,
    leadTypeId: leadType.id,
    mode: "COMPETITOR",
    competitorId: competitor.id,
    runCorrelationId: runId,
  });
  return { user, leadType, stage, competitor, runId, search };
}

function baseRow(resultId: string, overrides: Partial<CompetitionLocatorRowDecision> = {}): CompetitionLocatorRowDecision {
  return {
    resultId,
    approved: true,
    fieldDecisions: {},
    contacts: [],
    ...overrides,
  };
}

describe("saveCompetitionLocatorResults", () => {
  it("creates a new company with the search's competitor assigned when there's no duplicate match", async () => {
    const { user, stage, competitor, runId, search } = await baseFixtures();
    await loginAs(user.id);
    const result = await createSearchResultFixture({ searchId: search.id, name: "The Copper Kettle", competitorId: competitor.id });

    const outcome = await saveCompetitionLocatorResults({
      runId,
      assignedToId: user.id,
      pipelineStageId: stage.id,
      rows: [baseRow(result.id)],
    });

    expect(outcome).toMatchObject({ createdCount: 1, updatedCount: 0 });
    const company = await testPrisma.company.findFirstOrThrow({ where: { name: "The Copper Kettle" } });
    expect(company.competitorId).toBe(competitor.id);

    const updatedResult = await testPrisma.searchResult.findUniqueOrThrow({ where: { id: result.id } });
    expect(updatedResult.disposition).toBe("TRANSFERRED");
    expect(updatedResult.companyId).toBe(company.id);
  });

  it("writes competitorTriviaProvider/Day alongside competitorId on a fresh create", async () => {
    const { user, stage, competitor, runId, search } = await baseFixtures();
    await loginAs(user.id);
    const result = await createSearchResultFixture({
      searchId: search.id,
      name: "The Copper Kettle",
      competitorId: competitor.id,
      competitorName: "Geeks Who Drink (branded event)",
      day: "TUESDAY",
    });

    await saveCompetitionLocatorResults({
      runId,
      assignedToId: user.id,
      pipelineStageId: stage.id,
      rows: [baseRow(result.id)],
    });

    const company = await testPrisma.company.findFirstOrThrow({ where: { name: "The Copper Kettle" } });
    expect(company.competitorId).toBe(competitor.id);
    expect(company.competitorTriviaProvider).toBe("Geeks Who Drink (branded event)");
    expect(company.competitorTriviaDay).toBe("TUESDAY");
  });

  it("writes competitorTriviaProvider/Day alongside competitorId when merging into an existing company", async () => {
    const { user, leadType, stage, competitor, runId, search } = await baseFixtures();
    await loginAs(user.id);
    const existing = await createCompanyFixture({
      name: "The Copper Kettle",
      leadTypeId: leadType.id,
      pipelineStageId: stage.id,
      assignedToId: user.id,
      createdById: user.id,
      city: "Milton",
      region: "ON",
    });
    const result = await createSearchResultFixture({
      searchId: search.id,
      name: "The Copper Kettle",
      competitorName: "Geeks Who Drink",
      day: "WEDNESDAY",
      duplicateMatches: [{ companyId: existing.id, companyName: existing.name, score: 90, confidence: "HIGH", reasons: [], matchedFields: ["name"], conflictingFields: [] }],
      duplicateConfidence: "HIGH",
    });

    await saveCompetitionLocatorResults({
      runId,
      assignedToId: user.id,
      pipelineStageId: stage.id,
      rows: [baseRow(result.id, { duplicateResolution: "merge" })],
    });

    const updated = await testPrisma.company.findUniqueOrThrow({ where: { id: existing.id } });
    expect(updated.competitorId).toBe(competitor.id);
    expect(updated.competitorTriviaProvider).toBe("Geeks Who Drink");
    expect(updated.competitorTriviaDay).toBe("WEDNESDAY");
  });

  it("sets normalizedCity/Region/PostalCode on a created company, so a same-name-different-city venue is never treated as an unqualified tie", async () => {
    const { user, leadType, stage, competitor, runId, search } = await baseFixtures();
    await loginAs(user.id);

    // Thin "chain name, no address yet" result for a real Oakville location.
    const oakvilleResult = await createSearchResultFixture({ searchId: search.id, name: "Boston Pizza", city: "Oakville", competitorId: competitor.id });
    await saveCompetitionLocatorResults({ runId, assignedToId: user.id, pipelineStageId: stage.id, rows: [baseRow(oakvilleResult.id)] });

    // A second, genuinely different real location sharing the chain name,
    // from a separate run.
    const search2 = await createLeadSearchFixture({ createdById: user.id, leadTypeId: leadType.id, mode: "COMPETITOR", competitorId: competitor.id, runCorrelationId: "run-2" });
    const mississaugaResult = await createSearchResultFixture({ searchId: search2.id, name: "Boston Pizza", city: "Mississauga", competitorId: competitor.id });
    await saveCompetitionLocatorResults({ runId: "run-2", assignedToId: user.id, pipelineStageId: stage.id, rows: [baseRow(mississaugaResult.id)] });

    const oakville = await testPrisma.company.findFirstOrThrow({ where: { city: "Oakville", name: "Boston Pizza" } });
    const mississauga = await testPrisma.company.findFirstOrThrow({ where: { city: "Mississauga", name: "Boston Pizza" } });
    expect(oakville.normalizedCity).toBeTruthy();
    expect(mississauga.normalizedCity).toBeTruthy();
    expect(oakville.normalizedCity).not.toBe(mississauga.normalizedCity);

    // A later, better-specified Oakville candidate (same name, real address)
    // must top-match the Oakville company, not tie with Mississauga's —
    // confirmed live: before normalizedCity was set on create, both scored
    // an identical LOW/20 name-only match with no city conflict recorded,
    // and "topMatch" picked whichever the DB happened to return first.
    const matches = await findScoredDuplicateMatches(testPrisma, {
      name: "Boston Pizza",
      address1: "499 Dundas St W",
      city: "Oakville",
      region: "ON",
      country: "Canada",
    });
    expect(matches[0].companyId).toBe(oakville.id);
    const mississaugaMatch = matches.find((m) => m.companyId === mississauga.id);
    expect(mississaugaMatch?.conflictingFields).toContain("city");
  });

  it("merges into the matched existing company using per-field decisions", async () => {
    const { user, leadType, stage, competitor, runId, search } = await baseFixtures();
    await loginAs(user.id);
    const existing = await createCompanyFixture({
      name: "The Copper Kettle",
      leadTypeId: leadType.id,
      pipelineStageId: stage.id,
      assignedToId: user.id,
      createdById: user.id,
      city: "Milton",
      region: "ON",
    });
    // existing has no phone on file — the fresh phone should fill it in
    // (classifyField "new") even with no explicit decision.
    const result = await createSearchResultFixture({
      searchId: search.id,
      name: "The Copper Kettle",
      phone: "555-0100",
      duplicateMatches: [{ companyId: existing.id, companyName: existing.name, score: 90, confidence: "HIGH", reasons: [], matchedFields: ["name"], conflictingFields: [] }],
      duplicateConfidence: "HIGH",
    });

    const outcome = await saveCompetitionLocatorResults({
      runId,
      assignedToId: user.id,
      pipelineStageId: stage.id,
      rows: [baseRow(result.id, { duplicateResolution: "merge" })],
    });

    expect(outcome).toMatchObject({ createdCount: 0, updatedCount: 1 });
    const updated = await testPrisma.company.findUniqueOrThrow({ where: { id: existing.id } });
    expect(updated.phone).toBe("555-0100");
    // No competitor conflict on this row (existing had none) — competitor
    // should be assigned automatically.
    expect(updated.competitorId).toBe(competitor.id);

    const companyCount = await testPrisma.company.count();
    expect(companyCount).toBe(1); // no new company created
  });

  it("applies an explicit override decision for a conflicting field", async () => {
    const { user, leadType, stage, runId, search } = await baseFixtures();
    await loginAs(user.id);
    const existing = await createCompanyFixture({
      name: "The Copper Kettle",
      leadTypeId: leadType.id,
      pipelineStageId: stage.id,
      assignedToId: user.id,
      createdById: user.id,
    });
    await testPrisma.company.update({ where: { id: existing.id }, data: { phone: "555-0100" } });
    const result = await createSearchResultFixture({
      searchId: search.id,
      name: "The Copper Kettle",
      phone: "555-0199",
      duplicateMatches: [{ companyId: existing.id, companyName: existing.name, score: 90, confidence: "HIGH", reasons: [], matchedFields: ["name"], conflictingFields: ["phone"] }],
      duplicateConfidence: "HIGH",
    });

    await saveCompetitionLocatorResults({
      runId,
      assignedToId: user.id,
      pipelineStageId: stage.id,
      rows: [baseRow(result.id, { duplicateResolution: "merge", fieldDecisions: { phone: { mode: "override", value: "555-0111" } } })],
    });

    const updated = await testPrisma.company.findUniqueOrThrow({ where: { id: existing.id } });
    expect(updated.phone).toBe("555-0111");
  });

  it("never overwrites the existing competitor on a conflict unless explicitly approved", async () => {
    const { user, leadType, stage, competitor, runId, search } = await baseFixtures();
    await loginAs(user.id);
    const otherCompetitor = await createCompetitorFixture("Trivia Kings");
    const existing = await createCompanyFixture({
      name: "The Copper Kettle",
      leadTypeId: leadType.id,
      pipelineStageId: stage.id,
      assignedToId: user.id,
      createdById: user.id,
      competitorId: otherCompetitor.id,
    });
    const result = await createSearchResultFixture({
      searchId: search.id,
      name: "The Copper Kettle",
      duplicateMatches: [{ companyId: existing.id, companyName: existing.name, score: 90, confidence: "HIGH", reasons: [], matchedFields: ["name"], conflictingFields: [] }],
      duplicateConfidence: "HIGH",
      competitorConflict: true,
    });

    // Default resolution (no explicit competitorConflictResolution) — must
    // leave the existing competitor untouched.
    await saveCompetitionLocatorResults({
      runId,
      assignedToId: user.id,
      pipelineStageId: stage.id,
      rows: [baseRow(result.id, { duplicateResolution: "merge" })],
    });

    const afterDefault = await testPrisma.company.findUniqueOrThrow({ where: { id: existing.id } });
    expect(afterDefault.competitorId).toBe(otherCompetitor.id);
    expect(competitor.id).not.toBe(otherCompetitor.id);
  });

  it("assigns the new competitor on a conflict only when explicitly approved via assignAnyway", async () => {
    const { user, leadType, stage, competitor, runId, search } = await baseFixtures();
    await loginAs(user.id);
    const otherCompetitor = await createCompetitorFixture("Trivia Kings");
    const existing = await createCompanyFixture({
      name: "The Copper Kettle",
      leadTypeId: leadType.id,
      pipelineStageId: stage.id,
      assignedToId: user.id,
      createdById: user.id,
      competitorId: otherCompetitor.id,
    });
    const result = await createSearchResultFixture({
      searchId: search.id,
      name: "The Copper Kettle",
      duplicateMatches: [{ companyId: existing.id, companyName: existing.name, score: 90, confidence: "HIGH", reasons: [], matchedFields: ["name"], conflictingFields: [] }],
      duplicateConfidence: "HIGH",
      competitorConflict: true,
    });

    await saveCompetitionLocatorResults({
      runId,
      assignedToId: user.id,
      pipelineStageId: stage.id,
      rows: [baseRow(result.id, { duplicateResolution: "merge", competitorConflictResolution: "assignAnyway" })],
    });

    const updated = await testPrisma.company.findUniqueOrThrow({ where: { id: existing.id } });
    expect(updated.competitorId).toBe(competitor.id);
  });

  it("skips a competitor-conflict row entirely when resolution is skip", async () => {
    const { user, leadType, stage, runId, search } = await baseFixtures();
    await loginAs(user.id);
    const otherCompetitor = await createCompetitorFixture("Trivia Kings");
    const existing = await createCompanyFixture({
      name: "The Copper Kettle",
      leadTypeId: leadType.id,
      pipelineStageId: stage.id,
      assignedToId: user.id,
      createdById: user.id,
      competitorId: otherCompetitor.id,
      city: "Milton",
    });
    const result = await createSearchResultFixture({
      searchId: search.id,
      name: "The Copper Kettle",
      phone: "555-9999",
      duplicateMatches: [{ companyId: existing.id, companyName: existing.name, score: 90, confidence: "HIGH", reasons: [], matchedFields: ["name"], conflictingFields: [] }],
      duplicateConfidence: "HIGH",
      competitorConflict: true,
    });

    const outcome = await saveCompetitionLocatorResults({
      runId,
      assignedToId: user.id,
      pipelineStageId: stage.id,
      rows: [baseRow(result.id, { competitorConflictResolution: "skip" })],
    });

    expect(outcome).toMatchObject({ createdCount: 0, updatedCount: 0, ignoredCount: 1 });
    const unchanged = await testPrisma.company.findUniqueOrThrow({ where: { id: existing.id } });
    expect(unchanged.phone).toBeNull(); // nothing was written
    const untouchedResult = await testPrisma.searchResult.findUniqueOrThrow({ where: { id: result.id } });
    expect(untouchedResult.disposition).not.toBe("TRANSFERRED");
  });

  it("creates every approved contact, skipping one that normalized-matches an existing contact", async () => {
    const { user, leadType, stage, runId, search } = await baseFixtures();
    await loginAs(user.id);
    const existing = await createCompanyFixture({
      name: "The Copper Kettle",
      leadTypeId: leadType.id,
      pipelineStageId: stage.id,
      assignedToId: user.id,
      createdById: user.id,
    });
    await testPrisma.contact.create({
      data: { companyId: existing.id, firstName: "Jane", lastName: "Doe", normalizedFirstName: "jane", normalizedLastName: "doe" },
    });
    const result = await createSearchResultFixture({
      searchId: search.id,
      name: "The Copper Kettle",
      duplicateMatches: [{ companyId: existing.id, companyName: existing.name, score: 90, confidence: "HIGH", reasons: [], matchedFields: ["name"], conflictingFields: [] }],
      duplicateConfidence: "HIGH",
    });

    const outcome = await saveCompetitionLocatorResults({
      runId,
      assignedToId: user.id,
      pipelineStageId: stage.id,
      rows: [
        baseRow(result.id, {
          duplicateResolution: "merge",
          contacts: [
            { firstName: "Jane", lastName: "Doe" }, // duplicate of the existing contact
            { firstName: "Sam", lastName: "Manager", title: "General Manager" },
          ],
        }),
      ],
    });

    expect(outcome).toMatchObject({ skippedContactCount: 1 });
    const contacts = await testPrisma.contact.findMany({ where: { companyId: existing.id } });
    expect(contacts).toHaveLength(2); // Jane (pre-existing) + Sam (new) — not a duplicated Jane
    expect(contacts.some((c) => c.firstName === "Sam")).toBe(true);
  });

  it("writes an audit event with the run's correlationId for each saved row", async () => {
    const { user, stage, competitor, runId, search } = await baseFixtures();
    await loginAs(user.id);
    const result = await createSearchResultFixture({ searchId: search.id, name: "The Copper Kettle", competitorId: competitor.id });

    await saveCompetitionLocatorResults({
      runId,
      assignedToId: user.id,
      pipelineStageId: stage.id,
      rows: [baseRow(result.id)],
    });

    const events = await testPrisma.auditEvent.findMany({ where: { correlationId: runId, action: "competition_locator.result_saved" } });
    expect(events).toHaveLength(1);
    expect(events[0].actorId).toBe(user.id);
  });

  it("requires the transfer_leads permission", async () => {
    const role = await createRoleWithPermissions("Salesperson", []);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);
    const leadType = await createLeadTypeFixture("Pub");
    const stage = await createPipelineStageFixture("New", { isDefault: true });
    const search = await createLeadSearchFixture({ createdById: user.id, leadTypeId: leadType.id, mode: "COMPETITOR", runCorrelationId: "run-x" });
    const result = await createSearchResultFixture({ searchId: search.id });

    await expect(
      saveCompetitionLocatorResults({ runId: "run-x", assignedToId: user.id, pipelineStageId: stage.id, rows: [baseRow(result.id)] }),
    ).rejects.toThrow();
  });
});
