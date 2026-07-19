import { describe, it, expect, vi, afterEach } from "vitest";
import type { PgBoss } from "pg-boss";
import { shutdownBoss } from "../../worker/shutdown";

function fakeBoss(stopImpl: (options: unknown) => Promise<void>) {
  return { stop: vi.fn(stopImpl) } as unknown as PgBoss;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("shutdownBoss", () => {
  it("awaits an in-flight handler that finishes within the graceful window", async () => {
    let resolveStop: () => void = () => {};
    const stopPromise = new Promise<void>((resolve) => {
      resolveStop = resolve;
    });
    const boss = fakeBoss(() => stopPromise);

    const shutdownPromise = shutdownBoss(boss, { timeoutMs: 5000, hardTimeoutMs: 10000 });
    resolveStop();
    await shutdownPromise;

    expect(boss.stop).toHaveBeenCalledWith({ graceful: true, timeout: 5000 });
  });

  it("passes graceful:true and the configured timeout through to boss.stop", async () => {
    const boss = fakeBoss(async () => {});
    await shutdownBoss(boss, { timeoutMs: 1234 });
    expect(boss.stop).toHaveBeenCalledWith({ graceful: true, timeout: 1234 });
  });

  it("resolves via the hard-timeout fallback if boss.stop hangs past the graceful window", async () => {
    vi.useFakeTimers();
    const boss = fakeBoss(() => new Promise<void>(() => {})); // never resolves

    const shutdownPromise = shutdownBoss(boss, { timeoutMs: 1000, hardTimeoutMs: 2000 });

    let settled = false;
    shutdownPromise.then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(2001);
    await Promise.resolve();

    expect(settled).toBe(true);
  });
});
