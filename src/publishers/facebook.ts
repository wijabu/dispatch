import type { Publisher } from "./types";
import { commonWarnings, conditionLabel, formatDescription, specLines } from "./helpers";

const TITLE_LIMIT = 99;

export const facebookMarketplace: Publisher = {
  id: "facebook",
  name: "Facebook Marketplace",
  relistPolicy: { method: "renew-then-repost", intervalDays: 7, minIntervalDays: 7, freshRelistAfterDays: 42 },
  generate(item, photos) {
    const warnings = commonWarnings(item, photos);
    if (item.name.length > TITLE_LIMIT) {
      warnings.push(`Title exceeds Facebook's ${TITLE_LIMIT}-character limit (${item.name.length})`);
    }
    const specs = specLines(item);
    const body = [formatDescription(item.description), `Condition: ${conditionLabel(item)}`, ...specs]
      .filter(Boolean)
      .join("\n");
    return {
      title: item.name,
      body,
      structuredFields: {
        Price: item.askingPrice != null ? String(item.askingPrice) : "",
        Condition: conditionLabel(item),
        Category: item.category,
      },
      warnings,
    };
  },
};
