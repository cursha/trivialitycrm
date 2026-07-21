import { describe, it, expect } from "vitest";
import { formatWallClock } from "../../src/lib/comms/calendar-time";

describe("formatWallClock", () => {
  it("formats a UTC instant as the local wall-clock time in the given zone", () => {
    // 2026-08-01T18:00:00Z is 2pm in America/Toronto (EDT, UTC-4 in August).
    const instant = new Date("2026-08-01T18:00:00.000Z");
    expect(formatWallClock(instant, "America/Toronto")).toBe("2026-08-01T14:00:00");
  });

  it("produces a different wall-clock string for a different timezone, same instant", () => {
    const instant = new Date("2026-08-01T18:00:00.000Z");
    expect(formatWallClock(instant, "America/Los_Angeles")).toBe("2026-08-01T11:00:00");
  });

  it("crosses a date boundary correctly near midnight UTC", () => {
    // 2026-01-01T02:00:00Z is 2025-12-31 9pm EST (UTC-5 in January) — the
    // previous calendar day in this timezone.
    const instant = new Date("2026-01-01T02:00:00.000Z");
    expect(formatWallClock(instant, "America/Toronto")).toBe("2025-12-31T21:00:00");
  });
});
