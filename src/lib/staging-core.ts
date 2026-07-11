import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { asc, eq } from "drizzle-orm";
import fs from "fs/promises";
import path from "path";
import type * as schema from "@/db/schema";
import { photos } from "@/db/schema";

type DB = BetterSQLite3Database<typeof schema>;

// Copy an item's photos (sort order, numbered) into a per-item staging dir
// so they sit alone in a Finder window, ready to drag into a marketplace.
export async function stagePhotosCore(
  db: DB,
  itemId: number,
  photosRoot: string,
  stagingRoot: string
): Promise<string[]> {
  const rows = await db
    .select()
    .from(photos)
    .where(eq(photos.itemId, itemId))
    .orderBy(asc(photos.sortOrder));

  const dir = path.join(stagingRoot, `item-${itemId}`);
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });

  const staged: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const src = path.join(photosRoot, rows[i].path);
    const dest = path.join(
      dir,
      `${String(i + 1).padStart(2, "0")}-${rows[i].path.replace(/^\d+-/, "")}`
    );
    await fs.copyFile(src, dest);
    staged.push(dest);
  }
  return staged;
}
