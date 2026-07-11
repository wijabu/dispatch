import type { FillScript } from "./types";
import { craigslistFill } from "./craigslist";
import { watchuseekFill } from "./watchuseek";
import { offerupFill } from "./offerup";

export type { FillContext, FillResult, FillScript } from "./types";

export const fillScripts: FillScript[] = [craigslistFill, watchuseekFill, offerupFill];

export function getFillScript(publisherId: string): FillScript | undefined {
  return fillScripts.find((s) => s.publisherId === publisherId);
}
