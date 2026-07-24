import { describe, it, expect } from "vitest";
import { HEARTBEAT_FRESHNESS_MS, isHeartbeatStale, decideHeartbeatAlertAction } from "../../src/lib/ops/worker-heartbeat";

const NOW = new Date("2026-01-15T12:00:00Z");

describe("isHeartbeatStale", () => {
  it("is not stale just under the freshness window", () => {
    const updatedAt = new Date(NOW.getTime() - (HEARTBEAT_FRESHNESS_MS - 1000));
    expect(isHeartbeatStale(updatedAt, NOW)).toBe(false);
  });

  it("is stale just past the freshness window", () => {
    const updatedAt = new Date(NOW.getTime() - (HEARTBEAT_FRESHNESS_MS + 1000));
    expect(isHeartbeatStale(updatedAt, NOW)).toBe(true);
  });
});

describe("decideHeartbeatAlertAction", () => {
  it("sends an alert the first time the heartbeat goes stale", () => {
    const heartbeat = { updatedAt: new Date(NOW.getTime() - HEARTBEAT_FRESHNESS_MS - 1000), staleAlertSentAt: null };
    expect(decideHeartbeatAlertAction(heartbeat, NOW)).toBe("SEND_ALERT");
  });

  it("does not re-send while still stale and already alerted", () => {
    const heartbeat = { updatedAt: new Date(NOW.getTime() - HEARTBEAT_FRESHNESS_MS - 1000), staleAlertSentAt: NOW };
    expect(decideHeartbeatAlertAction(heartbeat, NOW)).toBe("NONE");
  });

  it("clears the alert once the heartbeat is fresh again", () => {
    const heartbeat = { updatedAt: NOW, staleAlertSentAt: new Date(NOW.getTime() - 60_000) };
    expect(decideHeartbeatAlertAction(heartbeat, NOW)).toBe("CLEAR_ALERT");
  });

  it("does nothing when fresh and no alert is pending", () => {
    const heartbeat = { updatedAt: NOW, staleAlertSentAt: null };
    expect(decideHeartbeatAlertAction(heartbeat, NOW)).toBe("NONE");
  });
});
