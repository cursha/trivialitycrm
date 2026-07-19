import { describe, it, expect } from "vitest";
import { GET as healthCheck } from "../../src/app/api/health/route";

describe("GET /api/health", () => {
  it("returns 200 with a safe, fixed JSON shape and no config leakage", async () => {
    const response = await healthCheck();
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body).toEqual({ status: "ok", database: "up" });

    const bodyText = JSON.stringify(body);
    expect(bodyText).not.toMatch(/postgres:\/\//i);
    expect(bodyText.toLowerCase()).not.toContain("secret");
    expect(bodyText.toLowerCase()).not.toContain("key");
  });

  it("requires no authentication — unauthenticated by design for the Railway health check", async () => {
    // No loginAs()/session cookie set up anywhere in this test — if the
    // route required auth, it would redirect (throwing RedirectSignal, per
    // tests/setup/mock-next.ts) instead of returning a response.
    const response = await healthCheck();
    expect(response.status).toBe(200);
  });
});
