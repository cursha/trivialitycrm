// Sites that need a login or block automated visits, so "Find emails" can't
// read them; the results page links to them for a person to check instead.
// No Node imports: used by the results page in the browser too.
const SOCIAL_SITES: { domain: string; name: string }[] = [
  { domain: "facebook.com", name: "Facebook" },
  { domain: "fb.com", name: "Facebook" },
  { domain: "instagram.com", name: "Instagram" },
  { domain: "twitter.com", name: "X" },
  { domain: "x.com", name: "X" },
  { domain: "tiktok.com", name: "TikTok" },
  { domain: "linktr.ee", name: "Linktree" },
];

/** "Facebook", "Instagram", ... when the website is a social media page, else null. */
export function socialSiteName(websiteUrl: string | null): string | null {
  if (!websiteUrl) return null;
  let host: string;
  try {
    host = new URL(/^https?:\/\//i.test(websiteUrl) ? websiteUrl : `https://${websiteUrl}`).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
  return SOCIAL_SITES.find(({ domain }) => host === domain || host.endsWith(`.${domain}`))?.name ?? null;
}
