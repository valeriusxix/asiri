-- Asiri base schema (Agent.md Section 7). Idempotent: run on every boot.
-- Later columns (payouts.currency, amount_fiat_minor, rate_zec_fiat) are added by applyMigrations() in db.ts with
-- ALTER TABLE ADD COLUMN, so existing databases are never rebuilt.

CREATE TABLE IF NOT EXISTS donations (
  id            TEXT PRIMARY KEY,               -- uuid
  source        TEXT NOT NULL CHECK (source IN ('zcash','simulated')),
  txid          TEXT UNIQUE,                    -- null for simulated
  amount_zat    INTEGER NOT NULL CHECK (amount_zat > 0),
  memo          TEXT,                           -- donor memo if any; admin-only, never shown publicly
  observed_at   TEXT NOT NULL                   -- ISO timestamp
);

CREATE TABLE IF NOT EXISTS payouts (
  id                       TEXT PRIMARY KEY,     -- 10-char url-safe random id
  amount_zat               INTEGER NOT NULL CHECK (amount_zat > 0),
  fee_buffer_zat           INTEGER NOT NULL,
  amount_ngn_at_creation   INTEGER NOT NULL,     -- legacy (D-038): naira equivalent, still written, no longer read
  rate_zec_ngn             REAL NOT NULL,        -- legacy (D-038): still written, no longer read
  category                 TEXT NOT NULL CHECK (category IN ('medical','legal','food','transport','shelter','other')),
  internal_note            TEXT,                 -- organizer-only, never public, must not contain names
  status                   TEXT NOT NULL CHECK (status IN ('active','claiming','claimed','expired','cancelled','locked')),
  secret_hash              TEXT NOT NULL,        -- sha256(secret) hex
  pin_hash                 TEXT NOT NULL,        -- scrypt, format: scrypt$<saltHex>$<hashHex>
  pin_attempts             INTEGER NOT NULL DEFAULT 0,
  claim_token_hash         TEXT,
  claim_token_expires_at   TEXT,
  claim_method             TEXT CHECK (claim_method IN ('zcash_address','cashout_demo')),
  claim_txid               TEXT,
  created_at               TEXT NOT NULL,
  expires_at               TEXT NOT NULL,
  claimed_at               TEXT
);

CREATE INDEX IF NOT EXISTS payouts_status_idx ON payouts (status);

CREATE TABLE IF NOT EXISTS reports (
  id            TEXT PRIMARY KEY,
  period_start  TEXT NOT NULL,
  period_end    TEXT NOT NULL,
  stats_json    TEXT NOT NULL,                  -- exact aggregates used to write it
  body          TEXT NOT NULL,
  generator     TEXT NOT NULL CHECK (generator IN ('claude','template')),
  published     INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  published_at  TEXT
);

CREATE TABLE IF NOT EXISTS audit_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  type        TEXT NOT NULL,                    -- e.g. payout.created, payout.claimed, sync.ok, sync.error
  payload     TEXT NOT NULL,                    -- JSON, NEVER secrets/PINs/addresses of recipients
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mock_ledger (        -- used only by MockAdapter
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  txid        TEXT NOT NULL UNIQUE,
  direction   TEXT NOT NULL CHECK (direction IN ('in','out')),
  amount_zat  INTEGER NOT NULL,
  fee_zat     INTEGER NOT NULL DEFAULT 0,
  to_address  TEXT,
  memo        TEXT,
  created_at  TEXT NOT NULL
);
