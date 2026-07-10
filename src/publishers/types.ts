import type { Item, Photo } from "@/db/schema";

export interface GeneratedListing {
  title: string;
  body: string;
  structuredFields?: Record<string, string>;
  warnings: string[];
}

export interface Publisher {
  id: string;
  name: string;
  generate(item: Item, photos: Photo[]): GeneratedListing;
}
