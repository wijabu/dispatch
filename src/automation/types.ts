import type { Page } from "playwright";
import type { Item } from "@/db/schema";
import type { GeneratedListing } from "@/publishers/types";

export interface FillContext {
  listing: GeneratedListing;
  item: Item;
  photoPaths: string[]; // absolute, primary photo first
}

export type FillResult =
  | { status: "ready" }
  | { status: "login_required" }
  | { status: "partial"; failedAt: string; filled: string[] }
  | { status: "failed"; reason: string };

export interface FillScript {
  publisherId: string;
  startUrl: string;
  isLoginWall(page: Page): Promise<boolean>;
  fill(page: Page, ctx: FillContext): Promise<FillResult>;
}
