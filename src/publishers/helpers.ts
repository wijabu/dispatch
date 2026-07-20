import type { Item, Photo } from "@/db/schema";
import { CONDITION_LABELS } from "@/lib/format";

export function formatUsd(price: number | null): string | null {
  if (price == null) return null;
  const hasCents = price % 1 !== 0;
  return (
    "$" +
    price.toLocaleString("en-US", {
      minimumFractionDigits: hasCents ? 2 : 0,
      maximumFractionDigits: hasCents ? 2 : 0,
    })
  );
}

export function specLines(item: Item): string[] {
  return Object.entries(item.attributes).map(([key, value]) => `${key}: ${value}`);
}

// Put a blank line between sentences and bullets so a description is easy for a
// human to scan (a wall of text is not). Reliable pieces:
//  - bullets are split on the "•" marker;
//  - sentences are split on a terminal . ! ? followed by whitespace and a
//    capital/opening-quote/bracket/bullet — the trailing lookahead avoids
//    splitting decimals ("23.6\"") and inch-marks, which have no following space.
// Any blank-line breaks the author already typed are preserved (paragraphs are
// split first), so hand-formatted descriptions pass through intact.
export function formatDescription(text: string | null | undefined): string {
  if (!text) return "";
  const chunks: string[] = [];
  for (const para of text.trim().split(/\n\s*\n/)) {
    const line = para.replace(/\s+/g, " ").trim();
    if (!line) continue;
    for (const part of line.split(/\s*(?=•\s)/).filter(Boolean)) {
      for (const sentence of part.split(/(?<=[.!?])\s+(?=[A-Z“"(•])/)) {
        const trimmed = sentence.trim();
        if (trimmed) chunks.push(trimmed);
      }
    }
  }
  return chunks.join("\n\n");
}

export function conditionLabel(item: Item): string {
  return CONDITION_LABELS[item.condition];
}

export function commonWarnings(item: Item, photos: Photo[]): string[] {
  const warnings: string[] = [];
  if (item.askingPrice == null) warnings.push("No asking price set");
  if (photos.length === 0) warnings.push("No photos");
  return warnings;
}
