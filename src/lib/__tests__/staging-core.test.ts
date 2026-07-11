import { describe, expect, it, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import fs from "fs/promises";
import os from "os";
import path from "path";
import * as schema from "@/db/schema";
import { items, photos } from "@/db/schema";
import { stagePhotosCore } from "../staging-core";

let db: BetterSQLite3Database<typeof schema>;
let photosRoot: string;
let stagingRoot: string;
let itemId: number;

beforeEach(async () => {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });

  photosRoot = await fs.mkdtemp(path.join(os.tmpdir(), "photos-"));
  stagingRoot = await fs.mkdtemp(path.join(os.tmpdir(), "staging-"));

  const [item] = await db.insert(items).values({ name: "Lamp" }).returning();
  itemId = item.id;
  await fs.writeFile(path.join(photosRoot, "b.jpg"), "second");
  await fs.writeFile(path.join(photosRoot, "a.jpg"), "first");
  await db.insert(photos).values([
    { itemId, path: "a.jpg", sortOrder: 0 },
    { itemId, path: "b.jpg", sortOrder: 1 },
  ]);
});

describe("stagePhotosCore", () => {
  it("copies photos in sort order with numbered names", async () => {
    const staged = await stagePhotosCore(db, itemId, photosRoot, stagingRoot);
    expect(staged.map((p) => path.basename(p))).toEqual(["01-a.jpg", "02-b.jpg"]);
    expect(await fs.readFile(staged[0], "utf8")).toBe("first");
  });

  it("re-staging wipes the previous staging dir first", async () => {
    await stagePhotosCore(db, itemId, photosRoot, stagingRoot);
    const dir = path.join(stagingRoot, `item-${itemId}`);
    await fs.writeFile(path.join(dir, "stale.txt"), "old");
    const staged = await stagePhotosCore(db, itemId, photosRoot, stagingRoot);
    const names = await fs.readdir(dir);
    expect(names.sort()).toEqual(["01-a.jpg", "02-b.jpg"]);
    expect(staged).toHaveLength(2);
  });

  it("item with no photos stages an empty dir", async () => {
    const [bare] = await db.insert(items).values({ name: "Bare" }).returning();
    const staged = await stagePhotosCore(db, bare.id, photosRoot, stagingRoot);
    expect(staged).toEqual([]);
  });
});
