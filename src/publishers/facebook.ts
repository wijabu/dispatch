import type { Publisher } from "./types";
import { commonWarnings, conditionLabel, formatDescription, LOCAL_PICKUP_TERMS, specLines } from "./helpers";

const TITLE_LIMIT = 99;

export const facebookMarketplace: Publisher = {
  id: "facebook",
  name: "Facebook Marketplace",
  // Renew-only: Facebook hard-blocks publishing a listing whose main photo
  // matches another live listing, so a "post fresh copy, then delete old" repost
  // is impossible. Rely on native Renew for freshness (no freshRelistAfterDays →
  // the engine always suggests "renew", never a fresh repost). Reprice handles
  // price drops separately.
  relistPolicy: { method: "renew-then-repost", intervalDays: 7, minIntervalDays: 7 },
  generate(item, photos) {
    const warnings = commonWarnings(item, photos);
    if (item.name.length > TITLE_LIMIT) {
      warnings.push(`Title exceeds Facebook's ${TITLE_LIMIT}-character limit (${item.name.length})`);
    }
    const specs = specLines(item);
    const body = [formatDescription(item.description), `Condition: ${conditionLabel(item)}`, ...specs, LOCAL_PICKUP_TERMS]
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
