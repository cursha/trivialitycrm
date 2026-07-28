import { describe, it, expect } from "vitest";
import { resolveContactRowDefault, resolveCompanyPageDefault } from "../../src/lib/comms/recipient";

describe("resolveContactRowDefault", () => {
  it("defaults to the contact when it has an email", () => {
    expect(resolveContactRowDefault({ id: "c1", email: "a@example.com" })).toBe("c1");
  });

  it("has no default when the contact lacks an email", () => {
    expect(resolveContactRowDefault({ id: "c1", email: null })).toBeNull();
  });
});

describe("resolveCompanyPageDefault", () => {
  it("defaults to the primary contact when set and it has an email", () => {
    expect(resolveCompanyPageDefault({ id: "c1", email: "a@example.com" })).toBe("c1");
  });

  it("has no default when there is no primary contact", () => {
    expect(resolveCompanyPageDefault(null)).toBeNull();
  });

  it("has no default when the primary contact has lost its email", () => {
    expect(resolveCompanyPageDefault({ id: "c1", email: null })).toBeNull();
  });
});
