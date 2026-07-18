import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getProviders } from "../../src/lib/research/providers/factory";
import type { DiscoverParams } from "../../src/lib/research/providers/types";

const baseParams: DiscoverParams = {
  promptText: "Independent pubs with a weekly events calendar",
  country: "Canada",
  region: "ON",
  cities: ["Milton", "Oakville"],
  leadTypeName: "Pub",
  mode: "GENERAL",
};

describe("provider factory", () => {
  const originalProvider = process.env.AI_PROVIDER;

  afterEach(() => {
    process.env.AI_PROVIDER = originalProvider;
  });

  it("defaults to the mock provider when AI_PROVIDER is unset", () => {
    delete process.env.AI_PROVIDER;
    const providers = getProviders();
    expect(providers.discovery.constructor.name).toBe("MockCandidateDiscoveryProvider");
  });

  it("throws on an unknown provider rather than silently falling back", () => {
    process.env.AI_PROVIDER = "not-a-real-provider";
    expect(() => getProviders()).toThrow(/Unknown AI_PROVIDER/);
  });
});

describe("mock discovery provider", () => {
  beforeEach(() => {
    process.env.AI_PROVIDER = "mock";
  });

  it("returns one candidate per requested city", async () => {
    const { discovery } = getProviders();
    const candidates = await discovery.discover(baseParams);
    expect(candidates).toHaveLength(2);
    expect(candidates[0].city).toBe("Milton");
    expect(candidates[1].city).toBe("Oakville");
  });

  it("falls back to a statewide candidate when cities is empty", async () => {
    const { discovery } = getProviders();
    const candidates = await discovery.discover({ ...baseParams, cities: [] });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].region).toBe("ON");
  });

  it("sets competitorName only in COMPETITOR mode", async () => {
    const { discovery } = getProviders();
    const competitorCandidates = await discovery.discover({ ...baseParams, mode: "COMPETITOR", competitorName: "Geeks Who Drink" });
    expect(competitorCandidates.every((c) => c.competitorName === "Geeks Who Drink")).toBe(true);

    const generalCandidates = await discovery.discover(baseParams);
    expect(generalCandidates.every((c) => c.competitorName === null)).toBe(true);
  });

  it("never marks a candidate CURRENT_TRIVIA in TRIVIA_GAP mode", async () => {
    const { discovery } = getProviders();
    const candidates = await discovery.discover({ ...baseParams, mode: "TRIVIA_GAP" });
    expect(candidates.every((c) => c.triviaStatus !== "CURRENT_TRIVIA")).toBe(true);
  });
});

describe("mock verification and scoring providers", () => {
  beforeEach(() => {
    process.env.AI_PROVIDER = "mock";
  });

  it("verification adds at least one evidence entry with a citation", async () => {
    const { discovery, verification } = getProviders();
    const [candidate] = await discovery.discover(baseParams);
    const verified = await verification.verify(candidate, baseParams);
    expect(verified.evidence.length).toBeGreaterThan(0);
    expect(verified.sources.length).toBeGreaterThan(0);
  });

  it("score is deterministic and bounded 0-100", async () => {
    const { discovery, verification, scoring } = getProviders();
    const [candidate] = await discovery.discover(baseParams);
    const verified = await verification.verify(candidate, baseParams);

    const first = await scoring.score(verified, baseParams);
    const second = await scoring.score(verified, baseParams);

    expect(first.score).toBe(second.score);
    expect(first.score).toBeGreaterThanOrEqual(0);
    expect(first.score).toBeLessThanOrEqual(100);
  });
});
