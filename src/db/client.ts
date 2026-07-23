import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema";
import { DATA_ROOT } from "@/pipeline/lib/paths";

export const DB_PATH = path.join(DATA_ROOT, "resume-video.db");

type DrizzleDb = BetterSQLite3Database<typeof schema>;

// Singleton em globalThis: sobrevive ao hot reload do `next dev`
// (mesmo padrão consagrado do Prisma). O estado real vive no SQLite.
const globalForDb = globalThis as unknown as { __resumeVideoDb?: DrizzleDb };

function createDb(): DrizzleDb {
  fs.mkdirSync(DATA_ROOT, { recursive: true });
  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  return drizzle(sqlite, { schema });
}

export const db: DrizzleDb = globalForDb.__resumeVideoDb ?? createDb();
globalForDb.__resumeVideoDb = db;

export { schema };
