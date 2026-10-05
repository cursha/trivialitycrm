import { describe, it, expect } from "vitest";
import { scoreCompanyMatch, type CompanyMatchInput } from "../../src/lib/data-quality/company-match";

function company(overrides: Partial<CompanyMatchInput>): CompanyMatchInput {
  return {
    id: "1",
    name: "The Copper Kettle",
    normalizedName: "the copper kettle",
    address1: "123 Main St",
    city: "Toronto",
    region: "Ontario",
    country: "Canada",
    postalCode: "M5V 3A8",
    normalizedRegion: "ON",
    normalizedCity: "toronto",
    normalizedPostalCode: "M5V 3A8",
    phone: "9055550134",
    normalizedPhone: "9055550134",
    email: "sales@thecopperkettle.com",
    normalizedEmail: "sales@thecopperkettle.com",
    websiteUrl: "https://thecopperkettle.com",
    websiteDomain: "thecopperkettle.com",
    ...overrides,
  };
}

describe("scoreCompanyMatch", () => {
  it("scores an exact match on every field as HIGH confidence", () => {
    const a = company({ id: "1" });
    const b = company({ id: "2" });
    const result = scoreCompanyMatch(a, b);
    expect(result.confidence).toBe("HIGH");
    expect(result.score).toBeGreaterThanOrEqual(80);
    expect(result.matchedFields).toContain("email");
  });

  it("gives an exact email match alone HIGH confidence", () => {
    const a = company({ id: "1", normalizedName: "aaa", websiteDomain: "aaa.com", normalizedPhone: "1111111111", phone: "1111111111" });
    const b = company({ id: "2", name: "Totally Different", normalizedName: "totally different", websiteDomain: "bbb.com", normalizedPhone: "2222222222", phone: "2222222222" });
    const result = scoreCompanyMatch(a, b);
    expect(result.matchedFields).toContain("email");
    expect(result.reasons.some((r) => r.includes("Email"))).toBe(true);
  });

  it("never reaches HIGH or MEDIUM confidence from a fuzzy name match alone", () => {
    const a = company({
      id: "1",
      name: "The Copper Kettle",
      normalizedName: "the copper kettle",
      phone: null,
      normalizedPhone: null,
      email: null,
      normalizedEmail: null,
      websiteUrl: null,
      websiteDomain: null,
      address1: null,
      city: "Toronto",
      normalizedCity: "toronto",
      normalizedPostalCode: null,
    });
    const b = company({
      id: "2",
      name: "The Copper Kettel",
      normalizedName: "the copper kettel",
      phone: null,
      normalizedPhone: null,
      email: null,
      normalizedEmail: null,
      websiteUrl: null,
      websiteDomain: null,
      address1: null,
      city: "Vancouver",
      normalizedCity: "vancouver",
      normalizedPostalCode: null,
    });
    const result = scoreCompanyMatch(a, b);
    expect(result.confidence).toBe("LOW");
  });

  it("reports conflicting fields when a strong signal matched but another field disagrees", () => {
    const a = company({ id: "1" });
    const b = company({ id: "2", city: "Ottawa", normalizedCity: "ottawa" });
    const result = scoreCompanyMatch(a, b);
    expect(result.conflictingFields).toContain("city");
  });

  it("scores two entirely unrelated companies at 0 with LOW confidence", () => {
    const a = company({
      id: "1",
      name: "Alpha Diner",
      normalizedName: "alpha diner",
      phone: "1111111111",
      normalizedPhone: "1111111111",
      email: "a@alpha.com",
      normalizedEmail: "a@alpha.com",
      websiteDomain: "alpha.com",
      address1: "1 Alpha Way",
      postalCode: "A1A 1A1",
      normalizedPostalCode: "A1A 1A1",
      city: "Toronto",
      normalizedCity: "toronto",
    });
    const b = company({
      id: "2",
      name: "Zeta Bistro",
      normalizedName: "zeta bistro",
      phone: "2222222222",
      normalizedPhone: "2222222222",
      email: "z@zeta.com",
      normalizedEmail: "z@zeta.com",
      websiteDomain: "zeta.com",
      address1: "2 Zeta Blvd",
      postalCode: "Z9Z 9Z9",
      normalizedPostalCode: "Z9Z 9Z9",
      city: "Calgary",
      normalizedCity: "calgary",
    });
    const result = scoreCompanyMatch(a, b);
    expect(result.score).toBe(0);
    expect(result.confidence).toBe("LOW");
  });

  it("scores two unrelated companies that merely share a city/region at 0", () => {
    const a = company({
      id: "1",
      name: "Alpha Diner",
      normalizedName: "alpha diner",
      phone: "1111111111",
      normalizedPhone: "1111111111",
      email: "a@alpha.com",
      normalizedEmail: "a@alpha.com",
      websiteDomain: "alpha.com",
      address1: "1 Alpha Way",
      postalCode: "A1A 1A1",
      normalizedPostalCode: "A1A 1A1",
      city: "Toronto",
      normalizedCity: "toronto",
      region: "Ontario",
      normalizedRegion: "ON",
    });
    const b = company({
      id: "2",
      name: "Zeta Bistro",
      normalizedName: "zeta bistro",
      phone: "2222222222",
      normalizedPhone: "2222222222",
      email: "z@zeta.com",
      normalizedEmail: "z@zeta.com",
      websiteDomain: "zeta.com",
      address1: "2 Zeta Blvd",
      postalCode: "Z9Z 9Z9",
      normalizedPostalCode: "Z9Z 9Z9",
      city: "Toronto",
      normalizedCity: "toronto",
      region: "Ontario",
      normalizedRegion: "ON",
    });
    const result = scoreCompanyMatch(a, b);
    expect(result.score).toBe(0);
    expect(result.matchedFields).not.toContain("city");
  });

  it("still counts city/region as corroboration once a real identity signal matched", () => {
    const a = company({ id: "1", city: "Toronto", normalizedCity: "toronto", region: "Ontario", normalizedRegion: "ON" });
    const b = company({ id: "2", city: "Toronto", normalizedCity: "toronto", region: "Ontario", normalizedRegion: "ON" });
    const result = scoreCompanyMatch(a, b);
    expect(result.matchedFields).toContain("city");
  });

  it("reaches HIGH confidence from an exact name + address match alone, with no phone/email/website in common", () => {
    const a = company({
      id: "1",
      name: "The Copper Kettle",
      normalizedName: "the copper kettle",
      address1: "123 Main St",
      postalCode: "M5V 3A8",
      normalizedPostalCode: "M5V 3A8",
      country: "Canada",
      phone: "9055550134",
      normalizedPhone: "9055550134",
      email: "a@example.com",
      normalizedEmail: "a@example.com",
      websiteDomain: "aaa.com",
    });
    const b = company({
      id: "2",
      name: "The Copper Kettle",
      normalizedName: "the copper kettle",
      address1: "123 Main St",
      postalCode: "M5V 3A8",
      normalizedPostalCode: "M5V 3A8",
      country: "Canada",
      phone: "9055559999",
      normalizedPhone: "9055559999",
      email: "b@example.com",
      normalizedEmail: "b@example.com",
      websiteDomain: "bbb.com",
    });
    const result = scoreCompanyMatch(a, b);
    expect(result.confidence).toBe("HIGH");
    expect(result.score).toBeGreaterThanOrEqual(80);
    expect(result.reasons.some((r) => r.includes("name and street address both match"))).toBe(true);
  });

  it("does not apply the name+address decisive bonus when only the name matches (address differs)", () => {
    const a = company({
      id: "1",
      name: "The Copper Kettle",
      normalizedName: "the copper kettle",
      address1: "123 Main St",
      postalCode: "M5V 3A8",
      normalizedPostalCode: "M5V 3A8",
      phone: null,
      normalizedPhone: null,
      email: null,
      normalizedEmail: null,
      websiteDomain: null,
    });
    const b = company({
      id: "2",
      name: "The Copper Kettle",
      normalizedName: "the copper kettle",
      address1: "999 Other Ave",
      postalCode: "K1A 0B1",
      normalizedPostalCode: "K1A 0B1",
      phone: null,
      normalizedPhone: null,
      email: null,
      normalizedEmail: null,
      websiteDomain: null,
    });
    const result = scoreCompanyMatch(a, b);
    expect(result.confidence).not.toBe("HIGH");
    expect(result.reasons.some((r) => r.includes("both match exactly"))).toBe(false);
  });

  it("does not apply the name+address decisive bonus for a fuzzy (non-exact) name match", () => {
    const a = company({
      id: "1",
      name: "The Copper Kettle",
      normalizedName: "the copper kettle",
      address1: "123 Main St",
      postalCode: "M5V 3A8",
      normalizedPostalCode: "M5V 3A8",
      phone: null,
      normalizedPhone: null,
      email: null,
      normalizedEmail: null,
      websiteDomain: null,
    });
    const b = company({
      id: "2",
      name: "The Copper Kettel",
      normalizedName: "the copper kettel",
      address1: "123 Main St",
      postalCode: "M5V 3A8",
      normalizedPostalCode: "M5V 3A8",
      phone: null,
      normalizedPhone: null,
      email: null,
      normalizedEmail: null,
      websiteDomain: null,
    });
    const result = scoreCompanyMatch(a, b);
    expect(result.confidence).not.toBe("HIGH");
  });
});

describe("scoreCompanyMatch: name and website need the location to agree", () => {
  const chain = { name: "Boston Pizza", normalizedName: "boston pizza", websiteUrl: "https://bostonpizza.com", websiteDomain: "bostonpizza.com", email: null, normalizedEmail: null };

  it("ignores a same-name, same-website company in a different city (a chain's other location)", () => {
    const a = company({ id: "1", ...chain, normalizedCity: "oakville", city: "Oakville", address1: null, phone: "9055550001", normalizedPhone: "9055550001" });
    const b = company({ id: "2", ...chain, normalizedCity: "mississauga", city: "Mississauga", address1: null, phone: "9055550002", normalizedPhone: "9055550002" });
    const result = scoreCompanyMatch(a, b);
    expect(result.score).toBe(0);
    expect(result.matchedFields).toEqual([]);
    expect(result.conflictingFields).toContain("city");
  });

  it("ignores a same-name company in the same city at a different street address", () => {
    const a = company({ id: "1", ...chain, address1: "100 Main St", phone: "9055550001", normalizedPhone: "9055550001" });
    const b = company({ id: "2", ...chain, address1: "900 Queen St", phone: "9055550002", normalizedPhone: "9055550002" });
    const result = scoreCompanyMatch(a, b);
    expect(result.score).toBe(0);
    expect(result.conflictingFields).toContain("address1");
  });

  it("matches the same name in the same city and province when one has no street address yet", () => {
    const a = company({ id: "1", ...chain, address1: "100 Main St", phone: null, normalizedPhone: null });
    const b = company({ id: "2", ...chain, address1: null, phone: null, normalizedPhone: null });
    const result = scoreCompanyMatch(a, b);
    expect(result.matchedFields).toEqual(expect.arrayContaining(["name", "websiteUrl", "city"]));
  });

  it("still matches on phone alone, wherever the company is", () => {
    const a = company({ id: "1", ...chain, normalizedCity: "oakville", city: "Oakville", address1: null });
    const b = company({ id: "2", ...chain, normalizedCity: "mississauga", city: "Mississauga", address1: null });
    const result = scoreCompanyMatch(a, b);
    expect(result.matchedFields).toEqual(["phone"]);
  });
});
