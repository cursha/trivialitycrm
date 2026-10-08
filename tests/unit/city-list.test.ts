import { describe, it, expect } from "vitest";
import { parseCityList } from "../../src/lib/research/city-list";

describe("parseCityList", () => {
  it("reads one city per line, dropping a province after a comma", () => {
    expect(parseCityList("Milton, ON\nOakville\r\n\n  Burlington , Ontario, Canada\n")).toEqual(["Milton", "Oakville", "Burlington"]);
  });

  it("reads a comma- or semicolon-separated list on one line", () => {
    expect(parseCityList("Milton, Oakville; Burlington,")).toEqual(["Milton", "Oakville", "Burlington"]);
  });

  it("drops repeats in any case, keeping the first spelling", () => {
    expect(parseCityList("Milton\nmilton\nMILTON\nSt.  Catharines")).toEqual(["Milton", "St. Catharines"]);
  });

  it("returns nothing for a blank box", () => {
    expect(parseCityList("  \n ")).toEqual([]);
  });
});
