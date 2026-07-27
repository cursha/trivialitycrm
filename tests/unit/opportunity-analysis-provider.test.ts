import { describe, it, expect } from "vitest";
import { MockOpportunityAnalysisProvider } from "../../src/lib/research/providers/mock";
import { EOS_CATEGORY_MAXIMA } from "../../src/lib/eos/constants";
import type { OpportunityAnalysisInput } from "../../src/lib/research/providers/types";

const baseInput: OpportunityAnalysisInput = {
  name: "The Milton Arms",
  address1: "123 Main St",
  city: "Milton",
  region: "ON",
  postalCode: null,
  country: "Canada",
  phone: "(905) 555-0100",
  email: null,
  websiteUrl: "https://miltonarms.example.test",
  notes: null,
  leadTypeName: "Pub Trivia",
};

describe("MockOpportunityAnalysisProvider", () => {
  it("returns a category score for every fixed EOS category, each within its maximum", async () => {
    const result = await new MockOpportunityAnalysisProvider().analyze(baseInput);

    for (const key of Object.keys(EOS_CATEGORY_MAXIMA) as (keyof typeof EOS_CATEGORY_MAXIMA)[]) {
      expect(result.categoryScores[key]).toBeGreaterThanOrEqual(0);
      expect(result.categoryScores[key]).toBeLessThanOrEqual(EOS_CATEGORY_MAXIMA[key]);
    }
  });

  it("fills foundEmail only when the company has no email on file", async () => {
    const withoutEmail = await new MockOpportunityAnalysisProvider().analyze(baseInput);
    expect(withoutEmail.foundEmail).not.toBeNull();

    const withEmail = await new MockOpportunityAnalysisProvider().analyze({ ...baseInput, email: "owner@miltonarms.example.test" });
    expect(withEmail.foundEmail).toBeNull();
  });

  it("never flags a conflict by default", async () => {
    const result = await new MockOpportunityAnalysisProvider().analyze(baseInput);
    expect(result.conflict.found).toBe(false);
    expect(result.conflict.reason).toBeNull();
  });

  it("deterministically flags a conflict when notes contain the MOCK_CONFLICT marker", async () => {
    const result = await new MockOpportunityAnalysisProvider().analyze({ ...baseInput, notes: "Some notes. MOCK_CONFLICT" });
    expect(result.conflict.found).toBe(true);
    expect(result.conflict.reason).toBeTruthy();
  });

  it("leaves hasTvs null (unconfirmed) by default", async () => {
    const result = await new MockOpportunityAnalysisProvider().analyze(baseInput);
    expect(result.hasTvs).toBeNull();
  });

  it("deterministically reports hasTvs false when notes contain the MOCK_NO_TVS marker", async () => {
    const result = await new MockOpportunityAnalysisProvider().analyze({ ...baseInput, notes: "Some notes. MOCK_NO_TVS" });
    expect(result.hasTvs).toBe(false);
  });

  it("produces at least one evidence entry with a category from the fixed rubric", async () => {
    const result = await new MockOpportunityAnalysisProvider().analyze(baseInput);
    expect(result.evidence.length).toBeGreaterThan(0);
    expect(Object.values(EOS_CATEGORY_MAXIMA).length).toBeGreaterThan(0);
    expect(result.evidence[0].category).toBe("FOOD_BEVERAGE_FOCUS");
  });

  it("reports progress events when a callback is given, matching the streaming Route Handler's contract", async () => {
    const messages: string[] = [];
    await new MockOpportunityAnalysisProvider().analyze(baseInput, (event) => messages.push(event.message));

    expect(messages.length).toBeGreaterThanOrEqual(2);
    expect(messages.some((m) => m.includes("Searching the web"))).toBe(true);
  });

  it("works fine with no onProgress callback given", async () => {
    await expect(new MockOpportunityAnalysisProvider().analyze(baseInput)).resolves.toBeTruthy();
  });
});
