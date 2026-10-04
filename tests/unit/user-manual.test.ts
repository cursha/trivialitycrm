import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { MANUALS, findManual, readManual } from "../../src/lib/docs/manuals";

describe("in-app user manual", () => {
  it("finds each guide by slug and falls back to the first", () => {
    expect(findManual("admin-guide").file).toBe("ADMIN_GUIDE.md");
    expect(findManual("nope").slug).toBe("sales-quick-start");
    expect(findManual(undefined).slug).toBe("sales-quick-start");
  });

  it("reads both guides from the repo root", async () => {
    for (const manual of MANUALS) {
      const markdown = await readManual(manual.file);
      expect(markdown, manual.file).toMatch(/^# /);
    }
  });

  it("renders the sales process table and never passes raw HTML through", async () => {
    const markdown = (await readManual("SALES_QUICKSTART.md")) ?? "";
    const html = renderToStaticMarkup(createElement(Markdown, { remarkPlugins: [remarkGfm] }, markdown));
    expect(html).toContain("<table>");
    expect(html).toContain("Trial Booked");

    const unsafe = renderToStaticMarkup(createElement(Markdown, { remarkPlugins: [remarkGfm] }, "Hi <script>alert(1)</script>"));
    expect(unsafe).not.toContain("<script>");
  });
});
