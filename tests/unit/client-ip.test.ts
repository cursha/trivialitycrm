import { describe, it, expect } from "vitest";
import { resolveClientIp } from "../../src/lib/rate-limit/client-ip";

describe("resolveClientIp", () => {
  it("prefers Cf-Connecting-IP over every other header", () => {
    const headers = new Headers({
      "cf-connecting-ip": "203.0.113.4",
      "x-real-ip": "203.0.113.5",
      "x-forwarded-for": "203.0.113.6, 100.64.0.1",
    });
    expect(resolveClientIp(headers)).toBe("203.0.113.4");
  });

  it("falls back to X-Real-IP when Cf-Connecting-IP is absent", () => {
    const headers = new Headers({
      "x-real-ip": "203.0.113.5",
      "x-forwarded-for": "203.0.113.6, 100.64.0.1",
    });
    expect(resolveClientIp(headers)).toBe("203.0.113.5");
  });

  it("falls back to the leftmost X-Forwarded-For entry when only that is present", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.6, 100.64.0.1" });
    expect(resolveClientIp(headers)).toBe("203.0.113.6");
  });

  it("trims whitespace around the leftmost X-Forwarded-For entry", () => {
    const headers = new Headers({ "x-forwarded-for": "  203.0.113.6  , 100.64.0.1" });
    expect(resolveClientIp(headers)).toBe("203.0.113.6");
  });

  it("returns null when no trusted header is present", () => {
    expect(resolveClientIp(new Headers())).toBeNull();
  });

  it("returns null rather than an empty string for a blank header value", () => {
    const headers = new Headers({ "x-forwarded-for": "" });
    expect(resolveClientIp(headers)).toBeNull();
  });
});
