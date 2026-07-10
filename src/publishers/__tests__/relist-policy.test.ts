import { describe, expect, it } from "vitest";
import { publishers, getPublisher } from "../index";

describe("relist policies (researched July 2026, see v1.1 spec)", () => {
  it("every publisher declares a policy", () => {
    for (const pub of publishers) {
      expect(pub.relistPolicy, pub.id).toBeDefined();
      expect(pub.relistPolicy.intervalDays).toBeGreaterThan(0);
      expect(pub.relistPolicy.minIntervalDays).toBeGreaterThanOrEqual(0);
    }
  });

  it("reddit-watchexchange: repost, 7-day hard cooldown", () => {
    expect(getPublisher("reddit-watchexchange")?.relistPolicy).toEqual({
      method: "repost",
      intervalDays: 7,
      minIntervalDays: 7,
    });
  });

  it("offerup: delete+repost weekly, no hard rule", () => {
    expect(getPublisher("offerup")?.relistPolicy).toEqual({
      method: "delete-repost",
      intervalDays: 7,
      minIntervalDays: 0,
    });
  });

  it("facebook: renew weekly, fresh relist after 42 days", () => {
    expect(getPublisher("facebook")?.relistPolicy).toEqual({
      method: "renew-then-repost",
      intervalDays: 7,
      minIntervalDays: 7,
      freshRelistAfterDays: 42,
    });
  });

  it("craigslist: renew every 3 days, 2-day hard floor, repost after 30", () => {
    expect(getPublisher("craigslist")?.relistPolicy).toEqual({
      method: "renew-then-repost",
      intervalDays: 3,
      minIntervalDays: 2,
      freshRelistAfterDays: 30,
    });
  });

  it("watchuseek: bump weekly", () => {
    expect(getPublisher("watchuseek")?.relistPolicy).toEqual({
      method: "bump",
      intervalDays: 7,
      minIntervalDays: 7,
    });
  });
});
