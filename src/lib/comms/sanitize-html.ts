// No `import "server-only"` — pure text/HTML transforms, reused by the
// worker's scheduled-send/sequence-step handlers as well as web Server
// Actions; see token-crypto.ts for the same reasoning.
import sanitizeHtml from "sanitize-html";

/** Escapes the five HTML-significant characters in a plain string —
 * used to safely splice a merge-field VALUE (a contact's name, a
 * company's name, etc.) into an HTML template body via string
 * replacement, without escaping the surrounding markup itself. See
 * resolveTemplatePlaceholders()'s "html" context in templates.ts. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Used only by Module Nine's plain-text transactional email (password
 * reset, admin test, system alerts — see src/lib/transactional/
 * send-system-email.ts) which has no rich text editor and no legitimate
 * markup a user could have authored. NOT used by the Module Six comms
 * composer/templates — those store real HTML from the rich-text editor
 * and go through sanitizeEmailHtml() below instead.
 */
export function textToSafeHtml(text: string): string {
  return escapeHtml(text).replace(/\r\n|\r|\n/g, "<br>\n");
}

/**
 * Allowlist matches exactly what the composer/template rich-text editor
 * (Tiptap StarterKit + Link extension — see src/components/ui/
 * rich-text-editor.tsx) can produce: paragraphs, line breaks, bold,
 * italic, links, and bulleted/numbered lists. Called right before a
 * resolved template/composer body is handed to a provider's sendEmail()
 * (see SendEmailInput.bodyHtml's own doc comment) — defense in depth even
 * though the editor's own schema already constrains what a user can
 * author, since resolveTemplatePlaceholders() also splices merge-field
 * values into this same string via plain substitution.
 */
export function sanitizeEmailHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ["p", "br", "strong", "b", "em", "i", "a", "ul", "ol", "li"],
    allowedAttributes: { a: ["href", "target", "rel"] },
    allowedSchemes: ["http", "https", "mailto"],
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noopener noreferrer" }),
    },
  });
}
