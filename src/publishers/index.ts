import type { Publisher } from "./types";
import { offerup } from "./offerup";
import { facebookMarketplace } from "./facebook";
import { craigslist } from "./craigslist";
import { redditWatchexchange } from "./reddit-watchexchange";
import { watchuseek } from "./watchuseek";

export type { Publisher, GeneratedListing, RelistPolicy } from "./types";

export const publishers: Publisher[] = [
  offerup,
  facebookMarketplace,
  craigslist,
  redditWatchexchange,
  watchuseek,
];

export function getPublisher(id: string): Publisher | undefined {
  return publishers.find((p) => p.id === id);
}
