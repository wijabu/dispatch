import { describe, expect, it } from "vitest";
import type { RelistPolicy } from "@/publishers/types";
import { formatCountdown, refreshStatus, soonestRefresh } from "../refresh";

const NOW = new Date("2026-10-16T16:00:00Z");
const weekly: RelistPolicy = { method: "repost", intervalDays: 7, minIntervalDays: 7 };

describe("formatCountdown", () => {
  it("uses the largest meaningful unit", () => {
    expect(formatCountdown(3 * 86_400_000)).toBe("3d");
    expect(formatCountdown(18 * 3_600_000)).toBe("18h");
    expect(formatCountdown(45 * 60_000)).toBe("45m");
  });
  it("never emits 0d and floors to at least 1m", () => {
    expect(formatCountdown(0)).toBe("1m");
    expect(formatCountdown(30_000)).toBe("1m");
    expect(formatCountdown(23 * 3_600_000)).toBe("23h");
  });
});

describe("refreshStatus", () => {
  it("is upcoming before the due mark", () => {
    const s = refreshStatus({ listedAt: "2026-10-14 16:00:00", renewedAt: null }, weekly, NOW);
    expect(s.state).toBe("upcoming");
    expect(s.token).toBe("5d");
  });
  it("is due within 24h of the mark", () => {
    const s = refreshStatus({ listedAt: "2026-10-09 12:00:00", renewedAt: null }, weekly, NOW);
    expect(s.state).toBe("due");
    expect(s.token).toBe("due now");
  });
  it("is overdue past 24h after the mark", () => {
    const s = refreshStatus({ listedAt: "2026-10-01 12:00:00", renewedAt: null }, weekly, NOW);
    expect(s.state).toBe("overdue");
    expect(s.token).toBe("overdue 8d");
  });
  it("anchors on renewedAt when present", () => {
    const s = refreshStatus(
      { listedAt: "2026-09-01 00:00:00", renewedAt: "2026-10-14 16:00:00" },
      weekly,
      NOW
    );
    expect(s.state).toBe("upcoming");
    expect(s.token).toBe("5d");
  });
  it("respects the platform minimum (max of interval and minInterval)", () => {
    const biasedMin: RelistPolicy = { method: "repost", intervalDays: 3, minIntervalDays: 7 };
    const s = refreshStatus({ listedAt: "2026-10-10 16:00:00", renewedAt: null }, biasedMin, NOW);
    // due = Oct 10 + 7d = Oct 17 16:00 → 1 day out, not Oct 13.
    expect(s.state).toBe("upcoming");
    expect(s.token).toBe("1d");
  });
});

describe("soonestRefresh", () => {
  it("returns the earliest-due (most urgent) across listings", () => {
    const s = soonestRefresh(
      [
        { listing: { listedAt: "2026-10-14 16:00:00", renewedAt: null }, policy: weekly }, // upcoming 5d
        { listing: { listedAt: "2026-10-01 12:00:00", renewedAt: null }, policy: weekly }, // overdue 8d
      ],
      NOW
    );
    expect(s?.state).toBe("overdue");
  });
  it("returns null with no listings", () => {
    expect(soonestRefresh([], NOW)).toBeNull();
  });
});
