import { describe, it, expect } from "vitest";
import { websiteHref, findWebsiteHref } from "../../src/lib/companies/website";

describe("websiteHref", () => {
  it("keeps a full http(s) address", () => {
    expect(websiteHref("https://thepub.ca/menu")).toBe("https://thepub.ca/menu");
    expect(websiteHref("http://thepub.ca")).toBe("http://thepub.ca/");
  });

  it("adds https:// when the scheme is missing", () => {
    expect(websiteHref("www.thepub.ca")).toBe("https://www.thepub.ca/");
    expect(websiteHref("  thepub.ca/events ")).toBe("https://thepub.ca/events");
    expect(websiteHref("//thepub.ca")).toBe("https://thepub.ca/");
  });

  it("refuses anything that isn't a web address", () => {
    expect(websiteHref("javascript:alert(1)")).toBeNull();
    expect(websiteHref("mailto:owner@thepub.ca")).toBeNull();
    expect(websiteHref("not a website")).toBeNull();
    expect(websiteHref("")).toBeNull();
    expect(websiteHref(null)).toBeNull();
  });
});

describe("findWebsiteHref", () => {
  it("searches for the bar by name and place", () => {
    expect(findWebsiteHref({ name: "The Copper Kettle", city: "Oakville", region: "ON" })).toBe(
      "https://www.google.com/search?q=The%20Copper%20Kettle%20Oakville%20ON",
    );
    expect(findWebsiteHref({ name: "Joe's & Co", city: null })).toBe("https://www.google.com/search?q=Joe's%20%26%20Co");
  });
});
