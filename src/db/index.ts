import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "path";
import fs from "fs";
import * as schema from "./schema";

const DATA_DIR = path.join(process.cwd(), "data");
const PHOTOS_DIR = path.join(DATA_DIR, "photos");

fs.mkdirSync(PHOTOS_DIR, { recursive: true });

const sqlite = new Database(path.join(DATA_DIR, "dispatch.db"));
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });

migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });

export { DATA_DIR, PHOTOS_DIR };
