import { describe, it, expect } from "vitest";
import {
  resolveTemplatePlaceholders,
  extractPlaceholderTokens,
  unknownPlaceholderTokens,
  hasUnsubscribePlaceholder,
} from "../../src/lib/comms/templates";

describe("resolveTemplatePlaceholders", () => {
  it("replaces every known placeholder with the matching data", () => {
    const { resolved, unresolved } = resolveTemplatePlaceholders(
      "Hi {{contact.firstName}}, thanks for your interest in {{company.name}}. — {{sender.name}}",
      { contact: { firstName: "Jamie" }, company: { name: "Acme Trivia" }, sender: { name: "Sam Salesperson" } },
    );
    expect(resolved).toBe("Hi Jamie, thanks for your interest in Acme Trivia. — Sam Salesperson");
    expect(unresolved).toEqual([]);
  });

  it("leaves a placeholder untouched and reports it when its data is missing", () => {
    const { resolved, unresolved } = resolveTemplatePlaceholders("Hi {{contact.firstName}}", { contact: {} });
    expect(resolved).toBe("Hi {{contact.firstName}}");
    expect(unresolved).toEqual(["contact.firstName"]);
  });

  it("leaves a placeholder untouched and reports it when its data is a blank string", () => {
    const { resolved, unresolved } = resolveTemplatePlaceholders("Hi {{contact.firstName}}", { contact: { firstName: "" } });
    expect(resolved).toBe("Hi {{contact.firstName}}");
    expect(unresolved).toEqual(["contact.firstName"]);
  });

  it("reports an unknown token as unresolved rather than silently dropping it", () => {
    const { resolved, unresolved } = resolveTemplatePlaceholders("Hi {{contact.nickname}}", {});
    expect(resolved).toBe("Hi {{contact.nickname}}");
    expect(unresolved).toEqual(["contact.nickname"]);
  });

  it("reports each distinct unresolved token only once even if it appears multiple times", () => {
    const { unresolved } = resolveTemplatePlaceholders("{{contact.firstName}} ... {{contact.firstName}}", {});
    expect(unresolved).toEqual(["contact.firstName"]);
  });

  it("tolerates whitespace inside the braces", () => {
    const { resolved } = resolveTemplatePlaceholders("Hi {{ contact.firstName }}", { contact: { firstName: "Jamie" } });
    expect(resolved).toBe("Hi Jamie");
  });

  it("returns text unchanged when it has no placeholders", () => {
    const { resolved, unresolved } = resolveTemplatePlaceholders("Plain text, no tokens.", {});
    expect(resolved).toBe("Plain text, no tokens.");
    expect(unresolved).toEqual([]);
  });

  it("substitutes a value as-is in the default/text context", () => {
    const { resolved } = resolveTemplatePlaceholders("Hi {{contact.firstName}}", { contact: { firstName: "A & <B>" } });
    expect(resolved).toBe("Hi A & <B>");
  });

  it("HTML-escapes a substituted value in html context without touching surrounding markup", () => {
    const { resolved } = resolveTemplatePlaceholders(
      "<p>Hi <strong>{{contact.firstName}}</strong>, welcome to {{company.name}}.</p>",
      { contact: { firstName: "A & <B>" }, company: { name: `O'Brien's "Pub"` } },
      "html",
    );
    expect(resolved).toBe(`<p>Hi <strong>A &amp; &lt;B&gt;</strong>, welcome to O&#39;Brien&#39;s &quot;Pub&quot;.</p>`);
  });
});

describe("extractPlaceholderTokens / unknownPlaceholderTokens", () => {
  it("extracts every distinct token referenced in the text", () => {
    expect(extractPlaceholderTokens("{{contact.firstName}} {{company.name}} {{contact.firstName}}")).toEqual([
      "contact.firstName",
      "company.name",
    ]);
  });

  it("flags a token this codebase cannot resolve", () => {
    expect(unknownPlaceholderTokens("Hi {{contact.firstName}}, {{contact.nickname}}")).toEqual(["contact.nickname"]);
  });

  it("returns an empty array when every token is known", () => {
    expect(unknownPlaceholderTokens("{{contact.firstName}} {{company.name}} {{sender.name}} {{sender.mailingAddress}} {{unsubscribeLink}}")).toEqual(
      [],
    );
  });
});

describe("hasUnsubscribePlaceholder", () => {
  it("returns true when the body includes {{unsubscribeLink}}", () => {
    expect(hasUnsubscribePlaceholder("Thanks! Unsubscribe: {{unsubscribeLink}}")).toBe(true);
  });

  it("returns false when the body is missing it", () => {
    expect(hasUnsubscribePlaceholder("Thanks for your interest, {{contact.firstName}}.")).toBe(false);
  });
});

describe("unsubscribeLink and sender.mailingAddress resolution", () => {
  it("resolves the unsubscribe link and mailing address placeholders", () => {
    const { resolved, unresolved } = resolveTemplatePlaceholders("{{sender.mailingAddress}} — {{unsubscribeLink}}", {
      sender: { mailingAddress: "123 Main St, Springfield" },
      unsubscribeLink: "https://app.example.test/unsubscribe?token=abc",
    });
    expect(resolved).toBe("123 Main St, Springfield — https://app.example.test/unsubscribe?token=abc");
    expect(unresolved).toEqual([]);
  });

  it("reports unsubscribeLink as unresolved when it isn't provided (no contact to link to)", () => {
    const { unresolved } = resolveTemplatePlaceholders("{{unsubscribeLink}}", {});
    expect(unresolved).toEqual(["unsubscribeLink"]);
  });
});

describe("{{today}} resolution", () => {
  it("resolves to today's date without needing any data passed in", () => {
    const { resolved, unresolved } = resolveTemplatePlaceholders("Sent on {{today}}.", {});
    expect(unresolved).toEqual([]);
    expect(resolved).toMatch(/^Sent on [A-Z][a-z]+ \d{1,2}, \d{4}\.$/);
  });

  it("is a known placeholder, not flagged at template save time", () => {
    expect(unknownPlaceholderTokens("{{today}}")).toEqual([]);
  });
});
