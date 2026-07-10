import type { Publisher } from "./types";
import { commonWarnings, conditionLabel, formatUsd, specLines } from "./helpers";

export const redditWatchexchange: Publisher = {
  id: "reddit-watchexchange",
  name: "Reddit r/Watchexchange",
  generate(item, photos) {
    const price = formatUsd(item.askingPrice);
    const titleParts = [`[WTS] ${item.name}`];
    if (price) titleParts.push(price);
    if (item.attributes["Box/Papers"]) titleParts.push(item.attributes["Box/Papers"]);
    const specs = specLines(item);
    const body = [
      item.description,
      specs.length ? "Specs:\n" + specs.map((line) => `* ${line}`).join("\n") : "",
      `Condition: ${conditionLabel(item)}`,
      price ? `Price: ${price} shipped CONUS` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    return { title: titleParts.join(" | "), body, warnings: commonWarnings(item, photos) };
  },
};
