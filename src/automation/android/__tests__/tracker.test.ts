import { describe, expect, it } from "vitest";
import { newTracker, tryStep, resolveResult } from "../types";
import { step } from "../flows/post";
import type { Adb } from "../adb";

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
  it("carries the first failure's screenshot into the result", () => {
    const t = newTracker();
    t.failed.push({ step: "save", reason: "timeout", screenshot: "/tmp/shot.png" });
    expect(resolveResult(t)).toEqual({
      status: "failed", step: "save", reason: "timeout", screenshot: "/tmp/shot.png",
    });
  });
});

describe("step()", () => {
  it("records the failure screenshot path on the tracker", async () => {
    const fakeAdb = { screencap: async () => {} } as unknown as Adb;
    const t = newTracker();
    const ok = await step(fakeAdb, t, "set price", async () => { throw new Error("no node"); });
    expect(ok).toBe(false);
    expect(t.failed[0].screenshot).toMatch(/automation-debug[\\/]post-set-price-\d+\.png$/);
    expect(resolveResult(t)).toMatchObject({ status: "failed", step: "set price", reason: "no node" });
  });
  it("leaves screenshot unset when the capture fails", async () => {
    const fakeAdb = { screencap: async () => { throw new Error("adb gone"); } } as unknown as Adb;
    const t = newTracker();
    await step(fakeAdb, t, "save", async () => { throw new Error("boom"); });
    expect(resolveResult(t)).toEqual({ status: "failed", step: "save", reason: "boom" });
  });
});
