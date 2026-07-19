import { describe, it, expect } from "vitest";
import { buildCsp, buildSecurityHeaders, hostnameFromUrl } from "../../src/lib/security/headers";

describe("buildCsp", () => {
  it("includes frame-ancestors 'none' and default-src 'self'", () => {
    const csp = buildCsp(true);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("default-src 'self'");
  });

  it("omits 'unsafe-eval' in production", () => {
    expect(buildCsp(true)).not.toContain("unsafe-eval");
  });

  it("allows inline scripts — required for Next's own inline RSC bootstrap, verified by an actual production container run", () => {
    expect(buildCsp(true)).toContain("script-src 'self' 'unsafe-inline'");
  });

  it("includes 'unsafe-eval' outside production (React dev-mode debugging needs it)", () => {
    expect(buildCsp(false)).toContain("unsafe-eval");
  });

  it("collapses to a single line with no raw newlines", () => {
    expect(buildCsp(true)).not.toContain("\n");
  });
});

describe("buildSecurityHeaders", () => {
  it("includes the core header set", () => {
    const headers = buildSecurityHeaders(true);
    const keys = headers.map((h) => h.key);
    expect(keys).toContain("Content-Security-Policy");
    expect(keys).toContain("X-Content-Type-Options");
    expect(keys).toContain("Referrer-Policy");
    expect(keys).toContain("Permissions-Policy");
  });

  it("sets X-Content-Type-Options to nosniff", () => {
    const headers = buildSecurityHeaders(true);
    expect(headers.find((h) => h.key === "X-Content-Type-Options")?.value).toBe("nosniff");
  });

  it("does not include X-Frame-Options — superseded by CSP frame-ancestors", () => {
    const headers = buildSecurityHeaders(true);
    expect(headers.some((h) => h.key === "X-Frame-Options")).toBe(false);
  });

  it("includes Strict-Transport-Security only in production", () => {
    expect(buildSecurityHeaders(true).some((h) => h.key === "Strict-Transport-Security")).toBe(true);
    expect(buildSecurityHeaders(false).some((h) => h.key === "Strict-Transport-Security")).toBe(false);
  });
});

describe("hostnameFromUrl", () => {
  it("extracts the hostname from a full URL", () => {
    expect(hostnameFromUrl("https://crm.example.com")).toBe("crm.example.com");
  });

  it("returns undefined for an unset value", () => {
    expect(hostnameFromUrl(undefined)).toBeUndefined();
  });

  it("returns undefined for an invalid URL rather than throwing", () => {
    expect(hostnameFromUrl("not-a-url")).toBeUndefined();
  });
});
