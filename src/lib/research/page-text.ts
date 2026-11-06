// "Read a web page" (Leads): turns a fetched page's HTML into plain text
// for the AI to pick the listed businesses out of. Keeps what a listing
// page carries its details in: the visible text, each link's address (a
// venue's own website, mailto: and tel: links) and any schema.org JSON-LD
// block, which directories often fill with name/address/phone. Drops
// scripts, styles and markup, so the AI is sent far fewer tokens than the
// raw HTML would cost.

/** Most characters sent to the AI from one page (~40K tokens). */
export const MAX_PAGE_TEXT_CHARS = 150_000;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  rsquo: "'",
  lsquo: "'",
  rdquo: '"',
  ldquo: '"',
  hellip: "...",
  commat: "@",
  period: ".",
  eacute: "é",
  egrave: "è",
  middot: "·",
  bull: "•",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === "#") {
      const value = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return Number.isFinite(value) && value > 0 && value < 0x110000 ? String.fromCodePoint(value) : match;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? match;
  });
}

function absoluteHref(href: string, base: URL): string | null {
  const trimmed = decodeEntities(href.trim());
  if (/^(mailto|tel):/i.test(trimmed)) return trimmed;
  if (!trimmed || trimmed.startsWith("#") || /^javascript:/i.test(trimmed)) return null;
  try {
    const url = new URL(trimmed, base);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** The page's <title>, or null. */
export function pageTitle(html: string): string | null {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = match ? decodeEntities(match[1]).replace(/\s+/g, " ").trim() : "";
  return title || null;
}

/**
 * Plain text of the page: block elements become new lines, links read
 * "text <address>", JSON-LD kept as-is at the end. Capped at
 * MAX_PAGE_TEXT_CHARS; `truncated` says when the page was longer.
 */
export function htmlToListingText(html: string, base: URL): { text: string; truncated: boolean } {
  const jsonLd: string[] = [];
  for (const match of html.matchAll(/<script[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    // One line per block (JSON can't hold a raw new line inside a string,
    // so this never changes its meaning).
    const block = match[1].replace(/\s*\n\s*/g, " ").trim();
    if (block) jsonLd.push(block);
  }

  let body = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|iframe|head)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<a\b[^>]*?href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi, (_match, _q, d, s, u, inner: string) => {
      const href = absoluteHref(d ?? s ?? u ?? "", base);
      const label = inner.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (!href) return ` ${label} `;
      // Marked with control characters, not "<...>" yet, so stripping the
      // remaining tags below doesn't take the address with them.
      return ` ${label} \u0001${href}\u0002 `;
    })
    .replace(/<(br|hr)\b[^>]*>/gi, "\n")
    .replace(/<\/?(p|div|li|ul|ol|tr|table|section|article|header|footer|aside|main|nav|h[1-6]|dt|dd|dl|address|blockquote|figure|figcaption)\b[^>]*>/gi, "\n")
    .replace(/<\/?(td|th)\b[^>]*>/gi, " | ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\u0001([^\u0002]*)\u0002/g, "<$1>");

  body = decodeEntities(body)
    .replace(/[ \t\f\v ]+/g, " ")
    .replace(/ *\n[ \n|]*/g, "\n")
    .trim();

  let text = body;
  if (jsonLd.length > 0) text += `\n\n[Structured data on the page]\n${jsonLd.join("\n")}`;
  const truncated = text.length > MAX_PAGE_TEXT_CHARS;
  return { text: truncated ? text.slice(0, MAX_PAGE_TEXT_CHARS) : text, truncated };
}

/** The site a "Read a web page" search read, e.g. "tripadvisor.ca". */
export function webPageLabel(sourceUrl: string | null): string {
  if (!sourceUrl) return "unknown page";
  try {
    return new URL(sourceUrl).hostname.replace(/^www\./, "");
  } catch {
    return sourceUrl;
  }
}
