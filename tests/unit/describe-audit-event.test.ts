import { describe, it, expect } from "vitest";
import { describeAuditEvent } from "../../src/lib/audit/describe";

describe("describeAuditEvent", () => {
  it("describes a known successful event", () => {
    expect(describeAuditEvent({ module: "users", action: "user.disabled", success: true })).toBe("A user account was deactivated.");
  });

  it("prefixes a blocked/failed event distinctly", () => {
    const result = describeAuditEvent({ module: "users", action: "user.disabled", success: false });
    expect(result).toMatch(/^Blocked:/);
  });

  it("incorporates metadata when available", () => {
    const result = describeAuditEvent({ module: "ownership", action: "ownership.companies_transferred", success: true, metadata: { companyCount: "3" } });
    expect(result).toContain("3 companies");
  });

  it("falls back to a humanized module/action for an unmapped event, rather than crashing", () => {
    const result = describeAuditEvent({ module: "future-module", action: "did_a_thing", success: true });
    expect(result).toContain("future-module");
    expect(result).toContain("did a thing");
  });
});
