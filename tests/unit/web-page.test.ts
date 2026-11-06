import { describe, it, expect, vi } from "vitest";
import { htmlToListingText, pageTitle, webPageLabel, MAX_PAGE_TEXT_CHARS } from "../../src/lib/research/page-text";
import { WebPageDiscoveryProvider, MockPageExtractor, WebPageError, listingsToCandidates, MAX_PAGE_LISTINGS, type PageExtractor, type PageListing } from "../../src/lib/research/providers/web-page";
import type { DiscoverParams } from "../../src/lib/research/providers/types";
import { PageFetchError } from "../../src/lib/research/website-email";

const base = new URL("https://www.pubguide.example.com/niagara/best-pubs");

const params: DiscoverParams = {
  promptText: "",
  country: "Canada",
  region: "ON",
  cities: [],
  leadTypeName: "Pub",
  mode: "WEB_PAGE",
  sourceUrl: base.toString(),
};

const LIST_PAGE = `<!doctype html><html><head><title>Best Pubs in Niagara &amp; Area</title>
<style>.x{color:red}</style><script>window.track("secret")</script></head>
<body><nav><a href="/">Home</a></nav>
<h1>Best pubs</h1>
<ul>
  <li><a href="https://keenans.example.ca/">Keenan&#x27;s Irish Pub</a><br>12 King St, St. Catharines, ON L2R 3H1 &middot; <a href="tel:+19055551234">905-555-1234</a></li>
  <li><b>The Merchant Ale House</b><br>98 St Paul St &mdash; <a href="mailto:info@merchant.example.ca">Email</a></li>
</ul>
<!-- hidden comment -->
<script type="application/ld+json">
{"@context":"https://schema.org","@graph":[
  {"@type":"BarOrPub","name":"Keenan's Irish Pub",
   "address":{"streetAddress":"12 King St","addressLocality":"St. Catharines","addressRegion":"Ontario","postalCode":"L2R 3H1"},
   "telephone":"905-555-1234","url":"https://keenans.example.ca/"}
]}
</script>
${"<p>Plenty of words about pubs in the area and their weekly events.</p>".repeat(5)}
</body></html>`;

function listing(overrides: Partial<PageListing>): PageListing {
  return { name: "A Pub", address1: null, city: null, region: null, postalCode: null, country: null, phone: null, email: null, websiteUrl: null, ...overrides };
}

describe("htmlToListingText", () => {
  it("keeps the visible text and link addresses, drops scripts, styles and comments", () => {
    const { text, truncated } = htmlToListingText(LIST_PAGE, base);
    expect(truncated).toBe(false);
    expect(text).toContain("Keenan's Irish Pub <https://keenans.example.ca/>");
    expect(text).toContain("905-555-1234 <tel:+19055551234>");
    expect(text).toContain("Email <mailto:info@merchant.example.ca>");
    expect(text).toContain("The Merchant Ale House");
    expect(text).toContain("Home <https://www.pubguide.example.com/>");
    expect(text).not.toContain("secret");
    expect(text).not.toContain("color:red");
    expect(text).not.toContain("hidden comment");
  });

  it("adds each JSON-LD block on one line at the end", () => {
    const { text } = htmlToListingText(LIST_PAGE, base);
    const [, structured] = text.split("[Structured data on the page]\n");
    expect(structured.split("\n")).toHaveLength(1);
    expect(JSON.parse(structured)["@graph"][0].name).toBe("Keenan's Irish Pub");
  });

  it("caps a very long page", () => {
    const { text, truncated } = htmlToListingText(`<p>${"word ".repeat(MAX_PAGE_TEXT_CHARS)}</p>`, base);
    expect(truncated).toBe(true);
    expect(text.length).toBe(MAX_PAGE_TEXT_CHARS);
  });

  it("reads the title and labels the site", () => {
    expect(pageTitle(LIST_PAGE)).toBe("Best Pubs in Niagara & Area");
    expect(webPageLabel("https://www.tripadvisor.ca/Restaurant_Review-x.html")).toBe("tripadvisor.ca");
    expect(webPageLabel(null)).toBe("unknown page");
  });
});

describe("listingsToCandidates", () => {
  it("fills province codes and countries the transfer form accepts", () => {
    const [one, two, three] = listingsToCandidates(
      [
        listing({ name: "One", region: "Ontario", country: "CA" }),
        listing({ name: "Two", region: "co", country: "USA" }),
        listing({ name: "Three", region: "Somewhere", country: "Ireland" }),
      ],
      params,
      base,
    );
    expect([one.region, one.country]).toEqual(["ON", "Canada"]);
    expect([two.region, two.country]).toEqual(["CO", "United States"]);
    expect([three.region, three.country]).toEqual(["ON", "Canada"]);
  });

  it("drops blanks and duplicates, the page's own site, and unusable emails", () => {
    const candidates = listingsToCandidates(
      [
        listing({ name: "  Keenan's  ", city: "St. Catharines", websiteUrl: "https://pubguide.example.com/keenans", email: "noreply@keenans.example.ca" }),
        listing({ name: "Keenan's", city: "St. Catharines" }),
        listing({ name: "  " }),
        listing({ name: "Merchant", websiteUrl: "merchant.example.ca", email: "info@merchant.example.ca" }),
      ],
      params,
      base,
    );
    expect(candidates.map((c) => c.name)).toEqual(["Keenan's", "Merchant"]);
    expect(candidates[0]).toMatchObject({ websiteUrl: null, email: null, triviaStatus: "UNCERTAIN", sources: [{ url: base.toString(), title: null }] });
    expect(candidates[1]).toMatchObject({ websiteUrl: "https://merchant.example.ca/", email: "info@merchant.example.ca", city: "" });
  });

  it("keeps at most MAX_PAGE_LISTINGS", () => {
    const many = Array.from({ length: MAX_PAGE_LISTINGS + 20 }, (_, i) => listing({ name: `Pub ${i}` }));
    expect(listingsToCandidates(many, params, base)).toHaveLength(MAX_PAGE_LISTINGS);
  });
});

describe("WebPageDiscoveryProvider", () => {
  it("fetches the page and hands its text to the extractor", async () => {
    const fetcher = vi.fn().mockResolvedValue({ url: base, html: LIST_PAGE });
    const extract = vi.fn<PageExtractor["extract"]>().mockResolvedValue([listing({ name: "Keenan's Irish Pub", city: "St. Catharines" })]);
    const progress = vi.fn().mockResolvedValue(undefined);

    const candidates = await new WebPageDiscoveryProvider({ extract }, fetcher).discover({ ...params, searchId: "s1", userId: "u1" }, progress);

    expect(fetcher.mock.calls[0][0].toString()).toBe(base.toString());
    expect(extract.mock.calls[0][0]).toMatchObject({ pageUrl: base.toString(), pageTitle: "Best Pubs in Niagara & Area", leadTypeName: "Pub", region: "ON" });
    expect(extract.mock.calls[0][0].pageText).toContain("The Merchant Ale House");
    expect(extract.mock.calls[0][1]).toEqual({ searchId: "s1", userId: "u1" });
    expect(candidates.map((c) => c.name)).toEqual(["Keenan's Irish Pub"]);
    expect(progress).toHaveBeenCalled();
  });

  it("refuses a private or non-web address without fetching", async () => {
    const fetcher = vi.fn();
    const provider = new WebPageDiscoveryProvider(new MockPageExtractor(), fetcher);
    await expect(provider.discover({ ...params, sourceUrl: "http://127.0.0.1/admin" })).rejects.toThrow(WebPageError);
    await expect(provider.discover({ ...params, sourceUrl: "file:///etc/passwd" })).rejects.toThrow(/isn't a web address/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("explains a page that won't open, or has nothing to read", async () => {
    await expect(new WebPageDiscoveryProvider(new MockPageExtractor(), vi.fn().mockResolvedValue(null)).discover(params)).rejects.toThrow(/Couldn't open that page/);
    await expect(new WebPageDiscoveryProvider(new MockPageExtractor(), vi.fn().mockRejectedValue(new Error("ECONNRESET"))).discover(params)).rejects.toThrow(/Couldn't open that page/);
    const empty = vi.fn().mockResolvedValue({ url: base, html: "<html><body><div id=root></div><script>app()</script></body></html>" });
    await expect(new WebPageDiscoveryProvider(new MockPageExtractor(), empty).discover(params)).rejects.toThrow(/almost no text/);
  });

  it("mock extractor reads schema.org businesses off the page", async () => {
    const candidates = await new WebPageDiscoveryProvider(new MockPageExtractor(), vi.fn().mockResolvedValue({ url: base, html: LIST_PAGE })).discover(params);
    expect(candidates).toEqual([
      expect.objectContaining({ name: "Keenan's Irish Pub", address1: "12 King St", city: "St. Catharines", region: "ON", postalCode: "L2R 3H1", phone: "905-555-1234", websiteUrl: "https://keenans.example.ca/" }),
    ]);
  });

  it("says when a site refuses the CRM, and how to paste the page instead", async () => {
    const refused = vi.fn().mockRejectedValue(new PageFetchError("The site answered 403", 403));
    await expect(new WebPageDiscoveryProvider(new MockPageExtractor(), refused).discover(params)).rejects.toThrow(/pubguide\.example\.com refused .*answered 403.*Page text box/);
    const missing = vi.fn().mockRejectedValue(new PageFetchError("The site answered 404", 404));
    await expect(new WebPageDiscoveryProvider(new MockPageExtractor(), missing).discover(params)).rejects.toThrow(/wasn't found .*404/);
    await expect(new WebPageDiscoveryProvider(new MockPageExtractor(), vi.fn().mockRejectedValue(new Error("Timed out"))).discover(params)).rejects.toThrow(/Couldn't open that page \(Timed out\)/);
  });

  it("reads pasted page text instead of fetching", async () => {
    const fetcher = vi.fn();
    const extract = vi.fn<PageExtractor["extract"]>().mockResolvedValue([
      { name: "Wimpy's Diner", address1: "4 Hartzel Rd", city: "St. Catharines", region: "Ontario", postalCode: null, country: "Canada", phone: "+1 905-555-0100", email: null, websiteUrl: null },
    ]);
    const pasted = "Wimpy's Diner\r\n\r\n\r\n   4 Hartzel Rd,   St. Catharines  \r\n" + "Breakfast and burgers. ".repeat(20);
    const candidates = await new WebPageDiscoveryProvider({ extract }, fetcher).discover({ ...params, sourceText: pasted });
    expect(fetcher).not.toHaveBeenCalled();
    const input = extract.mock.calls[0][0];
    expect(input.pageText.startsWith("Wimpy's Diner\n4 Hartzel Rd, St. Catharines\nBreakfast")).toBe(true);
    expect(input.pageUrl).toBe(base.toString());
    expect(candidates).toEqual([expect.objectContaining({ name: "Wimpy's Diner", region: "ON", sources: [{ url: base.toString(), title: null }] })]);
    await expect(new WebPageDiscoveryProvider({ extract }, fetcher).discover({ ...params, sourceText: "Too short" })).rejects.toThrow(/too short/);
  });
});
