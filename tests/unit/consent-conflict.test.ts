import { describe, it, expect } from "vitest";
import { resolveConsentConflict } from "../../src/lib/data-quality/consent-conflict";

describe("resolveConsentConflict", () => {
  it("requires both contacts to permit email for the merged result to permit it", () => {
    const permitted = { emailPermitted: true, doNotContact: false, unsubscribedAt: null, unsubscribeSource: null };
    const notPermitted = { emailPermitted: false, doNotContact: false, unsubscribedAt: null, unsubscribeSource: null };
    expect(resolveConsentConflict(permitted, permitted).emailPermitted).toBe(true);
    expect(resolveConsentConflict(permitted, notPermitted).emailPermitted).toBe(false);
  });

  it("doNotContact on either side wins", () => {
    const a = { emailPermitted: true, doNotContact: false, unsubscribedAt: null, unsubscribeSource: null };
    const b = { emailPermitted: true, doNotContact: true, unsubscribedAt: null, unsubscribeSource: null };
    const result = resolveConsentConflict(a, b);
    expect(result.doNotContact).toBe(true);
    expect(result.emailPermitted).toBe(false);
  });

  it("keeps the earliest unsubscribedAt when both are unsubscribed", () => {
    const earlier = new Date("2024-01-01");
    const later = new Date("2024-06-01");
    const a = { emailPermitted: false, doNotContact: true, unsubscribedAt: later, unsubscribeSource: "later-source" };
    const b = { emailPermitted: false, doNotContact: true, unsubscribedAt: earlier, unsubscribeSource: "earlier-source" };
    const result = resolveConsentConflict(a, b);
    expect(result.unsubscribedAt).toEqual(earlier);
    expect(result.unsubscribeSource).toBe("earlier-source");
  });

  it("preserves a single unsubscribedAt when only one side has one", () => {
    const when = new Date("2024-01-01");
    const a = { emailPermitted: false, doNotContact: true, unsubscribedAt: when, unsubscribeSource: "src" };
    const b = { emailPermitted: true, doNotContact: false, unsubscribedAt: null, unsubscribeSource: null };
    const result = resolveConsentConflict(a, b);
    expect(result.unsubscribedAt).toEqual(when);
  });
});
