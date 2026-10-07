import { describe, it, expect } from "vitest";
import { mapAndValidateRow, parseWeekday, autoMapHeaders } from "../../src/lib/validation/import";
import { appendImportNotes, importNoteLines, isLinkableProvider } from "../../src/lib/import/company-fields";

describe("mapAndValidateRow", () => {
  const mapping = { name: "Business Name", city: "City", region: "Prov", country: "Nation", email: "Email" };

  it("maps columns and passes validation for a complete row", () => {
    const result = mapAndValidateRow(
      { "Business Name": "The Copper Kettle", City: "Milton", Prov: "ON", Nation: "Canada", Email: "hi@example.test" },
      mapping,
    );
    expect(result.errors).toHaveLength(0);
    expect(result.values.name).toBe("The Copper Kettle");
    expect(result.values.email).toBe("hi@example.test");
  });

  it("reports missing required fields", () => {
    const result = mapAndValidateRow({ "Business Name": "", City: "Milton", Prov: "", Nation: "Canada" }, mapping);
    expect(result.errors).toContain('Missing required field "name".');
    expect(result.errors).toContain('Missing required field "region".');
  });

  it("flags an invalid email without crashing", () => {
    const result = mapAndValidateRow(
      { "Business Name": "Bar", City: "Milton", Prov: "ON", Nation: "Canada", Email: "not-an-email" },
      mapping,
    );
    expect(result.errors).toContain("Invalid company email.");
  });

  it("leaves unmapped optional fields empty rather than erroring", () => {
    const result = mapAndValidateRow({ "Business Name": "Bar", City: "Milton", Prov: "ON", Nation: "Canada" }, mapping);
    expect(result.errors).toHaveLength(0);
    expect(result.values.phone).toBe("");
  });

  it("rejects a full state/province name instead of a 2-letter code", () => {
    const result = mapAndValidateRow({ "Business Name": "Bar", City: "Milton", Prov: "Ontario", Nation: "Canada" }, mapping);
    expect(result.errors).toContain("Region must be a 2-letter state/province code (e.g. ON, CO) — not the full name.");
  });

  it("title-cases city and uppercases region on import", () => {
    const result = mapAndValidateRow({ "Business Name": "Bar", City: "milton", Prov: "on", Nation: "Canada" }, mapping);
    expect(result.values.city).toBe("Milton");
    expect(result.values.region).toBe("ON");
  });
});

describe("research field parsing", () => {
  const mapping = { name: "name", city: "city", region: "region", country: "country", triviaStatus: "t", competitorTriviaDay: "d", slowNight: "s", needsReview: "r", researchPriority: "p" };
  const base = { name: "Bar", city: "Milton", region: "ON", country: "Canada" };
  const validate = (extra: Record<string, string>) => mapAndValidateRow({ ...base, ...extra }, mapping);

  it("accepts weekday spellings in any case and rejects anything else", () => {
    for (const raw of ["Tue", "Tues", "Tuesday", "TUESDAY", "tuesdays"]) expect(parseWeekday(raw)).toBe("TUESDAY");
    expect(parseWeekday("Thurs")).toBe("THURSDAY");
    expect(validate({ d: "Wed", s: "sunday" }).values).toMatchObject({ competitorTriviaDay: "WEDNESDAY", slowNight: "SUNDAY" });
    expect(validate({ d: "Funday" }).errors).toContain('Trivia night "Funday" must be a day of the week (e.g. Tue or Tuesday).');
    expect(validate({ s: "weekends" }).errors).toContain('Slow night "weekends" must be a day of the week (e.g. Tue or Tuesday).');
  });

  it("accepts trivia status values and friendly forms, and rejects anything else", () => {
    expect(validate({ t: "CURRENT_TRIVIA" }).values.triviaStatus).toBe("CURRENT_TRIVIA");
    expect(validate({ t: "yes" }).values.triviaStatus).toBe("CURRENT_TRIVIA");
    expect(validate({ t: "Current" }).values.triviaStatus).toBe("CURRENT_TRIVIA");
    expect(validate({ t: "no" }).values.triviaStatus).toBe("NO_CURRENT_TRIVIA");
    expect(validate({ t: "None" }).values.triviaStatus).toBe("NO_CURRENT_TRIVIA");
    expect(validate({ t: "" }).values.triviaStatus).toBe("UNCERTAIN");
    expect(validate({ t: "unknown" }).values.triviaStatus).toBe("UNCERTAIN");
    expect(validate({ t: "sometimes" }).errors).toHaveLength(1);
  });

  it("accepts yes/no for needs review, blank meaning no", () => {
    for (const raw of ["yes", "TRUE", "1"]) expect(validate({ r: raw }).values.needsReview).toBe("true");
    for (const raw of ["no", "false", "0", ""]) expect(validate({ r: raw }).values.needsReview).toBe("false");
    expect(validate({ r: "maybe" }).errors).toContain('Needs review "maybe" must be yes or no.');
  });

  it("accepts High, Medium or Low research priority in any case", () => {
    expect(validate({ p: "HIGH" }).values.researchPriority).toBe("High");
    expect(validate({ p: "medium" }).values.researchPriority).toBe("Medium");
    expect(validate({ p: "Urgent" }).errors).toContain('Research priority "Urgent" must be High, Medium or Low.');
  });

  it("flags formula-like values in the new text fields", () => {
    const textMapping = { ...mapping, triviaHistory: "h", verifiedEvidenceSummary: "v", recommendedNextAction: "n" };
    const result = mapAndValidateRow({ ...base, h: "=HYPERLINK(1)", v: "+evidence", n: "@call" }, textMapping);
    expect(result.errors).toHaveLength(0);
    for (const field of ["triviaHistory", "verifiedEvidenceSummary", "recommendedNextAction"]) {
      expect(result.warnings.some((w) => w.includes(`"${field}"`))).toBe(true);
    }
  });

  it("warns when a contact has only one name", () => {
    const contactMapping = { ...mapping, contactFirstName: "f", contactLastName: "l" };
    expect(mapAndValidateRow({ ...base, f: "Sam", l: "" }, contactMapping).warnings).toContain("No last name, so this contact will be saved as a company note.");
    expect(mapAndValidateRow({ ...base, f: "", l: "Smith" }, contactMapping).warnings).toContain("No first name, so this contact will be saved as a company note.");
    expect(mapAndValidateRow({ ...base, f: "Sam", l: "Smith" }, contactMapping).warnings).toHaveLength(0);
  });
});

describe("autoMapHeaders", () => {
  it("maps a column whose header is exactly a field key, ignoring case", () => {
    expect(autoMapHeaders(["Name", "CITY", " region ", "slowNight", "competitortriviaprovider", "Phone Number", "eosScore"])).toEqual({
      name: "Name",
      city: "CITY",
      region: " region ",
      slowNight: "slowNight",
      competitorTriviaProvider: "competitortriviaprovider",
    });
  });
});

describe("import note lines", () => {
  const values = (extra: Record<string, string>) => mapAndValidateRow({ name: "Bar", city: "Milton", region: "ON", country: "Canada", ...extra }, Object.fromEntries(Object.keys({ name: 1, city: 1, region: 1, country: 1, ...extra }).map((k) => [k, k]))).values;

  it("puts the research priority first and keeps contact details that have no contact", () => {
    expect(importNoteLines(values({ researchPriority: "low", notes: "Hi", contactLastName: "Smith", contactEmail: "a@b.test", contactNote: "Call after 2" }))).toEqual([
      "Research priority: Low",
      "Hi",
      "Contact: Smith — a@b.test",
      "Contact note (Smith): Call after 2",
    ]);
  });

  it("appends under a dated header, skipping lines the notes already have", () => {
    const row = values({ researchPriority: "High", notes: "Hi" });
    expect(appendImportNotes(null, row, "2026-10-07", "a.csv")).toBe("— Imported 2026-10-07 (a.csv) —\nResearch priority: High\nHi");
    expect(appendImportNotes("Research priority: High", row, "2026-10-07", "a.csv")).toBe("Research priority: High\n\n— Imported 2026-10-07 (a.csv) —\nHi");
    expect(appendImportNotes("Research priority: High\nHi", row, "2026-10-07", "a.csv")).toBeNull();
  });

  it("treats In-house, Independent and None as not a competitor", () => {
    for (const name of ["In-house", "in house", "Independent", "None", "N/A", ""]) expect(isLinkableProvider(name)).toBe(false);
    expect(isLinkableProvider("Ruby Pub Trivia")).toBe(true);
  });
});
