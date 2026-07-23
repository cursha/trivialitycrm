import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getProviders } from "../../src/lib/research/providers/factory";
import type { DiscoverParams } from "../../src/lib/research/providers/types";

// TRIVIA_GAP, not GENERAL — GENERAL now routes to the mock *places* provider
// by default (see factory.ts's mode-aware discovery routing); these tests
// exercise the AI-mode mock discovery provider specifically.
const baseParams: DiscoverParams = {
  promptText: "Independent pubs with a weekly events calendar",
  country: "Canada",
  region: "ON",
  cities: ["Milton", "Oakville"],
  leadTypeName: "Pub",
  mode: "TRIVIA_GAP",
};

describe("provider factory", () => {
  const originalAiProvider = process.env.AI_PROVIDER;
  const originalPlacesProvider = process.env.PLACES_PROVIDER;
  const mutableEnv = process.env as Record<string, string | undefined>;

  // Assigning `undefined` directly to a process.env property stringifies it
  // to the literal string "undefined" rather than deleting it — restore via
  // delete when the original was unset, matching tests/unit/env.test.ts's
  // own restoreEnv() convention.
  afterEach(() => {
    if (originalAiProvider === undefined) delete mutableEnv.AI_PROVIDER;
    else mutableEnv.AI_PROVIDER = originalAiProvider;
    if (originalPlacesProvider === undefined) delete mutableEnv.PLACES_PROVIDER;
    else mutableEnv.PLACES_PROVIDER = originalPlacesProvider;
  });

  it("defaults to the mock AI discovery provider for non-GENERAL modes when AI_PROVIDER is unset", () => {
    delete process.env.AI_PROVIDER;
    const providers = getProviders("TRIVIA_GAP");
    expect(providers.discovery.constructor.name).toBe("MockCandidateDiscoveryProvider");
  });

  it("throws on an unknown AI_PROVIDER rather than silently falling back", () => {
    process.env.AI_PROVIDER = "not-a-real-provider";
    expect(() => getProviders("TRIVIA_GAP")).toThrow(/Unknown AI_PROVIDER/);
  });

  it("throws on an unknown PLACES_PROVIDER rather than silently falling back", () => {
    process.env.AI_PROVIDER = "mock";
    process.env.PLACES_PROVIDER = "not-a-real-provider";
    expect(() => getProviders("GENERAL")).toThrow(/Unknown PLACES_PROVIDER/);
  });

  // Regression: GENERAL mode is the whole point of the directory-search
  // redesign — it must not silently fall through to the (expensive, slow)
  // AI discovery provider just because PLACES_PROVIDER is unset.
  it("GENERAL mode uses the mock places (directory) provider by default, not AI discovery", () => {
    delete process.env.AI_PROVIDER;
    delete process.env.PLACES_PROVIDER;
    const providers = getProviders("GENERAL");
    expect(providers.discovery.constructor.name).toBe("MockPlacesProvider");
  });

  it("non-GENERAL modes always use AI discovery, even if PLACES_PROVIDER is set to google — a directory API can't answer a trivia/competitor question", () => {
    process.env.AI_PROVIDER = "mock";
    process.env.PLACES_PROVIDER = "google";
    const providers = getProviders("TRIVIA_CONFIRMED");
    expect(providers.discovery.constructor.name).toBe("MockCandidateDiscoveryProvider");
  });

  it("verification/scoring/promptAssistant are never mode-dependent — always selected by AI_PROVIDER alone", () => {
    process.env.AI_PROVIDER = "mock";
    process.env.PLACES_PROVIDER = "google";
    const providers = getProviders("GENERAL");
    expect(providers.verification.constructor.name).toBe("MockEvidenceVerificationProvider");
    expect(providers.scoring.constructor.name).toBe("MockScoringProvider");
    expect(providers.promptAssistant.constructor.name).toBe("MockPromptAssistant");
  });
});

describe("mock AI discovery provider (TRIVIA_GAP/TRIVIA_CONFIRMED/COMPETITOR modes)", () => {
  beforeEach(() => {
    process.env.AI_PROVIDER = "mock";
  });

  it("returns one candidate per requested city", async () => {
    const { discovery } = getProviders("TRIVIA_GAP");
    const candidates = await discovery.discover(baseParams);
    expect(candidates).toHaveLength(2);
    expect(candidates[0].city).toBe("Milton");
    expect(candidates[1].city).toBe("Oakville");
  });

  it("falls back to a statewide candidate when cities is empty", async () => {
    const { discovery } = getProviders("TRIVIA_GAP");
    const candidates = await discovery.discover({ ...baseParams, cities: [] });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].region).toBe("ON");
  });

  it("sets competitorName only in COMPETITOR mode", async () => {
    const competitorDiscovery = getProviders("COMPETITOR").discovery;
    const competitorCandidates = await competitorDiscovery.discover({ ...baseParams, mode: "COMPETITOR", competitorName: "Geeks Who Drink" });
    expect(competitorCandidates.every((c) => c.competitorName === "Geeks Who Drink")).toBe(true);

    const gapDiscovery = getProviders("TRIVIA_GAP").discovery;
    const gapCandidates = await gapDiscovery.discover(baseParams);
    expect(gapCandidates.every((c) => c.competitorName === null)).toBe(true);
  });

  it("never marks a candidate CURRENT_TRIVIA in TRIVIA_GAP mode", async () => {
    const { discovery } = getProviders("TRIVIA_GAP");
    const candidates = await discovery.discover(baseParams);
    expect(candidates.every((c) => c.triviaStatus !== "CURRENT_TRIVIA")).toBe(true);
  });
});

describe("mock places (directory) discovery provider — GENERAL mode", () => {
  beforeEach(() => {
    process.env.PLACES_PROVIDER = "mock";
  });

  it("returns one candidate per requested city, all honestly UNCERTAIN with no evidence yet", async () => {
    const { discovery } = getProviders("GENERAL");
    const candidates = await discovery.discover({ ...baseParams, mode: "GENERAL" });
    expect(candidates).toHaveLength(2);
    expect(candidates.every((c) => c.triviaStatus === "UNCERTAIN")).toBe(true);
    expect(candidates.every((c) => c.evidence.length === 0 && c.sources.length === 0)).toBe(true);
    expect(candidates.every((c) => c.competitorName === null && c.contactData === null)).toBe(true);
  });

  it("still returns real-shaped contact fields (name/address/phone/website)", async () => {
    const { discovery } = getProviders("GENERAL");
    const [candidate] = await discovery.discover({ ...baseParams, mode: "GENERAL" });
    expect(candidate.name).toBeTruthy();
    expect(candidate.address1).toBeTruthy();
    expect(candidate.phone).toBeTruthy();
    expect(candidate.websiteUrl).toBeTruthy();
  });
});

describe("mock verification and scoring providers", () => {
  beforeEach(() => {
    process.env.AI_PROVIDER = "mock";
  });

  it("verification adds at least one evidence entry with a citation", async () => {
    const { discovery, verification } = getProviders("TRIVIA_GAP");
    const [candidate] = await discovery.discover(baseParams);
    const verified = await verification.verify(candidate, baseParams);
    expect(verified.evidence.length).toBeGreaterThan(0);
    expect(verified.sources.length).toBeGreaterThan(0);
  });

  it("score is deterministic and bounded 0-100", async () => {
    const { discovery, verification, scoring } = getProviders("TRIVIA_GAP");
    const [candidate] = await discovery.discover(baseParams);
    const verified = await verification.verify(candidate, baseParams);

    const first = await scoring.score(verified, baseParams);
    const second = await scoring.score(verified, baseParams);

    expect(first.score).toBe(second.score);
    expect(first.score).toBeGreaterThanOrEqual(0);
    expect(first.score).toBeLessThanOrEqual(100);
  });

  // Regression: verify()/score() must work identically on a directory-sourced
  // (GENERAL mode, UNCERTAIN, no evidence) candidate — this is exactly the
  // opt-in "Research this business" path's real code flow.
  it("verification and scoring also work on a directory-sourced candidate", async () => {
    process.env.PLACES_PROVIDER = "mock";
    const { discovery, verification, scoring } = getProviders("GENERAL");
    const [candidate] = await discovery.discover({ ...baseParams, mode: "GENERAL" });
    expect(candidate.triviaStatus).toBe("UNCERTAIN");

    const verified = await verification.verify(candidate, { ...baseParams, mode: "GENERAL" });
    expect(verified.evidence.length).toBeGreaterThan(0);

    const scored = await scoring.score(verified, { ...baseParams, mode: "GENERAL" });
    expect(scored.score).toBeGreaterThanOrEqual(0);
  });
});
