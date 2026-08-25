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

// Must match rich-text-editor.tsx's LOGO_URL exactly — the only `img src`
// this sanitizer will ever let through (see exclusiveFilter below).
const ALLOWED_LOGO_URL = "https://trivialitycrm.com/triviality-mayhem-logo.png";

// Same posture as ALLOWED_LOGO_URL above, restricting `style` to only
// the three alignments rich-text-editor.tsx's ALIGN_STYLE defines —
// but compared via normalizeStyle() rather than exact string equality:
// confirmed by actually saving a template and reading the stored HTML
// back that the browser reformats "0" to "0px" and adds spacing when
// Tiptap/ProseMirror serializes the style attribute, so the value that
// actually reaches this function never matches the editor's literal
// source string byte-for-byte.
const ALLOWED_IMAGE_STYLES = new Set(
  ["display:block;margin:0 auto 0 0;", "display:block;margin:0 auto;", "display:block;margin:0 0 0 auto;"].map(normalizeStyle),
);

function normalizeStyle(style: string): string {
  return style.replace(/\s+/g, "").replace(/0px/g, "0").toLowerCase();
}

/**
 * Allowlist matches exactly what the composer/template rich-text editor
 * (Tiptap StarterKit + Link + Image extensions — see src/components/ui/
 * rich-text-editor.tsx) can produce: paragraphs, line breaks, bold,
 * italic, links, bulleted/numbered lists, and the one fixed logo image.
 * Called right before a resolved template/composer body is handed to a
 * provider's sendEmail() (see SendEmailInput.bodyHtml's own doc comment)
 * — defense in depth even though the editor's own schema already
 * constrains what a user can author, since resolveTemplatePlaceholders()
 * also splices merge-field values into this same string via plain
 * substitution.
 *
 * `img` is intentionally not a general capability — exclusiveFilter
 * strips any `img` whose src isn't exactly ALLOWED_LOGO_URL, or whose
 * style (if present) isn't one of the three alignment values the
 * editor's own buttons can produce, so even a hand-crafted request
 * that bypassed the editor's UI couldn't get an arbitrary image or
 * arbitrary CSS into a sent email (no general upload/hosting system
 * exists in this app for that to be safe yet — see Curt's ask).
 */
export function sanitizeEmailHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ["p", "br", "strong", "b", "em", "i", "a", "ul", "ol", "li", "img"],
    allowedAttributes: { a: ["href", "target", "rel"], img: ["src", "alt", "width", "height", "style"] },
    allowedSchemes: ["http", "https", "mailto"],
    exclusiveFilter: (frame) =>
      frame.tag === "img" &&
      (frame.attribs.src !== ALLOWED_LOGO_URL ||
        (frame.attribs.style !== undefined && !ALLOWED_IMAGE_STYLES.has(normalizeStyle(frame.attribs.style)))),
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noopener noreferrer" }),
    },
  });
}
