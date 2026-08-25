import { describe, it, expect } from "vitest";
import { escapeHtml, textToSafeHtml, sanitizeEmailHtml } from "../../src/lib/comms/sanitize-html";

describe("escapeHtml", () => {
  it("escapes every HTML-significant character", () => {
    expect(escapeHtml(`A & <B> "C" 'D'`)).toBe("A &amp; &lt;B&gt; &quot;C&quot; &#39;D&#39;");
  });
});

describe("textToSafeHtml", () => {
  it("escapes plain text and converts newlines to <br>", () => {
    expect(textToSafeHtml("Line one\nLine two & <b>not bold</b>")).toBe("Line one<br>\nLine two &amp; &lt;b&gt;not bold&lt;/b&gt;");
  });
});

describe("sanitizeEmailHtml", () => {
  it("keeps every tag the rich-text editor can produce", () => {
    const input = "<p>Hi <strong>Jamie</strong>, <em>welcome</em>. <a href=\"https://example.com\">Visit</a></p><ul><li>One</li></ul><ol><li>Two</li></ol>";
    const result = sanitizeEmailHtml(input);
    expect(result).toContain("<strong>Jamie</strong>");
    expect(result).toContain("<em>welcome</em>");
    expect(result).toContain("<ul>");
    expect(result).toContain("<li>One</li>");
    expect(result).toContain("<ol>");
  });

  it("strips a script tag and its content entirely", () => {
    const result = sanitizeEmailHtml('<p>Hi</p><script>alert("xss")</script>');
    expect(result).not.toContain("script");
    expect(result).not.toContain("alert");
  });

  it("strips a disallowed tag but keeps its safe inner text", () => {
    const result = sanitizeEmailHtml('<img src="x" onerror="alert(1)"><p>Hello</p>');
    expect(result).not.toContain("<img");
    expect(result).not.toContain("onerror");
    expect(result).toContain("<p>Hello</p>");
  });

  it("strips a javascript: link href rather than passing it through", () => {
    const result = sanitizeEmailHtml('<a href="javascript:alert(1)">Click</a>');
    expect(result).not.toContain("javascript:");
  });

  it("keeps an https link and adds a safe target/rel", () => {
    const result = sanitizeEmailHtml('<a href="https://example.com">Visit</a>');
    expect(result).toContain('href="https://example.com"');
    expect(result).toContain('target="_blank"');
    expect(result).toContain("noopener");
  });

  it("strips an inline event handler attribute even on an allowed tag", () => {
    const result = sanitizeEmailHtml('<p onclick="alert(1)">Hi</p>');
    expect(result).not.toContain("onclick");
    expect(result).toContain("<p>Hi</p>");
  });

  it("keeps the one fixed logo image the editor can insert", () => {
    const result = sanitizeEmailHtml('<p>Hi</p><img src="https://trivialitycrm.com/triviality-mayhem-logo.png" alt="Triviality Mayhem" width="160" height="160">');
    expect(result).toContain('<img src="https://trivialitycrm.com/triviality-mayhem-logo.png"');
    expect(result).toContain('width="160"');
  });

  it("strips any image that isn't the exact fixed logo URL, even though img is otherwise allowed", () => {
    const result = sanitizeEmailHtml('<img src="https://evil.example.com/tracker.png"><p>Hi</p>');
    expect(result).not.toContain("<img");
    expect(result).not.toContain("evil.example.com");
    expect(result).toContain("<p>Hi</p>");
  });

  it("keeps the logo image with any of the three alignment styles the editor's buttons can produce", () => {
    // sanitize-html re-serializes the style attribute (e.g. drops a
    // trailing ";"), so this checks the image survived and the
    // meaningful CSS is intact, not an exact string match.
    for (const style of ["display:block;margin:0 auto 0 0;", "display:block;margin:0 auto;", "display:block;margin:0 0 0 auto;"]) {
      const result = sanitizeEmailHtml(`<img src="https://trivialitycrm.com/triviality-mayhem-logo.png" style="${style}">`);
      expect(result).toContain("<img");
      expect(result).toContain(style.replace(/;$/, ""));
    }
  });

  it("keeps the logo image with the browser-reformatted style ProseMirror actually saves (confirmed against a real saved template)", () => {
    // What editor.getHTML() actually produces isn't the literal
    // ALIGN_STYLE source string — the browser reformats "0" to "0px"
    // and adds spacing when serializing the style attribute. This is
    // the exact string read back from a real saved EmailTemplate.body.
    for (const style of ["display: block; margin: 0px auto 0px 0px;", "display: block; margin: 0px auto;", "display: block; margin: 0px 0px 0px auto;"]) {
      const result = sanitizeEmailHtml(`<img src="https://trivialitycrm.com/triviality-mayhem-logo.png" style="${style}">`);
      expect(result).toContain("<img");
    }
  });

  it("strips the logo image if its style isn't one of the three exact allowed alignment values", () => {
    const result = sanitizeEmailHtml('<img src="https://trivialitycrm.com/triviality-mayhem-logo.png" style="position:fixed;top:0;">');
    expect(result).not.toContain("<img");
  });
});
