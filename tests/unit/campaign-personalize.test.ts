import { describe, it, expect } from "vitest";
import { MockCampaignPersonalizationProvider } from "../../src/lib/campaigns/personalize";

describe("MockCampaignPersonalizationProvider", () => {
  it("always includes the literal, unresolved unsubscribeLink token", async () => {
    const provider = new MockCampaignPersonalizationProvider();
    const result = await provider.generate({
      company: { name: "The Copper Kettle", city: "Milton", region: "ON", leadTypeName: "Pub", scoreExplanation: null, verifiedEvidenceSummary: null, triviaStatus: "UNCERTAIN", competitorTriviaProvider: null },
      contact: { firstName: "Jamie", lastName: "Lee", title: null },
      campaignInstructions: "Mention our new trivia offering.",
      reusableInstructions: null,
      templateGuidance: null,
    });
    expect(result.body).toContain("{{unsubscribeLink}}");
  });

  it("never fabricates a real unsubscribe URL — the token stays literal", async () => {
    const provider = new MockCampaignPersonalizationProvider();
    const result = await provider.generate({
      company: { name: "Co", city: "Milton", region: "ON", leadTypeName: "Pub", scoreExplanation: null, verifiedEvidenceSummary: null, triviaStatus: "UNCERTAIN", competitorTriviaProvider: null },
      contact: { firstName: "Jamie", lastName: "Lee", title: null },
      campaignInstructions: "",
      reusableInstructions: null,
      templateGuidance: null,
    });
    expect(result.body).not.toMatch(/https?:\/\//);
  });

  it("personalizes the subject and body with the company's own name and location, not invented details", async () => {
    const provider = new MockCampaignPersonalizationProvider();
    const result = await provider.generate({
      company: { name: "The Copper Kettle", city: "Milton", region: "ON", leadTypeName: "Pub", scoreExplanation: null, verifiedEvidenceSummary: null, triviaStatus: "UNCERTAIN", competitorTriviaProvider: null },
      contact: { firstName: "Jamie", lastName: "Lee", title: null },
      campaignInstructions: "",
      reusableInstructions: null,
      templateGuidance: null,
    });
    expect(result.subject).toContain("The Copper Kettle");
    expect(result.body).toContain("Jamie");
    expect(result.body).toContain("Milton");
  });
});
