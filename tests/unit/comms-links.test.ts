import { describe, it, expect } from "vitest";
import { parseLinksInput, parseStoredLinks } from "../../src/lib/comms/links";

describe("parseLinksInput", () => {
  it("parses a valid JSON array of links", () => {
    const raw = JSON.stringify([{ label: "Menu", url: "https://drive.google.com/menu" }]);
    expect(parseLinksInput(raw)).toEqual([{ label: "Menu", url: "https://drive.google.com/menu" }]);
  });

  it("returns an empty array for blank input", () => {
    expect(parseLinksInput("")).toEqual([]);
    expect(parseLinksInput("   ")).toEqual([]);
  });

  it("returns an empty array for malformed JSON", () => {
    expect(parseLinksInput("{not json")).toEqual([]);
  });

  it("returns an empty array when the JSON isn't an array", () => {
    expect(parseLinksInput(JSON.stringify({ label: "Menu", url: "https://example.com" }))).toEqual([]);
  });

  it("drops an entry with a non-http(s) URL", () => {
    const raw = JSON.stringify([
      { label: "Bad", url: "javascript:alert(1)" },
      { label: "Good", url: "https://example.com" },
    ]);
    expect(parseLinksInput(raw)).toEqual([{ label: "Good", url: "https://example.com" }]);
  });

  it("drops an entry with a missing or blank label/url", () => {
    const raw = JSON.stringify([
      { label: "", url: "https://example.com" },
      { label: "No URL", url: "" },
      { label: "Fine", url: "https://example.com/ok" },
    ]);
    expect(parseLinksInput(raw)).toEqual([{ label: "Fine", url: "https://example.com/ok" }]);
  });

  it("trims whitespace from label and url", () => {
    const raw = JSON.stringify([{ label: "  Menu  ", url: "  https://example.com  " }]);
    expect(parseLinksInput(raw)).toEqual([{ label: "Menu", url: "https://example.com" }]);
  });
});

describe("parseStoredLinks", () => {
  it("returns an empty array for null (no links stored)", () => {
    expect(parseStoredLinks(null)).toEqual([]);
  });

  it("filters a stored array down to only valid entries", () => {
    expect(
      parseStoredLinks([
        { label: "Menu", url: "https://example.com" },
        { label: "Bad", url: "not-a-url" },
        "not-an-object",
      ]),
    ).toEqual([{ label: "Menu", url: "https://example.com" }]);
  });
});
