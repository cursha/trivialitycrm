/**
 * A company's website as a link that's safe to open, or null. Websites come
 * from the company form, imports and AI research, so some are saved without
 * a scheme ("www.thepub.ca"), which a browser treats as a path inside the
 * CRM. Adds https:// when missing, and refuses anything that isn't an
 * http(s) address with a real host (e.g. a "javascript:" URL).
 */
export function websiteHref(websiteUrl: string | null | undefined): string | null {
  const trimmed = websiteUrl?.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed.replace(/^\/+/, "")}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname.includes(".")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** A web search for the bar, for when no website is on file. */
export function findWebsiteHref(company: { name: string; city?: string | null; region?: string | null }): string {
  const query = [company.name, company.city, company.region].filter(Boolean).join(" ");
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}
