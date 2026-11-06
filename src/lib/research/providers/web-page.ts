// "Read a web page" (Leads, WEB_PAGE mode): reads the one public page the
// user pasted and pulls out the businesses listed on it. The page is
// fetched by the CRM itself through the same hardened fetcher "Find
// emails" uses (website-email.ts: http(s) on standard ports only, private
// and internal addresses refused at connect time, redirects rechecked,
// time and size capped), turned into plain text (page-text.ts), and handed
// to a PageExtractor: the AI one in production, a mock in tests and local
// development.
//
// Big sites (TripAdvisor, Yelp...) refuse requests from servers like the
// CRM's, so the user can instead paste the page's text, copied from their
// own browser (LeadSearch.sourceText, v30.1); then nothing is fetched.
import { fetchPageOrThrow, PageFetchError, parseWebsiteUrl, usableEmail, type PageFetcher } from "../website-email";
import { htmlToListingText, pageTitle, MAX_PAGE_TEXT_CHARS } from "../page-text";
import { normalizeRegion } from "../../data-quality/normalize";
import { canonicalCountry } from "../../constants/countries";
import type { CandidateDiscoveryProvider, DiscoverParams, DiscoveryProgressUpdate, ResearchCandidate } from "./types";

/** Most businesses kept from one page. */
export const MAX_PAGE_LISTINGS = 150;

/** A business as the extractor read it off the page; anything not shown is null. */
export type PageListing = {
  name: string;
  address1: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
  phone: string | null;
  email: string | null;
  websiteUrl: string | null;
};

export type PageExtractInput = {
  pageUrl: string;
  pageTitle: string | null;
  pageText: string;
  leadTypeName: string;
  country: string;
  region: string;
};

export interface PageExtractor {
  extract(input: PageExtractInput, context: { searchId?: string; userId?: string }): Promise<PageListing[]>;
}

/** A message the search page shows as-is. */
export class WebPageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebPageError";
  }
}

// Under this much text a page is almost certainly built in the browser by
// JavaScript (or is a sign-in / bot-check page), so there's nothing to read.
const MIN_PAGE_TEXT_CHARS = 200;

const PASTE_HINT =
  "Open the page in your browser, press Ctrl+A then Ctrl+C (Cmd on a Mac), and paste it into the Page text box on Read a Web Page.";

/** What to tell the user when the CRM couldn't open the page itself. */
export function fetchFailureMessage(error: unknown, host: string): string {
  const status = error instanceof PageFetchError ? error.status : null;
  if (status === 404 || status === 410) return `That page wasn't found (${host} answered ${status}). Check the link opens in your browser.`;
  if (status !== null && (status === 401 || status === 403 || status === 429 || status === 451 || status >= 500 || status < 300)) {
    return `${host} refused to let the CRM open that page (it answered ${status}). Big sites like TripAdvisor and Yelp block servers. ${PASTE_HINT}`;
  }
  const detail = error instanceof Error && error.message ? ` (${error.message.replace(/\.$/, "")})` : "";
  return `Couldn't open that page${detail}. The site may be down, need a sign-in, or block the CRM. ${PASTE_HINT}`;
}

/** Pasted page text tidied: spaces collapsed, blank runs dropped, capped. */
function pastedText(raw: string): { text: string; truncated: boolean } {
  const text = raw
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\f\v\u00a0]+/g, " ")
    .replace(/ *\n[ \n]*/g, "\n")
    .trim();
  const truncated = text.length > MAX_PAGE_TEXT_CHARS;
  return { text: truncated ? text.slice(0, MAX_PAGE_TEXT_CHARS) : text, truncated };
}

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed : null;
}

function cleanWebsite(value: string | null, pageUrl: URL): string | null {
  const raw = clean(value);
  if (!raw) return null;
  const url = parseWebsiteUrl(raw);
  if (!url) return null;
  // A link back to the page being read (or its own site) isn't the venue's website.
  const bare = (host: string) => host.toLowerCase().replace(/^www\./, "");
  if (bare(url.hostname) === bare(pageUrl.hostname)) return null;
  return url.toString();
}

/** Tidies what the extractor returned into search candidates: blanks
 * filled from the search's country and province, duplicates dropped,
 * capped at MAX_PAGE_LISTINGS. */
export function listingsToCandidates(listings: PageListing[], params: Pick<DiscoverParams, "country" | "region">, pageUrl: URL): ResearchCandidate[] {
  const seen = new Set<string>();
  const candidates: ResearchCandidate[] = [];
  for (const listing of listings) {
    const name = clean(listing.name);
    if (!name) continue;
    const city = clean(listing.city) ?? "";
    const key = `${name.toLowerCase()}|${city.toLowerCase()}|${(clean(listing.address1) ?? "").toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // "Canada"/"United States" and a 2-letter province or state, as the
    // transfer form needs; the search's own when the page doesn't say or
    // names somewhere the CRM doesn't work.
    const listedCountry = canonicalCountry(clean(listing.country));
    const country = listedCountry === "Canada" || listedCountry === "United States" ? listedCountry : params.country;
    const regionCode = normalizeRegion(clean(listing.region) ?? "", country).toUpperCase();
    candidates.push({
      name,
      address1: clean(listing.address1),
      city,
      region: /^[A-Z]{2}$/.test(regionCode) ? regionCode : params.region,
      postalCode: clean(listing.postalCode),
      country,
      phone: clean(listing.phone),
      email: listing.email ? usableEmail(listing.email.trim()) : null,
      websiteUrl: cleanWebsite(listing.websiteUrl, pageUrl),
      contactData: null,
      triviaStatus: "UNCERTAIN",
      competitorName: null,
      day: null,
      evidence: [],
      sources: [{ url: pageUrl.toString(), title: null }],
    });
    if (candidates.length >= MAX_PAGE_LISTINGS) break;
  }
  return candidates;
}

export class WebPageDiscoveryProvider implements CandidateDiscoveryProvider {
  constructor(
    private readonly extractor: PageExtractor,
    private readonly fetcher: PageFetcher = fetchPageOrThrow,
  ) {}

  async discover(params: DiscoverParams, onProgress?: (update: DiscoveryProgressUpdate) => Promise<void>): Promise<ResearchCandidate[]> {
    const start = params.sourceUrl ? parseWebsiteUrl(params.sourceUrl) : null;
    if (!start) throw new WebPageError("That isn't a web address the CRM can open. Paste a full public link starting with https://.");

    let pageUrl: URL;
    let title: string | null;
    let text: string;
    let truncated: boolean;
    if (params.sourceText?.trim()) {
      // Pasted from the user's browser: nothing to fetch.
      pageUrl = start;
      title = null;
      ({ text, truncated } = pastedText(params.sourceText));
      if (text.length < MIN_PAGE_TEXT_CHARS) {
        throw new WebPageError("The pasted page text is too short to hold any businesses. Press Ctrl+A on the page first, so it copies the whole page, then Ctrl+C.");
      }
    } else {
      await onProgress?.({ kind: "message", message: `Opening ${start.hostname}...` });
      let page;
      try {
        page = await this.fetcher(start);
      } catch (error) {
        throw new WebPageError(fetchFailureMessage(error, start.hostname));
      }
      if (!page) throw new WebPageError(fetchFailureMessage(null, start.hostname));
      pageUrl = page.url;
      title = pageTitle(page.html);
      ({ text, truncated } = htmlToListingText(page.html, page.url));
      if (text.length < MIN_PAGE_TEXT_CHARS) {
        throw new WebPageError(
          `That page has almost no text the CRM can read. It's probably built by JavaScript in the browser, or it's a sign-in or robot-check page. ${PASTE_HINT}`,
        );
      }
    }

    await onProgress?.({ kind: "message", message: `Reading the businesses listed on ${pageUrl.hostname}${truncated ? " (a long page, so only the first part)" : ""}...` });
    const listings = await this.extractor.extract(
      { pageUrl: pageUrl.toString(), pageTitle: title, pageText: text, leadTypeName: params.leadTypeName, country: params.country, region: params.region },
      { searchId: params.searchId, userId: params.userId },
    );
    return listingsToCandidates(listings, params, pageUrl);
  }
}

/** No AI: reads schema.org JSON-LD businesses off the page, so local
 * development and tests get real-looking results without a paid call. */
export class MockPageExtractor implements PageExtractor {
  async extract(input: PageExtractInput): Promise<PageListing[]> {
    const marker = "[Structured data on the page]\n";
    const at = input.pageText.indexOf(marker);
    const listings: PageListing[] = [];
    if (at >= 0) {
      for (const block of input.pageText.slice(at + marker.length).split("\n")) {
        try {
          const queue: unknown[] = [JSON.parse(block)];
          while (queue.length > 0) {
            const item = queue.shift();
            if (Array.isArray(item)) {
              queue.push(...item);
              continue;
            }
            if (!item || typeof item !== "object") continue;
            const record = item as Record<string, unknown>;
            if (Array.isArray(record["@graph"])) queue.push(...record["@graph"]);
            const address = record.address as Record<string, unknown> | undefined;
            if (typeof record.name === "string" && address && typeof address === "object") {
              listings.push({
                name: record.name,
                address1: typeof address.streetAddress === "string" ? address.streetAddress : null,
                city: typeof address.addressLocality === "string" ? address.addressLocality : null,
                region: typeof address.addressRegion === "string" ? address.addressRegion : null,
                postalCode: typeof address.postalCode === "string" ? address.postalCode : null,
                country: null,
                phone: typeof record.telephone === "string" ? record.telephone : null,
                email: typeof record.email === "string" ? record.email.replace(/^mailto:/i, "") : null,
                websiteUrl: typeof record.url === "string" ? record.url : null,
              });
            }
          }
        } catch {
          // Not one JSON block per line; skip it.
        }
      }
    }
    return listings;
  }
}
