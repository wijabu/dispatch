import type { Publisher } from "./types";
import { commonWarnings, conditionLabel, specLines } from "./helpers";

const TITLE_LIMIT = 80;
const PHOTO_LIMIT = 12;

export const offerup: Publisher = {
  id: "offerup",
  name: "OfferUp",
  generate(item, photos) {
    const warnings = commonWarnings(item, photos);
    if (item.name.length > TITLE_LIMIT) {
      warnings.push(`Title exceeds OfferUp's ${TITLE_LIMIT}-character limit (${item.name.length})`);
    }
    if (photos.length > PHOTO_LIMIT) {
      warnings.push(`OfferUp allows up to ${PHOTO_LIMIT} photos; you have ${photos.length}`);
    }
    const specs = specLines(item);
    const body = [item.description, `Condition: ${conditionLabel(item)}`, ...specs]
      .filter(Boolean)
      .join("\n");
    return {
      title: item.name,
      body,
      structuredFields: {
        Price: item.askingPrice != null ? String(item.askingPrice) : "",
        Condition: conditionLabel(item),
      },
      warnings,
    };
  },
};
