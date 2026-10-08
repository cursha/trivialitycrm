// "Find emails" on the search results page: reads a venue's own website
// (home page, then its contact page) and picks out a public email address.
// No AI and no paid API — just a couple of page requests per venue.
//
// The website URL comes from Google's listing, which the business itself
// controls, so every request is treated as untrusted: http(s) on the
// standard ports only, every DNS answer checked against private, loopback
// and link-local ranges at connect time (not just before it, so a name that
// re-resolves can't slip through), redirects followed by hand and rechecked,
// and a time and size cap on every page.
import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import net from "node:net";
import type { LookupFunction } from "node:net";
import { socialSiteName } from "./social-sites";

const PAGE_TIMEOUT_MS = 8000;
const MAX_PAGE_BYTES = 1_000_000;
const MAX_REDIRECTS = 3;
const USER_AGENT = "Mozilla/5.0 (compatible; TrivialityCRM/1.0; +https://trivialitycrm.com)";


// Addresses that show up on pages but aren't the venue's: site-builder
// tracking, placeholders and image names like "logo@2x.png".
const IGNORED_EMAIL_DOMAINS = ["example.com", "example.org", "domain.com", "email.com", "yourdomain.com", "sentry.io", "wixpress.com", "sentry-next.wixpress.com", "godaddy.com", "squarespace.com"];
const IGNORED_LOCAL_PARTS = /^(no-?reply|donotreply|do-not-reply|postmaster|abuse|webmaster|privacy)$/i;
const FILE_SUFFIX = /\.(png|jpe?g|gif|svg|webp|avif|css|js)$/i;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,24}/gi;
const PREFERRED_LOCAL_PARTS = /^(info|contact|hello|events?|bookings?|reservations?|manager|management|owner|office)$/i;

const BLOCKED_RANGES = new net.BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  BLOCKED_RANGES.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  BLOCKED_RANGES.addSubnet(network, prefix, "ipv6");
}

// IPv4 written as IPv6 (::ffff:127.0.0.1). Its own list: BlockList treats
// this range as matching every plain IPv4 address too, so in the main list
// it would block every website.
const MAPPED_IPV4 = new net.BlockList();
MAPPED_IPV4.addSubnet("::ffff:0:0", 96, "ipv6");

export function isBlockedAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 0) return true;
  if (family === 6 && MAPPED_IPV4.check(address, "ipv6")) return true;
  return BLOCKED_RANGES.check(address, family === 4 ? "ipv4" : "ipv6");
}

// Used as the socket's own DNS lookup, so the address that's checked is the
// address that's connected to.
const safeLookup: LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, "", 0);
    const list = addresses as dns.LookupAddress[];
    if (list.length === 0 || list.some((entry) => isBlockedAddress(entry.address))) {
      return callback(Object.assign(new Error(`Refusing to connect to a private address for ${hostname}`), { code: "EBLOCKED" }), "", 0);
    }
    if (options.all) return (callback as unknown as (err: null, addresses: dns.LookupAddress[]) => void)(null, list);
    callback(null, list[0].address, list[0].family);
  });
};

function hostMatches(host: string, domains: string[]): boolean {
  const bare = host.toLowerCase().replace(/^www\./, "");
  return domains.some((domain) => bare === domain || bare.endsWith(`.${domain}`));
}

function sameSite(a: URL, b: URL): boolean {
  return a.hostname.toLowerCase().replace(/^www\./, "") === b.hostname.toLowerCase().replace(/^www\./, "");
}

/** A website URL the lookup will read, or null. http(s) only, standard ports, no credentials. */
export function parseWebsiteUrl(raw: string): URL | null {
  let url: URL;
  try {
    // A bare "keenanspub.ca" is read as https; any other scheme is kept, then refused below.
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (url.port && url.port !== "80" && url.port !== "443") return null;
  if (isBlockedIpHost(url)) return null;
  return url;
}

type Page = { url: URL; html: string };

// Node connects to an IP-address host directly, without calling the lookup
// above, so those are checked here instead.
function isBlockedIpHost(url: URL): boolean {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  return net.isIP(host) !== 0 && isBlockedAddress(host);
}

function requestOnce(url: URL): Promise<{ status: number; location: string | null; contentType: string; body: string }> {
  return new Promise((resolve, reject) => {
    if (isBlockedIpHost(url)) return reject(new Error(`Refusing to connect to a private address: ${url.hostname}`));
    const client = url.protocol === "https:" ? https : http;
    const request = client.request(
      url,
      { method: "GET", lookup: safeLookup, headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" }, timeout: PAGE_TIMEOUT_MS },
      (response) => {
        const status = response.statusCode ?? 0;
        const location = typeof response.headers.location === "string" ? response.headers.location : null;
        const contentType = String(response.headers["content-type"] ?? "");
        if (status >= 300 || !/html/i.test(contentType)) {
          response.resume();
          return resolve({ status, location, contentType, body: "" });
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_PAGE_BYTES) {
            response.destroy();
            return;
          }
          chunks.push(chunk);
        });
        response.on("close", () => resolve({ status, location, contentType, body: Buffer.concat(chunks).toString("utf8") }));
        response.on("error", reject);
      },
    );
    // Caps the whole request, not only idle time between packets.
    const deadline = setTimeout(() => request.destroy(new Error("Timed out")), PAGE_TIMEOUT_MS);
    request.on("close", () => clearTimeout(deadline));
    request.on("timeout", () => request.destroy(new Error("Timed out")));
    request.on("error", reject);
    request.end();
  });
}

export type PageFetcher = (url: URL) => Promise<Page | null>;

/** Fetches one HTML page, following up to three redirects, each one rechecked. */
export const fetchPage: PageFetcher = async (start) => {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await requestOnce(url);
    if (response.status >= 300 && response.status < 400 && response.location) {
      const next = parseWebsiteUrl(new URL(response.location, url).toString());
      if (!next) return null;
      url = next;
      continue;
    }
    if (response.status >= 200 && response.status < 300 && response.body) return { url, html: response.body };
    return null;
  }
  return null;
};

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&commat;/gi, "@")
    .replace(/&period;/gi, ".")
    .replace(/&amp;/gi, "&");
}

// Cloudflare's "email protection" hides addresses as hex XOR-ed with the
// first byte; very common on small business sites.
export function decodeCloudflareEmail(hex: string): string | null {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length < 4 || hex.length % 2 !== 0) return null;
  const key = parseInt(hex.slice(0, 2), 16);
  let out = "";
  for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  return out;
}

/** A lower-cased, plausible venue email, or null for junk, placeholders and no-reply addresses. */
export function usableEmail(raw: string): string | null {
  const email = raw.trim().replace(/^mailto:/i, "").replace(/[.,;:]+$/, "").toLowerCase();
  const match = email.match(/^([a-z0-9._%+-]+)@([a-z0-9.-]+\.[a-z]{2,24})$/);
  if (!match) return null;
  const [, local, domain] = match;
  if (FILE_SUFFIX.test(email)) return null;
  if (IGNORED_LOCAL_PARTS.test(local)) return null;
  if (hostMatches(domain, IGNORED_EMAIL_DOMAINS)) return null;
  return email;
}

/**
 * Every plausible email on a page, best first: ones in mailto links, then
 * ones on the venue's own domain, then common inbox names (info@, events@).
 */
export function extractEmails(html: string, site: URL): string[] {
  const found: { email: string; mailto: boolean }[] = [];
  const add = (raw: string | null, mailto: boolean) => {
    const email = raw ? usableEmail(raw) : null;
    if (email && !found.some((entry) => entry.email === email)) found.push({ email, mailto });
  };

  for (const match of html.matchAll(/data-cfemail="([0-9a-f]+)"/gi)) add(decodeCloudflareEmail(match[1]), true);
  for (const match of html.matchAll(/email-protection#([0-9a-f]+)/gi)) add(decodeCloudflareEmail(match[1]), true);
  for (const match of html.matchAll(/href\s*=\s*["']\s*mailto:([^"'?]+)/gi)) {
    let address = decodeEntities(match[1]);
    try {
      address = decodeURIComponent(address);
    } catch {
      // Keep it as written.
    }
    add(address, true);
  }
  const text = decodeEntities(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " "));
  for (const match of text.matchAll(EMAIL_PATTERN)) add(match[0], false);

  const siteDomain = site.hostname.toLowerCase().replace(/^www\./, "");
  const rank = ({ email, mailto }: { email: string; mailto: boolean }) => {
    const [local, domain] = email.split("@");
    return (mailto ? 0 : 4) + (domain === siteDomain || siteDomain.endsWith(`.${domain}`) || domain.endsWith(`.${siteDomain}`) ? 0 : 2) + (PREFERRED_LOCAL_PARTS.test(local) ? 0 : 1);
  };
  return found.sort((a, b) => rank(a) - rank(b)).map((entry) => entry.email);
}

/** Up to two same-site pages likely to list an email: linked contact pages, else /contact. */
export function contactPageUrls(html: string, page: URL): URL[] {
  const urls: URL[] = [];
  for (const match of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const [, href, label] = match;
    if (!/contact|get[-_ ]?in[-_ ]?touch|reach[-_ ]?us|find[-_ ]?us/i.test(`${href} ${label.replace(/<[^>]+>/g, " ")}`)) continue;
    let url: URL;
    try {
      url = new URL(decodeEntities(href), page);
    } catch {
      continue;
    }
    if (!sameSite(url, page) || !parseWebsiteUrl(url.toString())) continue;
    url.hash = "";
    if (url.toString() !== page.toString() && !urls.some((existing) => existing.toString() === url.toString())) urls.push(url);
    if (urls.length === 2) break;
  }
  if (urls.length === 0) urls.push(new URL("/contact", page));
  return urls;
}

export type EmailLookup = { email: string; note: null } | { email: null; note: string };

export const EMAIL_LOOKUP_NOTES = {
  noWebsite: "No website on file",
  social: "Website is a social media page — check it by hand",
  unreachable: "Website couldn't be reached",
  none: "No email shown on the website",
} as const;

/** Reads a venue's home page, then its contact page, for a public email. */
export async function findEmailOnWebsite(websiteUrl: string | null, fetcher: PageFetcher = fetchPage): Promise<EmailLookup> {
  const url = websiteUrl ? parseWebsiteUrl(websiteUrl) : null;
  if (!url) return { email: null, note: EMAIL_LOOKUP_NOTES.noWebsite };
  if (socialSiteName(url.toString())) return { email: null, note: EMAIL_LOOKUP_NOTES.social };

  const home = await fetcher(url).catch(() => null);
  if (!home) return { email: null, note: EMAIL_LOOKUP_NOTES.unreachable };
  const [fromHome] = extractEmails(home.html, home.url);
  if (fromHome) return { email: fromHome, note: null };

  for (const contactUrl of contactPageUrls(home.html, home.url)) {
    const page = await fetcher(contactUrl).catch(() => null);
    const [fromContact] = page ? extractEmails(page.html, page.url) : [];
    if (fromContact) return { email: fromContact, note: null };
  }
  return { email: null, note: EMAIL_LOOKUP_NOTES.none };
}
