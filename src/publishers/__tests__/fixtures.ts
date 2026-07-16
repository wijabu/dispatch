import type { Item, Photo } from "@/db/schema";

export function makeItem(overrides: Partial<Item> = {}): Item {
  return {
    id: 1,
    name: "Rolex Explorer 124270",
    description: "Excellent condition Explorer, purchased 2022. Keeps great time.",
    category: "watches",
    condition: "excellent",
    status: "ready",
    purchasePrice: 6000,
    askingPrice: 6800,
    minimumPrice: 6200,
    soldPrice: null,
    offerupCategory: null,
    offerupSubcategory: null,
    notes: "",
    attributes: {
      Brand: "Rolex",
      Model: "Explorer",
      Reference: "124270",
      Movement: "Automatic",
      Diameter: "36mm",
      "Box/Papers": "Full Set",
    },
    acquiredAt: "2025-11-02",
    soldAt: null,
    dropAmount: null,
    dropPercent: null,
    dropIntervalDays: null,
    snoozedUntil: null,
    createdAt: "2026-07-10 12:00:00",
    updatedAt: "2026-07-10 12:00:00",
    ...overrides,
  };
}

export const deskOverrides: Partial<Item> = {
  id: 2,
  name: "IKEA Bekant Standing Desk",
  description: "Unused computer desk, still has the plastic on the legs.",
  category: "furniture",
  condition: "like_new",
  purchasePrice: null,
  askingPrice: 120,
  minimumPrice: null,
  attributes: {},
};

export function makePhotos(count: number): Photo[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    itemId: 1,
    path: `1-photo-${i + 1}.jpg`,
    sortOrder: i,
    createdAt: "2026-07-10 12:00:00",
  }));
}
