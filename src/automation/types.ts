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
  // Where "Log in" opens so the user can authenticate once into the persistent
  // profile. Some form pages (e.g. WUS create-thread) don't render a login form
  // when logged out, so we send them to the site's normal login/home page
  // instead. Defaults to the startUrl's origin when unset.
  loginUrl?: string;
  isLoginWall(page: Page): Promise<boolean>;
  fill(page: Page, ctx: FillContext): Promise<FillResult>;
}
