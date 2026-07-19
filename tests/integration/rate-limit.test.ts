import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { checkRateLimit } from "../../src/lib/rate-limit/postgres-bucket";
import { sweepExpiredRateLimitBuckets } from "../../worker/handlers/cleanup";

beforeEach(async () => {
  await resetDatabase();
});

describe("checkRateLimit (Postgres-backed)", () => {
  it("allows requests up to the limit, then blocks within the same window", async () => {
    const key = "test:allow-then-block";
    const options = { windowMs: 60_000, limit: 3 };

    expect((await checkRateLimit(key, options)).allowed).toBe(true);
    expect((await checkRateLimit(key, options)).allowed).toBe(true);
    expect((await checkRateLimit(key, options)).allowed).toBe(true);
    const fourth = await checkRateLimit(key, options);
    expect(fourth.allowed).toBe(false);
    expect(fourth.remaining).toBe(0);
  });

  it("persists the count across what simulates a process restart — the whole point of moving off the in-memory bucket", async () => {
    const key = "test:survives-restart";
    const options = { windowMs: 60_000, limit: 2 };

    // First "process": consumes the entire budget.
    await checkRateLimit(key, options);
    await checkRateLimit(key, options);

    // A brand-new PrismaClient-backed call — as if a fresh process had just
    // started — must still see the accumulated count and still enforce the
    // limit, because the state lives in Postgres, not in that process's memory.
    const afterRestart = await checkRateLimit(key, options);
    expect(afterRestart.allowed).toBe(false);
  });

  it("keeps separate counts for different keys", async () => {
    const options = { windowMs: 60_000, limit: 1 };
    const first = await checkRateLimit("test:key-a", options);
    const second = await checkRateLimit("test:key-b", options);
    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
  });

  it("resets once a new fixed window begins", async () => {
    const key = "test:window-reset";
    const shortWindowMs = 50;
    const options = { windowMs: shortWindowMs, limit: 1 };

    expect((await checkRateLimit(key, options)).allowed).toBe(true);
    expect((await checkRateLimit(key, options)).allowed).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, shortWindowMs + 20));

    expect((await checkRateLimit(key, options)).allowed).toBe(true);
  });
});

describe("sweepExpiredRateLimitBuckets", () => {
  it("removes buckets older than the retention window and leaves recent ones", async () => {
    await testPrisma.rateLimitBucket.create({
      data: { key: "test:old", windowStart: new Date(Date.now() - 2 * 60 * 60 * 1000), count: 5 },
    });
    await testPrisma.rateLimitBucket.create({
      data: { key: "test:recent", windowStart: new Date(), count: 1 },
    });

    const removed = await sweepExpiredRateLimitBuckets();
    expect(removed).toBe(1);

    expect(await testPrisma.rateLimitBucket.findFirst({ where: { key: "test:old" } })).toBeNull();
    expect(await testPrisma.rateLimitBucket.findFirst({ where: { key: "test:recent" } })).not.toBeNull();
  });
});
