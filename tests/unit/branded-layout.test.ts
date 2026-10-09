import { describe, it, expect } from "vitest";
import { wrapInBrandedLayout } from "../../src/lib/comms/branded-layout";

describe("wrapInBrandedLayout", () => {
  it("puts the message between the logo and a footer with the sender and business details", () => {
    const html = wrapInBrandedLayout("<p>Hi Jamie</p>", { senderName: "Curt Skene", phone: "905-555-0123", website: "trivialitymayhem.com" });
    expect(html).toContain("triviality-mayhem-logo-email.png");
    expect(html.indexOf("triviality-mayhem-logo-email.png")).toBeLessThan(html.indexOf("<p>Hi Jamie</p>"));
    expect(html.indexOf("<p>Hi Jamie</p>")).toBeLessThan(html.indexOf("Curt Skene"));
    expect(html).toContain('href="tel:9055550123"');
    expect(html).toContain('href="https://trivialitymayhem.com/"');
    expect(html).toContain(">trivialitymayhem.com</a>");
  });

  it("leaves out phone and website when they aren't set", () => {
    const html = wrapInBrandedLayout("<p>Hi</p>", { senderName: "Curt", phone: null, website: null });
    expect(html).not.toContain("tel:");
    expect(html).toContain("Triviality Mayhem");
  });

  it("escapes the footer values and drops a website that isn't http(s)", () => {
    const html = wrapInBrandedLayout("<p>Hi</p>", { senderName: "<b>Curt</b>", phone: null, website: "javascript:alert(1)" });
    expect(html).toContain("&lt;b&gt;Curt&lt;/b&gt;");
    expect(html).not.toContain("javascript:");
  });

  it("doesn't add a second logo when the message already shows one", () => {
    const html = wrapInBrandedLayout('<p><img src="https://trivialitycrm.com/triviality-mayhem-logo.png"></p>', { senderName: "Curt", phone: null, website: null });
    expect(html).not.toContain("triviality-mayhem-logo-email.png");
  });
});
