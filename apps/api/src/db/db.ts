import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { CURRENCY_CODES } from "../lib/currency.js";

export type DB = Database.Database;

/** The base schema (Agent.md Section 7). Idempotent: CREATE … IF NOT EXISTS. */
export const BASE_SCHEMA = readFileSync(new URL("./migrations.sql", import.meta.url), "utf8");

const CURRENCY_CHECK = `CHECK (currency IN (${CURRENCY_CODES.map((c) => `'${c}'`).join(",")}))`;

/**
 * Multi-currency payouts (D-038). Added with ALTER TABLE ADD COLUMN, never a table rebuild, so existing databases keep
 * every row. Rows from before this migration were all naira: they are backfilled from the legacy NGN columns, which
 * stay in place (still written, no longer read). Safe to run on every boot.
 */
const PAYOUT_COLUMNS: [name: string, definition: string][] = [
  ["currency", `TEXT ${CURRENCY_CHECK}`],
  ["amount_fiat_minor", "INTEGER"],
  ["rate_zec_fiat", "REAL"],
];

/** Base schema, then every later migration. Running it twice changes nothing. */
export function applyMigrations(db: DB): void {
  db.exec(BASE_SCHEMA);
  db.transaction(() => {
    const have = new Set((db.prepare(`PRAGMA table_info(payouts)`).all() as { name: string }[]).map((c) => c.name));
    for (const [name, definition] of PAYOUT_COLUMNS) {
      if (!have.has(name)) db.exec(`ALTER TABLE payouts ADD COLUMN ${name} ${definition}`);
    }
    db.exec(
      `UPDATE payouts SET currency = 'NGN', amount_fiat_minor = amount_ngn_at_creation * 100, rate_zec_fiat = rate_zec_ngn
       WHERE currency IS NULL`,
    );
  })();
}

/** Open (or create) the database and run the idempotent migrations. Use ":memory:" in tests. */
export function openDb(file: string): DB {
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  applyMigrations(db);
  return db;
}

export function audit(db: DB, type: string, payload: Record<string, unknown>, at: Date): void {
  db.prepare(`INSERT INTO audit_events (type, payload, created_at) VALUES (?, ?, ?)`).run(
    type,
    JSON.stringify(payload),
    at.toISOString(),
  );
}
