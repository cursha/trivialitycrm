// No `import "server-only"` — pure text transform, reused by the worker's
// future scheduled-send/sequence-step handlers as well as web Server
// Actions; see token-crypto.ts for the same reasoning.

/**
 * Templates and the composer store plain text — this module has no rich
 * text/WYSIWYG editor, so there is no legitimate markup a user could have
 * authored and no case for an HTML-parsing sanitizer library. Escaping
 * every HTML-significant character and turning newlines into `<br>`
 * produces a safe, correctly formatted HTML body from plain text alone.
 * Revisit with a real sanitizer (e.g. `sanitize-html`) only if a future
 * module adds actual HTML authoring.
 */
export function textToSafeHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
  return escaped.replace(/\r\n|\r|\n/g, "<br>\n");
}
