// Shared type + parsing for the composer/template "link attachments"
// feature -- links to files already hosted elsewhere (Google Drive,
// OneDrive/Sync, etc.), not real uploaded attachments; see the
// email-system delta plan's Conflict B for why. No `import "server-only"`
// -- pure parsing with no I/O, same reasoning as templates.ts.

export type LinkOption = { label: string; url: string };

/** Non-empty label, http(s) URL only -- returns null for anything else. */
function toValidLink(label: unknown, url: unknown): LinkOption | null {
  if (typeof label !== "string" || typeof url !== "string") return null;
  const trimmedLabel = label.trim();
  const trimmedUrl = url.trim();
  if (!trimmedLabel || !trimmedUrl) return null;
  try {
    const parsed = new URL(trimmedUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  } catch {
    return null;
  }
  return { label: trimmedLabel, url: trimmedUrl };
}

function filterValidLinks(value: unknown): LinkOption[] {
  if (!Array.isArray(value)) return [];
  const links: LinkOption[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const link = toValidLink((entry as Record<string, unknown>).label, (entry as Record<string, unknown>).url);
    if (link) links.push(link);
  }
  return links;
}

/**
 * Parses the composer's `links` hidden input (JSON-serialized array built
 * client-side from template defaults plus whatever the user added/removed
 * -- see email-panel.tsx). Malformed/invalid entries are dropped rather
 * than blocking the send -- this is inert metadata, not something worth
 * failing an otherwise-valid send over.
 */
export function parseLinksInput(raw: string): LinkOption[] {
  if (!raw.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  return filterValidLinks(parsed);
}

/** Reads EmailMessage.links (a JSON column with no schema-level shape
 * guarantee) back into a typed array for display. */
export function parseStoredLinks(value: unknown): LinkOption[] {
  return filterValidLinks(value);
}
