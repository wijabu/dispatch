import type { Publisher } from "./types";
import { commonWarnings, conditionLabel, formatDescription, formatUsd, LOCAL_PICKUP_TERMS, specLines } from "./helpers";

const TITLE_LIMIT = 70;

export const craigslist: Publisher = {
  id: "craigslist",
  name: "Craigslist",
  relistPolicy: { method: "renew-then-repost", intervalDays: 3, minIntervalDays: 2, freshRelistAfterDays: 30 },
  generate(item, photos) {
    const price = formatUsd(item.askingPrice);
    const title = price ? `${item.name} - ${price}` : item.name;
    const warnings = commonWarnings(item, photos);
    if (title.length > TITLE_LIMIT) {
      warnings.push(`Title exceeds Craigslist's ${TITLE_LIMIT}-character limit (${title.length})`);
    }
    const specs = specLines(item);
    const body = [formatDescription(item.description), `Condition: ${conditionLabel(item)}`, ...specs, LOCAL_PICKUP_TERMS]
      .filter(Boolean)
      .join("\n");
    return { title, body, warnings };
  },
};
