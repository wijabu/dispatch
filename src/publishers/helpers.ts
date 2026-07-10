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

export function conditionLabel(item: Item): string {
  return CONDITION_LABELS[item.condition];
}

export function commonWarnings(item: Item, photos: Photo[]): string[] {
  const warnings: string[] = [];
  if (item.askingPrice == null) warnings.push("No asking price set");
  if (photos.length === 0) warnings.push("No photos");
  return warnings;
}
