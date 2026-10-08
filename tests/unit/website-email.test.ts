import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  contactPageUrls,
  decodeCloudflareEmail,
  extractEmails,
  fetchPage,
  findEmailOnWebsite,
  isBlockedAddress,
  parseWebsiteUrl,
  EMAIL_LOOKUP_NOTES,
  type PageFetcher,
} from "../../src/lib/research/website-email";

const site = new URL("https://www.keenanspub.ca/");

describe("extractEmails", () => {
  it("prefers a mailto link on the venue's own domain over other addresses", () => {
    const html = `<p>Booked by events@partyco.com</p><a href="mailto:info@keenanspub.ca?subject=Hi">Email us</a>`;
    expect(extractEmails(html, site)[0]).toBe("info@keenanspub.ca");
  });

  it("reads addresses written as HTML entities and Cloudflare-protected ones", () => {
    expect(extractEmails("<p>hello&#64;keenanspub.ca</p>", site)).toEqual(["hello@keenanspub.ca"]);
    // "info@pub.ca" XOR-ed with key 0x42, as Cloudflare writes it.
    const hex = "42" + Buffer.from(Buffer.from("info@pub.ca").map((byte) => byte ^ 0x42)).toString("hex");
    expect(decodeCloudflareEmail(hex)).toBe("info@pub.ca");
    expect(extractEmails(`<a data-cfemail="${hex}">[email protected]</a>`, site)).toEqual(["info@pub.ca"]);
  });

  it("ignores image names, tracking and no-reply addresses, and scripts", () => {
    const html = `<img src="logo@2x.png"><p>noreply@keenanspub.ca</p><p>a1b2@sentry.io</p><script>var x="dev@keenanspub.ca"</script>`;
    expect(extractEmails(html, site)).toEqual([]);
  });
});

describe("contactPageUrls", () => {
  it("finds same-site contact links and skips other sites", () => {
    const html = `<a href="https://facebook.com/contact">FB</a><a href="/contact-us">Contact</a><a href="/find-us#map">Find us</a>`;
    expect(contactPageUrls(html, site).map(String)).toEqual(["https://www.keenanspub.ca/contact-us", "https://www.keenanspub.ca/find-us"]);
  });

  it("falls back to /contact when the page links none", () => {
    expect(contactPageUrls("<p>Welcome</p>", site).map(String)).toEqual(["https://www.keenanspub.ca/contact"]);
  });
});

describe("findEmailOnWebsite", () => {
  function fakeSite(pages: Record<string, string>): PageFetcher {
    return async (url) => (url.toString() in pages ? { url, html: pages[url.toString()] } : null);
  }

  it("reads the contact page when the home page shows no email", async () => {
    const fetcher = fakeSite({
      "https://www.keenanspub.ca/": `<a href="/contact">Contact</a>`,
      "https://www.keenanspub.ca/contact": `<a href="mailto:manager@keenanspub.ca">Email</a>`,
    });
    expect(await findEmailOnWebsite("www.keenanspub.ca", fetcher)).toEqual({ email: "manager@keenanspub.ca", note: null });
  });

  it("says why no email was filled in", async () => {
    const fetcher = fakeSite({ "https://www.keenanspub.ca/": "<p>Welcome</p>" });
    expect(await findEmailOnWebsite(null, fetcher)).toEqual({ email: null, note: EMAIL_LOOKUP_NOTES.noWebsite });
    expect(await findEmailOnWebsite("https://www.facebook.com/keenans", fetcher)).toEqual({ email: null, note: EMAIL_LOOKUP_NOTES.social });
    expect(await findEmailOnWebsite("https://gone.example.test", fetcher)).toEqual({ email: null, note: EMAIL_LOOKUP_NOTES.unreachable });
    expect(await findEmailOnWebsite("https://www.keenanspub.ca", fetcher)).toEqual({ email: null, note: EMAIL_LOOKUP_NOTES.none });
  });
});

describe("private network protection", () => {
  let server: http.Server | null = null;
  afterEach(() => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())));

  it("flags private, loopback and link-local addresses", () => {
    for (const address of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
    expect(isBlockedAddress("8.8.8.8")).toBe(false);
    expect(isBlockedAddress("2606:4700::1111")).toBe(false);
  });

  it("refuses website addresses it won't read", () => {
    expect(parseWebsiteUrl("ftp://pub.ca")).toBeNull();
    expect(parseWebsiteUrl("https://user:pass@pub.ca")).toBeNull();
    expect(parseWebsiteUrl("https://pub.ca:8080")).toBeNull();
    expect(parseWebsiteUrl("http://169.254.169.254/latest/meta-data")).toBeNull();
    expect(parseWebsiteUrl("http://[::1]/")).toBeNull();
    expect(parseWebsiteUrl("keenanspub.ca")?.toString()).toBe("https://keenanspub.ca/");
  });

  it("never connects to a server on this machine, by IP or by name", async () => {
    let requests = 0;
    server = http.createServer((_req, res) => {
      requests++;
      res.writeHead(200, { "Content-Type": "text/html" }).end("<a href='mailto:secret@internal.test'>x</a>");
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;

    await expect(fetchPage(new URL(`http://127.0.0.1:${port}/`))).rejects.toThrow(/private address/);
    await expect(fetchPage(new URL(`http://localhost:${port}/`))).rejects.toThrow(/private address/);
    expect(requests).toBe(0);
  });
});

describe("socialSiteName", () => {
  it("names the social site a venue's website is on, and nothing for a real website", async () => {
    const { socialSiteName } = await import("../../src/lib/research/social-sites");
    expect(socialSiteName("https://www.facebook.com/keenans")).toBe("Facebook");
    expect(socialSiteName("m.facebook.com/keenans")).toBe("Facebook");
    expect(socialSiteName("https://instagram.com/keenans")).toBe("Instagram");
    expect(socialSiteName("https://www.keenanspub.ca")).toBeNull();
    expect(socialSiteName("https://notfacebook.com")).toBeNull();
    expect(socialSiteName(null)).toBeNull();
  });
});
