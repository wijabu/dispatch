import { describe, expect, it } from "vitest";
import { newTracker, tryStep, resolveResult } from "../types";

describe("android flow tracker", () => {
  it("returns done when all steps pass", async () => {
    const t = newTracker();
    await tryStep(t, "a", async () => {});
    expect(resolveResult(t)).toEqual({ status: "done" });
  });
  it("returns failed with the first failing step name", async () => {
    const t = newTracker();
    await tryStep(t, "open", async () => {});
    await tryStep(t, "price", async () => { throw new Error("no node"); });
    expect(resolveResult(t)).toEqual({ status: "failed", step: "price", reason: "no node" });
  });
});
