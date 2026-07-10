import type { Publisher } from "./types";
import { commonWarnings, conditionLabel, formatUsd, specLines } from "./helpers";

export const watchuseek: Publisher = {
  id: "watchuseek",
  name: "Watchuseek",
  generate(item, photos) {
    const price = formatUsd(item.askingPrice);
    const specs = specLines(item);
    const body = [
      item.description,
      specs.length ? "Specifications:\n" + specs.map((line) => `- ${line}`).join("\n") : "",
      `Condition: ${conditionLabel(item)}`,
      price ? `Asking ${price} shipped and insured, CONUS.` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    return {
      title: price ? `FS: ${item.name} - ${price}` : `FS: ${item.name}`,
      body,
      warnings: commonWarnings(item, photos),
    };
  },
};
