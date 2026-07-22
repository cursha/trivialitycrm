import { describe, it, expect } from "vitest";
import { scoreContactMatch, type ContactMatchInput } from "../../src/lib/data-quality/contact-match";

function contact(overrides: Partial<ContactMatchInput>): ContactMatchInput {
  return {
    id: "1",
    companyId: "company-1",
    firstName: "Jane",
    lastName: "Doe",
    normalizedFirstName: "jane",
    normalizedLastName: "doe",
    phone: "9055550134",
    normalizedPhone: "9055550134",
    email: "jane@example-real.com",
    normalizedEmail: "jane@example-real.com",
    ...overrides,
  };
}

describe("scoreContactMatch", () => {
  it("scores an exact email + name + same-company match as HIGH confidence", () => {
    const result = scoreContactMatch(contact({ id: "1" }), contact({ id: "2" }));
    expect(result.confidence).toBe("HIGH");
    expect(result.matchedFields).toEqual(expect.arrayContaining(["email", "firstName", "lastName", "companyId"]));
  });

  it("never reaches HIGH/MEDIUM confidence from a fuzzy name match alone, across different companies", () => {
    const a = contact({ id: "1", companyId: "company-1", phone: null, normalizedPhone: null, email: null, normalizedEmail: null, firstName: "Jon", normalizedFirstName: "jon" });
    const b = contact({ id: "2", companyId: "company-2", phone: null, normalizedPhone: null, email: null, normalizedEmail: null, firstName: "John", normalizedFirstName: "john" });
    const result = scoreContactMatch(a, b);
    expect(result.confidence).toBe("LOW");
  });

  it("flags a conflicting email when both have different values", () => {
    const a = contact({ id: "1", email: "a@example.com", normalizedEmail: "a@example.com" });
    const b = contact({ id: "2", email: "b@example.com", normalizedEmail: "b@example.com" });
    const result = scoreContactMatch(a, b);
    expect(result.conflictingFields).toContain("email");
  });
});
