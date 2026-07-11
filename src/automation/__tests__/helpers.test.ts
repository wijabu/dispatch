import { describe, expect, it } from "vitest";
import { newTracker, resolveResult, tryStep } from "../helpers";

describe("tryStep / resolveResult", () => {
  it("all steps succeed -> ready", async () => {
    const t = newTracker();
    await tryStep(t, "title", async () => {});
    await tryStep(t, "photos", async () => {});
    expect(resolveResult(t)).toEqual({ status: "ready" });
  });

  it("one step fails -> partial with failedAt and the filled list", async () => {
    const t = newTracker();
    await tryStep(t, "title", async () => {});
    await tryStep(t, "photos", async () => {
      throw new Error("no file input");
    });
    expect(resolveResult(t)).toEqual({
      status: "partial",
      failedAt: "photos",
      filled: ["title"],
    });
  });

  it("a failed step returns false so scripts can skip dependents", async () => {
    const t = newTracker();
    const ok = await tryStep(t, "navigate", async () => {
      throw new Error("nope");
    });
    expect(ok).toBe(false);
  });

  it("nothing filled -> failed", async () => {
    const t = newTracker();
    await tryStep(t, "navigate", async () => {
      throw new Error("dead");
    });
    expect(resolveResult(t)).toEqual({
      status: "failed",
      reason: "navigate failed",
    });
  });
});
