import { describe, it, expect } from "vitest";
import { separateChains } from "../../src/lib/research/chains";

function place(name: string, opts: { websiteUrl?: string | null; address1?: string; city?: string } = {}) {
  return { name, websiteUrl: opts.websiteUrl ?? null, address1: opts.address1 ?? "1 Main St", city: opts.city ?? "Milton" };
}

function chainNames(places: ReturnType<typeof place>[], crm: string[] = []) {
  return separateChains(places, new Set(crm)).chains.map((p) => p.name);
}

describe("separateChains", () => {
  it("leaves out known chains, including a location suffix and punctuation", () => {
    expect(chainNames([place("Boston Pizza Milton"), place("Kelsey's Original Roadhouse"), place("St. Louis Bar & Grill"), place("Dave & Buster's")])).toEqual([
      "Boston Pizza Milton",
      "Kelsey's Original Roadhouse",
      "St. Louis Bar & Grill",
      "Dave & Buster's",
    ]);
  });

  it("keeps independents whose names only start like a chain's word", () => {
    expect(chainNames([place("The Keg Room Pub"), place("Earl's Tavern"), place("Joeys Pub")])).toEqual([]);
  });

  it("leaves out Firkin pubs wherever the word is", () => {
    expect(chainNames([place("The Bow & Arrow Firkin"), place("Firkin on King")])).toHaveLength(2);
  });

  it("leaves out a place whose website is a chain's location page", () => {
    expect(
      chainNames([
        place("Some Grill", { websiteUrl: "https://www.somegrill.com/locations/milton-on" }),
        place("The Local", { websiteUrl: "https://thelocal.ca/" }),
        place("The Corner", { websiteUrl: "https://thecorner.ca/contact" }),
      ]),
    ).toEqual(["Some Grill"]);
  });

  it("leaves out names the CRM already has at three or more locations", () => {
    expect(chainNames([place("Local Chain Pub"), place("Solo Pub")], ["local chain pub"])).toEqual(["Local Chain Pub"]);
  });

  it("leaves out a name found at three or more addresses in the same search, not two", () => {
    const three = ["1 A St", "2 B St", "3 C St"].map((address1) => place("Regional Taphouse", { address1 }));
    expect(chainNames(three)).toHaveLength(3);
    expect(chainNames(three.slice(0, 2))).toEqual([]);
  });
});
