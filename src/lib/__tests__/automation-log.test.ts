import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  formatLogLine,
  logAutomation,
  resultFields,
  type AutomationLogEntry,
} from "../automation-log";

const AT = "2026-10-24T13:42:01.000Z";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-log-"));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resultFields", () => {
  it("maps a success to its status", () => {
    expect(resultFields({ status: "done" })).toEqual({ outcome: "done" });
    expect(resultFields({ status: "login_required" })).toEqual({ outcome: "login_required" });
  });
  it("maps a failure with step, reason and screenshot", () => {
    expect(
      resultFields({ status: "failed", step: "save", reason: "timeout", screenshot: "/x.png" })
    ).toEqual({ outcome: "failed", step: "save", reason: "timeout", screenshot: "/x.png" });
  });
  it("omits screenshot when the failure has none", () => {
    expect(resultFields({ status: "failed", step: "lock", reason: "busy" })).toEqual({
      outcome: "failed", step: "lock", reason: "busy",
    });
  });
});

describe("formatLogLine", () => {
  it("formats a full failure", () => {
    const e: AutomationLogEntry = {
      at: AT, action: "relist", itemId: 16, itemName: "Jumperoo", channel: "offerup",
      outcome: "failed", step: "archive old listing", reason: "not confirmed", screenshot: "/d/a.png",
    };
    expect(formatLogLine(e)).toBe(
      '[automation] 2026-10-24T13:42:01.000Z relist offerup #16 "Jumperoo" failed archive old listing: not confirmed (screenshot: /d/a.png)'
    );
  });
  it("formats a minimal success", () => {
    expect(
      formatLogLine({ at: AT, action: "reprice", itemId: 3, channel: "facebook", outcome: "done" })
    ).toBe("[automation] 2026-10-24T13:42:01.000Z reprice facebook #3 done");
  });
  it("formats a reason without a step", () => {
    expect(
      formatLogLine({ at: AT, action: "drop_reprice", itemId: 3, channel: "craigslist", outcome: "manual", reason: "update by hand" })
    ).toBe("[automation] 2026-10-24T13:42:01.000Z drop_reprice craigslist #3 manual update by hand");
  });
});

describe("logAutomation", () => {
  it("appends one JSON line per entry and prints the readable line", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const file = path.join(tmpDir(), "nested", "automation-log.jsonl");
    const a: AutomationLogEntry = { at: AT, action: "post", itemId: 1, channel: "offerup", outcome: "posted_review" };
    const b: AutomationLogEntry = { at: AT, action: "reprice", itemId: 2, channel: "facebook", outcome: "failed", step: "lock", reason: "busy" };
    await logAutomation(a, file);
    await logAutomation(b, file);
    const lines = fs.readFileSync(file, "utf8").trim().split("\n");
    expect(lines.map((l) => JSON.parse(l))).toEqual([a, b]);
    expect(spy).toHaveBeenCalledWith(formatLogLine(a));
  });
  it("swallows write errors", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const dir = tmpDir(); // appending to a directory fails with EISDIR
    await expect(
      logAutomation({ at: AT, action: "post", itemId: 1, channel: "offerup", outcome: "done" }, dir)
    ).resolves.toBeUndefined();
  });
});
