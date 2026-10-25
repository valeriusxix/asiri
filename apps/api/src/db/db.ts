import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export type DB = Database.Database;

const MIGRATIONS = readFileSync(new URL("./migrations.sql", import.meta.url), "utf8");

/** Open (or create) the database and run the idempotent migrations. Use ":memory:" in tests. */
export function openDb(file: string): DB {
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(MIGRATIONS);
  return db;
}

export function audit(db: DB, type: string, payload: Record<string, unknown>, at: Date): void {
  db.prepare(`INSERT INTO audit_events (type, payload, created_at) VALUES (?, ?, ?)`).run(
    type,
    JSON.stringify(payload),
    at.toISOString(),
  );
}
