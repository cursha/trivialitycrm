import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createCompetitorFixture } from "../helpers/fixtures";
import { findOrCreateCompetitor } from "../../src/lib/competitors/find-or-create";

beforeEach(async () => {
  await resetDatabase();
});

describe("findOrCreateCompetitor", () => {
  it("links to an existing Competitor on an exact case-insensitive match instead of creating a duplicate", async () => {
    const competitor = await createCompetitorFixture("Geeks Who Drink");

    const resolved = await findOrCreateCompetitor(testPrisma, "geeks who drink");

    expect(resolved.id).toBe(competitor.id);
    expect(await testPrisma.competitor.count()).toBe(1);
  });

  it("creates a new Competitor when no name matches", async () => {
    const resolved = await findOrCreateCompetitor(testPrisma, "Trivia Nation");

    expect(resolved.name).toBe("Trivia Nation");
    const stored = await testPrisma.competitor.findUniqueOrThrow({ where: { id: resolved.id } });
    expect(stored.name).toBe("Trivia Nation");
  });

  it("reuses the same row across repeat calls for the same name rather than creating duplicates", async () => {
    const first = await findOrCreateCompetitor(testPrisma, "Trivia Nation");
    const second = await findOrCreateCompetitor(testPrisma, "Trivia Nation");

    expect(second.id).toBe(first.id);
    expect(await testPrisma.competitor.count({ where: { name: "Trivia Nation" } })).toBe(1);
  });

  it("trims whitespace before matching/creating", async () => {
    const competitor = await createCompetitorFixture("Geeks Who Drink");

    const resolved = await findOrCreateCompetitor(testPrisma, "  Geeks Who Drink  ");

    expect(resolved.id).toBe(competitor.id);
  });
});
