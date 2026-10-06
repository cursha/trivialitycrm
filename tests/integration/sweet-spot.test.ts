import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, createLeadTypeFixture, createPipelineStageFixture, createCompanyFixture } from "../helpers/fixtures";
import { assessLikelihood, getChainNames, sweetSpotWhere, type LikelihoodFields } from "../../src/lib/companies/sweet-spot";

beforeEach(async () => {
  await resetDatabase();
});

const base: LikelihoodFields = {
  normalizedName: "the copper kettle",
  eosScore: 72,
  hasTvs: true,
  triviaStatus: "NO_CURRENT_TRIVIA",
  competitorId: null,
  competitorTriviaProvider: null,
};

describe("assessLikelihood", () => {
  it("puts an independent bar with no hosted trivia and EOS 60-89 in the sweet spot", () => {
    const none = new Map<string, number>();
    expect(assessLikelihood(base, none)).toEqual({ sweetSpot: true, lessLikelyBecause: [] });
    expect(assessLikelihood({ ...base, eosScore: 60 }, none).sweetSpot).toBe(true);
    expect(assessLikelihood({ ...base, eosScore: 89 }, none).sweetSpot).toBe(true);
    expect(assessLikelihood({ ...base, hasTvs: null }, none).sweetSpot).toBe(true);
  });

  it("explains why other bars are less likely, without ruling them out", () => {
    const chains = new Map([["boston pizza", 4]]);
    expect(assessLikelihood({ ...base, eosScore: 94 }, chains).lessLikelyBecause).toEqual(["A top-scoring venue (EOS 94): these often buy hosted trivia"]);
    expect(assessLikelihood({ ...base, eosScore: 52 }, chains).lessLikelyBecause).toEqual(["EOS 52 is under 60: a weaker fit"]);
    expect(assessLikelihood({ ...base, eosScore: null }, chains).lessLikelyBecause).toEqual(["Not scored yet"]);
    expect(assessLikelihood({ ...base, normalizedName: "boston pizza" }, chains).lessLikelyBecause).toEqual([
      "Part of a chain (4 locations in the CRM): head office often decides",
    ]);
    expect(assessLikelihood({ ...base, competitorTriviaProvider: "Trivia Co" }, chains).lessLikelyBecause).toEqual(["Already runs trivia with Trivia Co"]);
    expect(assessLikelihood({ ...base, triviaStatus: "CURRENT_TRIVIA", hasTvs: false }, chains).lessLikelyBecause).toEqual(["Already runs trivia", "No TVs confirmed"]);
  });
});

describe("chains and the sweet-spot filter", () => {
  it("treats a name at 3+ active locations as a chain, and the filter matches the badge exactly", async () => {
    const role = await createRoleWithPermissions("Rep", ["view_all_leads"]);
    const user = await createTestUser({ roleId: role.id });
    const leadType = await createLeadTypeFixture();
    const stage = await createPipelineStageFixture();
    type MakeData = {
      city?: string;
      eosScore?: number | null;
      hasTvs?: boolean | null;
      triviaStatus?: "CURRENT_TRIVIA" | "NO_CURRENT_TRIVIA" | "UNCERTAIN";
    };
    const make = async (name: string, data: MakeData = {}) => {
      const { city, ...rest } = data;
      const company = await createCompanyFixture({ name, city, leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: null, createdById: user.id });
      return testPrisma.company.update({ where: { id: company.id }, data: { eosScore: 70, ...rest } });
    };

    for (const city of ["Oakville", "Milton", "Hamilton"]) await make("Boston Pizza", { city });
    const indie = await make("The Copper Kettle");
    await make("Two Location Pub", { city: "Oakville" });
    await make("Two Location Pub", { city: "Milton" });
    await make("Top Venue", { eosScore: 95 });
    await make("Hosted Bar", { triviaStatus: "CURRENT_TRIVIA" });
    await make("No TV Bar", { hasTvs: false });
    await make("Unscored Bar", { eosScore: null });

    const chains = await getChainNames();
    expect([...chains.entries()]).toEqual([["boston pizza", 3]]);

    const filtered = await testPrisma.company.findMany({ where: sweetSpotWhere(chains), select: { id: true, name: true }, orderBy: { name: "asc" } });
    expect(filtered.map((c) => c.name)).toEqual(["The Copper Kettle", "Two Location Pub", "Two Location Pub"]);

    const all = await testPrisma.company.findMany();
    const badged = all.filter((company) => assessLikelihood(company, chains).sweetSpot).map((c) => c.id).sort();
    expect(badged).toEqual(filtered.map((c) => c.id).sort());
    expect(badged).toContain(indie.id);
  });
});
