import { describe, it, expect } from "vitest";
import { titleCaseCity } from "../../src/lib/text-case";

describe("titleCaseCity", () => {
  it("capitalizes an all-lowercase city", () => {
    expect(titleCaseCity("milton")).toBe("Milton");
  });

  it("fixes an all-caps city", () => {
    expect(titleCaseCity("MILTON")).toBe("Milton");
  });

  it("capitalizes every word in a multi-word city", () => {
    expect(titleCaseCity("new york city")).toBe("New York City");
    expect(titleCaseCity("NEW YORK CITY")).toBe("New York City");
  });

  it("capitalizes both halves of a hyphenated city", () => {
    expect(titleCaseCity("winston-salem")).toBe("Winston-Salem");
  });

  it("leaves an already-mixed-case word alone rather than mangling it", () => {
    expect(titleCaseCity("McAllen")).toBe("McAllen");
    expect(titleCaseCity("DeKalb")).toBe("DeKalb");
  });

  it("handles a period and apostrophe correctly", () => {
    expect(titleCaseCity("st. john's")).toBe("St. John's");
  });
});
