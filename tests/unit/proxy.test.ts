import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "../../src/proxy";
import { SESSION_COOKIE_NAME } from "../../src/lib/auth/constants";

describe("proxy", () => {
  it("lets an unauthenticated request through to /api/health without redirecting", () => {
    const request = new NextRequest("http://localhost/api/health");
    const response = proxy(request);
    expect(response.status).not.toBe(307);
    expect(response.headers.get("location")).toBeNull();
  });

  it("lets an unauthenticated request through to a nested /api/health path", () => {
    const request = new NextRequest("http://localhost/api/health/deep");
    const response = proxy(request);
    expect(response.headers.get("location")).toBeNull();
  });

  it("still redirects an unauthenticated request to a genuinely protected path", () => {
    const request = new NextRequest("http://localhost/dashboard");
    const response = proxy(request);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/login");
  });

  it("does not redirect an unauthenticated request to /login itself", () => {
    const request = new NextRequest("http://localhost/login");
    const response = proxy(request);
    expect(response.headers.get("location")).toBeNull();
  });

  it("redirects an authenticated-looking request away from /login", () => {
    const request = new NextRequest("http://localhost/login");
    request.cookies.set(SESSION_COOKIE_NAME, "some-token-value");
    const response = proxy(request);
    expect(response.headers.get("location")).toBe("http://localhost/dashboard");
  });

  it("lets an unauthenticated request through to /unsubscribe without redirecting", () => {
    const request = new NextRequest("http://localhost/unsubscribe?token=abc");
    const response = proxy(request);
    expect(response.headers.get("location")).toBeNull();
  });

  it("does NOT bounce an authenticated request away from /unsubscribe (unlike /login)", () => {
    const request = new NextRequest("http://localhost/unsubscribe?token=abc");
    request.cookies.set(SESSION_COOKIE_NAME, "some-token-value");
    const response = proxy(request);
    expect(response.headers.get("location")).toBeNull();
  });
});
