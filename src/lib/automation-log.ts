import fs from "fs";
import path from "path";
import type { AndroidResult } from "@/automation/android/types";

// Durable record of every emulator action. Server actions otherwise return
// their result to the page only, so a failure's reason is gone once the page
// refreshes. One JSON object per line; gitignored via data/.
export const AUTOMATION_LOG_PATH = path.join(process.cwd(), "data", "automation-log.jsonl");

export type AutomationAction =
  | "post"
  | "reprice"
  | "relist"
  | "mark_sold"
  | "drop_reprice"
  | "drop_relist";

export interface AutomationLogEntry {
  at: string; // ISO timestamp
  action: AutomationAction;
  itemId: number;
  itemName?: string;
  channel: string;
  outcome: string;
  step?: string;
  reason?: string;
  screenshot?: string; // under data/automation-debug/
}

export function resultFields(
  result: AndroidResult
): Pick<AutomationLogEntry, "outcome" | "step" | "reason" | "screenshot"> {
  if (result.status !== "failed") return { outcome: result.status };
  return {
    outcome: "failed",
    step: result.step,
    reason: result.reason,
    ...(result.screenshot ? { screenshot: result.screenshot } : {}),
  };
}

export function formatLogLine(e: AutomationLogEntry): string {
  let line = `[automation] ${e.at} ${e.action} ${e.channel} #${e.itemId}`;
  if (e.itemName) line += ` "${e.itemName}"`;
  line += ` ${e.outcome}`;
  if (e.reason) line += e.step ? ` ${e.step}: ${e.reason}` : ` ${e.reason}`;
  if (e.screenshot) line += ` (screenshot: ${e.screenshot})`;
  return line;
}

// Prints to stdout (the Dispatch Terminal window) and appends to the JSONL
// file. Best-effort: logging must never fail or mask the action it records.
export async function logAutomation(
  entry: AutomationLogEntry,
  file: string = AUTOMATION_LOG_PATH
): Promise<void> {
  console.log(formatLogLine(entry));
  try {
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.appendFile(file, JSON.stringify(entry) + "\n");
  } catch {
    // ignore; the Terminal line above is the fallback record
  }
}
