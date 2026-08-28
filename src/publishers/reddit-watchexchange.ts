import type { Publisher } from "./types";
import { commonWarnings, formatUsd } from "./helpers";

const PAYMENT_METHOD = "PayPal F&F or G&S Invoice (+4% paid by buyer)";

// Wil's r/WatchExchange spec block, in his order. Maps an item.attributes key to
// the label he uses in the post; only fields with a value are emitted.
const SPEC_FIELDS: ReadonlyArray<readonly [key: string, label: string]> = [
  ["Diameter", "Case size"],
  ["Thickness", "Thickness"],
  ["Lug Width", "Lugs"],
  ["Lug-to-Lug", "Lug-to-Lug"],
  ["Water Resistance", "Water Resistance"],
];

// Emits Wil's house format (learned from his 11-post corpus, 2026-08-27):
// a title-only post + a first comment he pastes. Photos/timestamp are imgur
// albums he adds at post time, so they render as placeholders here.
export const redditWatchexchange: Publisher = {
  id: "reddit-watchexchange",
  name: "Reddit r/Watchexchange",
  relistPolicy: { method: "repost", intervalDays: 7, minIntervalDays: 7 },
  generate(item, photos) {
    const a = item.attributes;
    const kit = a["Kit"] ?? "Full Kit";
    const variant = a["Variant"];
    const photosAlbum = a["Photos Album"] ?? "PHOTOS_ALBUM_URL";
    const timestampLink = a["Timestamp"] ?? "TIMESTAMP_ALBUM_URL";

    const title = `[WTS] ${item.name}${variant ? ` - ${variant}` : ""} - ${kit}`;

    const price = formatUsd(item.askingPrice);
    // Labeled block: specs, then condition/price/includes/payment. Joined with a
    // Markdown HARD break ("  \n") so each line stays on its own line on Reddit —
    // a plain "\n" collapses to a space there and runs the stats together.
    const block = [
      ...SPEC_FIELDS.filter(([k]) => a[k]).map(([k, label]) => `${label}: ${a[k]}`),
      a["Condition Rating"] ? `Condition: ${a["Condition Rating"]}` : "",
      price ? `Price/Shipping: ${price} USD Shipped to CONUS by USPS.` : "",
      `Includes ${kit}: ${a["Kit Contents"] ?? "Original box and papers"}`,
      `Payment Method: ${PAYMENT_METHOD}`,
    ].filter(Boolean).join("  \n");

    // Blank-line-separated sections: intro, photos, prose, labeled block, then
    // Wil's fixed closer (no-trades + sign-off). The description passes through
    // AS WRITTEN (his paragraphs) — no sentence-splitting, which on Reddit would
    // put every sentence on its own line.
    const body = [
      `For your consideration today is the ${item.name} - ${kit}`,
      `[Photos](${photosAlbum}) | [Timestamp](${timestampLink})`,
      item.description.trim(),
      block,
      "Not looking for any trades",
      "Cheers",
    ].filter(Boolean).join("\n\n");

    return { title, body, warnings: commonWarnings(item, photos) };
  },
};
