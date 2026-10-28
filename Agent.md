# Agent.md — Asiri

> **Asiri** (the name is from the Yoruba word for "secret")
> *Private money you can send like a message — anywhere.*
>
> Built for **ZECATHON** (Zcash privacy hackathon by zkSNARKs). Submission deadline: **28 October 2026**.
> This file is the single source of truth for building the product. Read it fully before writing any code.

---

## 0. Rules for the coding agent (read first)

1. **Follow the milestones in order (Section 14).** Do not start a milestone until the previous one passes its acceptance checks.
2. **After every milestone, run** `npm run typecheck && npm test && npm run build` from the repo root. Fix every error before moving on. Never leave a red build behind.
3. **The mock path must always work.** `ZCASH_MODE=mock` must give a fully working demo with no blockchain, no network and no API keys. Real Zcash is added behind the same interface (Section 9).
4. **Never invent CLI flags, RPC names or output formats.** For `zingo-cli`, run its help commands first, record what you find in `docs/ZINGO_NOTES.md`, capture real outputs as test fixtures, and only then write parsers (Section 9.4).
5. **Never log, print or store secrets**: claim-link secrets, PINs, claim tokens, seed phrases, session secrets, API keys. Store only hashes where the spec says so.
6. **Never store recipient identity.** No names, phone numbers, bank details or Zcash addresses of recipients go into the database or logs (Section 13).
7. **Recipient-facing pages use plain language.** On the default claim path, never show the words *wallet, seed, blockchain, ZEC, shielded, address, crypto* (Section 11.3).
8. Use **TypeScript strict mode** everywhere. No `any` unless commented with a reason.
9. Money is always stored as **integer zatoshis** (1 ZEC = 100,000,000 zat) in a JS `number`. This is safe because max supply (2.1e15 zat) is below `Number.MAX_SAFE_INTEGER`. Never use floats for stored amounts.
10. When something in this spec is impossible or ambiguous, choose the simplest option that keeps the mock path working, write the decision in `docs/DECISIONS.md`, and continue.
11. Commit at the end of each milestone with message `M<n>: <summary>`.

---

## 1. Product summary

Asiri lets a community fund **receive donations and pay people privately on Zcash, without anyone needing a wallet.** It is for funds where a visible list of names or balances puts people at risk: disaster relief, refugee and humanitarian aid, medical and legal defence funds, mutual aid networks, and freelancers and creators who become targets when their balances are public. No single country is the centre of the product.

**Currencies:** ZEC is the settlement currency and every stored amount is integer zatoshis. Fiat is only for choosing and showing amounts. Supported: **NGN, USD, GBP, CAD** (Section 6.1).

- **Donors** send ZEC to the fund's shielded address (QR / payment link). A simulated card/bank option exists for the demo.
- **Organizers** log in, create a payout in NGN, USD, GBP or CAD (default: the fund currency), and get a **claim link + separate PIN** to send over WhatsApp or SMS.
- **Recipients** open the link, enter the PIN, and choose **Cash out (demo)**, **Send to a Zcash wallet**, or **Keep for later**. No app, no seed phrase, no jargon.
- **The public** sees a **transparency page**: totals raised, totals paid, payouts by category, an AI-written plain-language update, and the fund's **viewing key** so anyone can verify the numbers themselves. No recipient is ever identified.

**Core idea for judges:** *accountability without a hit list.* Shielded Zcash keeps donors and recipients private; viewing keys keep the fund honest.

---

## 2. Users and flows

### 2.1 Organizer
1. Logs in (`/login`) with the admin email + password from env.
2. Sees the dashboard: spendable balance, reserved for open links, available, donations, payouts.
3. Clicks **New payout** → picks a currency (default `FUND_CURRENCY`), enters an amount (up to 2 decimals, within that currency's limits), category, optional internal note, expiry (days).
4. Gets the **claim link** and **6-digit PIN**, shown **once**.
5. Taps **Send via WhatsApp** (prefilled message with the link, no PIN) and sends the PIN by a separate channel (call or SMS).
6. Can cancel an unclaimed payout, unlock a locked one, generate and publish a donor report.

### 2.2 Recipient
1. Opens `https://<host>/c/<payoutId>#<secret>` on their phone.
2. Sees "You've received support from {fund name}" → enters PIN.
3. Sees the amount in the payout's own currency, big (ZEC small, in the advanced section). The recipient never chooses a currency.
4. Chooses:
   - **Cash out to bank (demo)** → enters bank name + account number (not stored) → success screen marked "Demo: no real bank transfer happens."
   - **Send to a Zcash wallet** (collapsed "Advanced" option) → pastes a Zcash address → real on-chain send → success screen with transaction ID.
   - **Keep for later** → told the link works until the expiry date.

### 2.3 Donor
1. Opens `/donate`.
2. **Zcash tab:** QR code of a ZIP-321 payment URI to the fund's unified address, copy button, "Open in wallet" link.
3. **Card / bank tab (demo):** enters an amount → recorded as a **simulated** donation, clearly labeled, shown separately on the transparency page.

### 2.4 Public / auditor
1. Opens `/transparency`.
2. Sees totals, category breakdown, weekly chart, latest published report, and the fund's **Unified Full Viewing Key (UFVK)** with instructions to verify in any wallet that supports viewing-key import.

---

## 3. Architecture

```
                 Phone / browser
                       │
        ┌──────────────┴──────────────┐
        │   apps/web  (Vite + React)  │   built to apps/web/dist
        └──────────────┬──────────────┘
                       │  same origin: /api/*
        ┌──────────────┴──────────────┐
        │  apps/api  (Express 5, TS)  │── serves apps/web/dist in production
        │  - routes / zod validation  │
        │  - SQLite (better-sqlite3)  │
        │  - jobs: sync, expire       │
        │  - ZcashAdapter interface   │
        │      ├─ MockAdapter         │  (default, no chain)
        │      └─ ZingoAdapter        │── spawns zingo-cli ──► lightwalletd ──► Zcash testnet/mainnet
        │  - Claude report generator  │── Anthropic API (optional)
        │  - price service            │── CoinGecko (optional, cached) / fixed rate
        └─────────────────────────────┘
```

**Single origin in production:** the API serves the built frontend. This avoids CORS and cross-site cookie problems. In development, Vite proxies `/api` to the API.

**Custody model (MVP, "Mode A"):** one shielded **treasury wallet** held by the server. A payout reserves funds from the treasury balance; the on-chain send happens at claim time. A **stretch** "Mode B" (Section 10.5) funds a one-time wallet per link instead.

---

## 4. Tech stack

Use the latest stable versions at build time unless stated otherwise.

| Layer | Choice |
|---|---|
| Runtime | Node.js 22 LTS or newer |
| Package manager | npm workspaces |
| Frontend | Vite, React 18+, TypeScript, React Router, Tailwind CSS **v4** (`@tailwindcss/vite` plugin), `qrcode.react`, `recharts` |
| Backend | Express **5**, TypeScript, `zod`, `better-sqlite3`, `cookie-session`, `helmet`, `express-rate-limit`, `pino` (with redaction), `dotenv`, `@anthropic-ai/sdk` |
| Dev tooling | `tsx` (run TS), `vitest`, `supertest`, `concurrently`, ESLint (optional) |
| Zcash | `zingo-cli` (from zingolabs/zingolib) talking to a lightwalletd server |
| Crypto primitives | Node built-in `node:crypto` only (`randomBytes`, `createHash`, `scrypt`, `timingSafeEqual`). No native bcrypt/argon2. |

Tailwind v4 setup (do exactly this): install `tailwindcss @tailwindcss/vite`, add `tailwindcss()` to `vite.config.ts` plugins, and put `@import "tailwindcss";` as the first line of `src/index.css`. There is **no** `tailwind.config.js` and no PostCSS config needed.

---

## 5. Repository layout

```
asiri/
├─ package.json            # workspaces: ["apps/*"], root scripts
├─ .env.example
├─ Agent.md
├─ README.md
├─ docs/
│  ├─ DECISIONS.md
│  ├─ ZINGO_NOTES.md       # created in M3 from real CLI output
│  └─ DEMO_SCRIPT.md
├─ docker/
│  └─ Dockerfile           # multi-stage: builds zingo-cli + app
├─ apps/
│  ├─ api/
│  │  ├─ package.json
│  │  ├─ tsconfig.json
│  │  ├─ vitest.config.ts
│  │  └─ src/
│  │     ├─ index.ts              # boot: env, db, adapter, jobs, server
│  │     ├─ app.ts                # express app factory (used by tests)
│  │     ├─ env.ts                # zod-validated env
│  │     ├─ db/
│  │     │  ├─ db.ts              # open + migrate
│  │     │  └─ migrations.sql
│  │     ├─ lib/
│  │     │  ├─ crypto.ts          # secrets, hashing, PIN
│  │     │  ├─ money.ts           # zat/ZEC helpers
│  │     │  ├─ currency.ts        # supported fiat currencies, formatting, fiat <-> zat (single source of truth)
│  │     │  ├─ bankDetails.ts     # demo cash-out formats per currency
│  │     │  ├─ mutex.ts           # serialize wallet calls
│  │     │  └─ logger.ts          # pino with redaction
│  │     ├─ zcash/
│  │     │  ├─ adapter.ts         # interface + types
│  │     │  ├─ mock.ts
│  │     │  ├─ zingo.ts
│  │     │  ├─ zingoParse.ts      # pure parsers, unit-tested with fixtures
│  │     │  └─ zip321.ts          # payment URI builder
│  │     ├─ services/
│  │     │  ├─ payouts.ts         # create, claim state machine, cancel, unlock
│  │     │  ├─ donations.ts       # import from wallet, simulated donations
│  │     │  ├─ transparency.ts    # aggregates
│  │     │  ├─ price.ts
│  │     │  └─ reports.ts         # Claude + template fallback
│  │     ├─ jobs.ts               # sync + expire loop
│  │     ├─ routes/
│  │     │  ├─ public.ts
│  │     │  ├─ claims.ts
│  │     │  ├─ admin.ts
│  │     │  ├─ auth.ts
│  │     │  └─ dev.ts
│  │     └─ test/
│  │        ├─ fixtures/zingo/    # real captured outputs (M3)
│  │        └─ *.test.ts
│  └─ web/
│     ├─ package.json
│     ├─ tsconfig.json
│     ├─ vite.config.ts           # proxy /api -> http://localhost:8787
│     ├─ index.html
│     └─ src/
│        ├─ main.tsx
│        ├─ index.css
│        ├─ api.ts                # typed fetch helpers (credentials: "include")
│        ├─ types.ts              # mirrors API response shapes
│        ├─ copy.ts               # all user-facing strings in one place
│        ├─ currency.ts           # mirrors api lib/currency.ts + bankDetails formats (kept in sync by hand)
│        ├─ components/           # Button, Card, Amount, PinInput, QR, Layout, DemoBadge
│        └─ pages/
│           ├─ Home.tsx
│           ├─ Donate.tsx
│           ├─ Transparency.tsx
│           ├─ Claim.tsx
│           ├─ Login.tsx
│           ├─ Admin.tsx
│           ├─ NewPayout.tsx
│           └─ Reports.tsx
```

Do **not** create a shared package between web and api. Keep `apps/web/src/types.ts` manually in sync with the API response shapes in Section 8.

### Root `package.json` scripts

```json
{
  "scripts": {
    "dev": "concurrently -n api,web \"npm run dev -w apps/api\" \"npm run dev -w apps/web\"",
    "build": "npm run build -w apps/web && npm run build -w apps/api",
    "start": "npm run start -w apps/api",
    "typecheck": "npm run typecheck -w apps/api && npm run typecheck -w apps/web",
    "test": "npm run test -w apps/api",
    "seed:demo": "npm run seed:demo -w apps/api"
  }
}
```

Each app defines `dev`, `build`, `typecheck` (`tsc --noEmit`), and the api defines `start` (`node dist/index.js`), `test` (`vitest run`), `seed:demo`.

---

## 6. Environment variables (`.env.example`)

All read and validated in `apps/api/src/env.ts` with zod. Boot fails with a clear message if a required variable is missing.

```dotenv
# App
APP_NAME=Asiri
FUND_NAME=Community Relief Fund
FUND_CURRENCY=USD                          # main display currency: NGN | USD | GBP | CAD
FUND_DESCRIPTION=Private, fast support for medical, legal and emergency needs.
PORT=8787
PUBLIC_WEB_URL=http://localhost:5173      # used to build claim links
NODE_ENV=development
DEMO_MODE=true                             # enables simulated cash-out + simulated card donations

# Auth (single organizer for the MVP)
ADMIN_EMAIL=organizer@example.com
ADMIN_PASSWORD=change-me-now
SESSION_SECRET=replace-with-64-random-hex-chars

# Storage
DATABASE_PATH=./data/asiri.db

# Zcash
ZCASH_MODE=mock                            # mock | zingo
ZCASH_NETWORK=testnet                      # testnet | mainnet
LIGHTWALLETD_URL=                          # required when ZCASH_MODE=zingo; verify a working testnet server in M3
ZINGO_CLI_PATH=zingo-cli
TREASURY_DATA_DIR=./data/treasury
FEE_BUFFER_ZAT=20000                       # reserved per payout to cover the ZIP-317 fee
OFFRAMP_ZCASH_ADDRESS=                     # optional: if set, demo cash-outs send real funds here
SYNC_INTERVAL_SECONDS=60

# Claims
CLAIM_LINK_TTL_DAYS=14
PIN_MAX_ATTEMPTS=5
CLAIM_TOKEN_TTL_MINUTES=15

# Pricing
PRICE_SOURCE=coingecko                     # coingecko | fixed
FIXED_ZEC_NGN=1000000                      # PLACEHOLDERS, not market prices: the price of 1 ZEC in each currency, used
FIXED_ZEC_USD=1000                         #   when PRICE_SOURCE=fixed or when the live price for that currency is unavailable.
FIXED_ZEC_GBP=1000                         #   Set all four to the day's rates before a demo.
FIXED_ZEC_CAD=1000

# AI reports (optional; template fallback if empty)
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-sonnet-5-5
```

---

### 6.1 Currencies

Defined once in `apps/api/src/lib/currency.ts` and mirrored in `apps/web/src/currency.ts`:

| Code | Symbol | Locale | Minor units | Payout limits | Simulated donation limits |
|---|---|---|---|---|---|
| NGN | ₦ | en-NG | 2 | 500 – 5,000,000 | 100 – 10,000,000 |
| USD | $ | en-US | 2 | 1 – 5,000 | 1 – 10,000 |
| GBP | £ | en-GB | 2 | 1 – 5,000 | 1 – 10,000 |
| CAD | CA$ | en-CA | 2 | 1 – 5,000 | 1 – 10,000 |

- Formatting uses `Intl.NumberFormat` with the currency's locale and code. The symbol shown is the one above: Intl gives "$" for CAD in en-CA, so the formatter swaps in "CA$". NGN drops ".00" on whole amounts ("₦50,000"); the others keep it ("$50.00"). No currency symbol is hard-coded outside these definitions.
- Amounts are entered with up to 2 decimals and handled as integer minor units. Fiat → zat: `round(minor / 100 / rate * 1e8)`.
- To add a currency: an entry in both currency files, a `FIXED_ZEC_<CODE>` env var, and its bank-detail format.

## 7. Data model (SQLite)

`apps/api/src/db/migrations.sql`, run on boot (idempotent: `CREATE TABLE IF NOT EXISTS`). Enable `PRAGMA journal_mode=WAL;` and `PRAGMA foreign_keys=ON;`.

```sql
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
  amount_ngn_at_creation   INTEGER NOT NULL,     -- legacy: naira equivalent at creation, still written, never read
  rate_zec_ngn             REAL NOT NULL,        -- legacy: still written, never read
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
```

**Multi-currency payouts (migration, idempotent, run on every boot by `applyMigrations` in db.ts):** `ALTER TABLE payouts ADD COLUMN` (never a table rebuild) for each column that is missing:

```sql
currency           TEXT CHECK (currency IN ('NGN','USD','GBP','CAD')),
amount_fiat_minor  INTEGER,   -- the amount the organizer chose, in the payout currency's minor units
rate_zec_fiat      REAL       -- ZEC price in that currency at creation
```

Then `UPDATE payouts SET currency='NGN', amount_fiat_minor=amount_ngn_at_creation*100, rate_zec_fiat=rate_zec_ngn WHERE currency IS NULL`. New code reads only the new columns.

### Derived balances (used everywhere)

```
reservedZat  = SUM(amount_zat + fee_buffer_zat) FROM payouts WHERE status IN ('active','claiming','locked')
availableZat = max(0, wallet.spendableZat - reservedZat)
```

A payout can only be created if `availableZat >= amount_zat + fee_buffer_zat`.

---

## 8. HTTP API

All routes are under `/api`. JSON in and out. Validate every body with zod; on failure return `400 { error: "validation_error", details }`. Error shape is always `{ error: string, message?: string }`. Amounts in responses are integers in zat plus pre-formatted display strings.

### 8.1 Public

| Method | Path | Response |
|---|---|---|
| GET | `/api/health` | `{ ok: true, mode: "mock"\|"zingo", network }` |
| GET | `/api/fund` | `{ name, description, network, receiveAddress, ufvk, paymentUri, fundCurrency }` |
| GET | `/api/price` | `{ rates: { NGN, USD, GBP, CAD }, sources: { NGN: "coingecko"\|"fixed", … }, fundCurrency, updatedAt }`. One CoinGecko request (`vs_currencies=ngn,usd,gbp,cad`), cached 5 min; each currency falls back to its fixed rate on its own. |
| GET | `/api/transparency` | see below |
| POST | `/api/donations/simulate` | DEMO_MODE only. Body `{ amount: number (≤ 2 decimals), currency?: code (default FUND_CURRENCY) }`, within the currency's donation limits → `{ donationId, amountZat }`; 404 when DEMO_MODE=false |

`/api/transparency` response:

```ts
{
  fundName: string;
  network: "testnet" | "mainnet";
  fundCurrency: "NGN" | "USD" | "GBP" | "CAD"; // the page converts with /api/price; totals stay in zat
  totals: {
    receivedZat: number;        // zcash donations only
    simulatedZat: number;       // demo donations, shown separately
    paidOutZat: number;         // claimed payouts
    outstandingZat: number;     // reserved for open links
    payoutsCount: number;       // claimed
  };
  byCategory: { category: string; count: number; amountZat: number }[]; // claimed only
  weekly: { weekStart: string; receivedZat: number; paidOutZat: number }[]; // last 8 weeks
  latestReport: { body: string; periodStart: string; periodEnd: string; publishedAt: string } | null;
  ufvk: string;
  verifyHint: string;           // plain-language instructions
  updatedAt: string;
}
```

### 8.2 Claims (rate-limited: 10 requests/min/IP on every route here; never log bodies)

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/api/claims/:id/open` | `{ secret }` | `{ status: "available"\|"claimed"\|"expired"\|"cancelled"\|"locked", fundName }`. If the secret hash does not match or id is unknown → `404 { error: "not_found" }`. Never reveals amount. |
| POST | `/api/claims/:id/unlock` | `{ secret, pin }` | Success: `{ amountZat, amountZecDisplay, currency, amountDisplay, expiresAt, claimToken }` (`amountDisplay` in the payout's own currency). Wrong PIN: `401 { error: "wrong_pin", attemptsLeft }`. When attempts reach `PIN_MAX_ATTEMPTS` → status `locked`, `423 { error: "locked" }`. |
| POST | `/api/claims/:id/redeem` | `{ claimToken, method: "zcash_address", zcashAddress }` or `{ claimToken, method: "cashout_demo", bankName, accountNumber, routingNumber?, sortCode?, institutionNumber?, transitNumber? }` | `{ status: "claimed", method, txid?: string, demo: boolean }` |

Rules:
- `secret` is compared by `sha256(secret)` with `timingSafeEqual`.
- `pin` is 6 digits; verified with scrypt + `timingSafeEqual`.
- `claimToken` is 32 random bytes (base64url), stored as sha256, valid `CLAIM_TOKEN_TTL_MINUTES`.
- `cashout_demo` is only allowed when `DEMO_MODE=true`. The details are validated against the **payout currency's** format, after the claim token is verified, and then **discarded**: never stored or logged. Bank name is free text for every currency. NGN: 10-digit account number. USD: 9-digit routing number + 4–17-digit account number. GBP: 6-digit sort code + 8-digit account number. CAD: 3-digit institution + 5-digit transit + 7–12-digit account number. Spaces and dashes are ignored. If `OFFRAMP_ZCASH_ADDRESS` is set, funds are really sent there (shows the realistic flow); otherwise no on-chain send happens and `demo: true`.
- `zcash_address` validates the address with the adapter for the configured network, then sends `amount_zat` with memo `"Asiri payout"`.

### 8.3 Auth

| Method | Path | Notes |
|---|---|---|
| POST | `/api/auth/login` | `{ email, password }`. Compare to env with `timingSafeEqual` on sha256 digests. Sets `cookie-session` (httpOnly, sameSite=lax, secure in production, maxAge 12h). 5 attempts/min/IP. |
| POST | `/api/auth/logout` | clears session |
| GET | `/api/auth/me` | `{ email }` or 401 |

### 8.4 Admin (all require session; 401 otherwise)

| Method | Path | Body / Response |
|---|---|---|
| GET | `/api/admin/overview` | `{ spendableZat, pendingZat, reservedZat, availableZat, lastSyncAt, lastSyncError, counts: { active, claimed, expired, cancelled, locked }, fundCurrency, rates }` |
| POST | `/api/admin/sync` | triggers sync now → overview |
| GET | `/api/admin/donations` | list, newest first (includes memo; admin only) |
| GET | `/api/admin/payouts` | list, newest first, **never** includes secret/pin/hashes |
| POST | `/api/admin/payouts` | `{ amount: number (≤ 2 decimals, within the currency's payout limits), currency?: code (default FUND_CURRENCY), category, internalNote?: string ≤ 200, expiresInDays?: 1..30 }` → `{ payout, link, pin, whatsappUrl, smsUrl }`. `link`, `pin` are returned **only in this response**. 409 `{ error: "insufficient_funds", availableZat }` if not enough. |
| POST | `/api/admin/payouts/:id/cancel` | only from `active` or `locked` |
| POST | `/api/admin/payouts/:id/unlock` | `locked` → `active`, resets attempts |
| POST | `/api/admin/reports/generate` | `{ periodDays: 1..90 }` → draft report |
| POST | `/api/admin/reports/:id/publish` | publishes; previous published reports stay published (latest shown) |
| GET | `/api/admin/reports` | list |

### 8.5 Dev (only when `ZCASH_MODE=mock`; otherwise 404)

| Method | Path | Body |
|---|---|---|
| POST | `/api/dev/mock-donate` | `{ amountZat }` → inserts an incoming mock ledger tx; next sync imports it as a `zcash` donation |

---

## 9. Zcash integration

### 9.1 Adapter interface (`apps/api/src/zcash/adapter.ts`)

```ts
export type Network = "testnet" | "mainnet";

export interface WalletBalance {
  spendableZat: number;   // confirmed & spendable now
  pendingZat: number;     // received but not yet spendable
  totalZat: number;
}

export interface WalletTx {
  txid: string;
  direction: "in" | "out";
  amountZat: number;      // positive; for "out" this is value sent to others (excluding change)
  feeZat?: number;
  memo?: string;
  blockHeight?: number;
  timestamp?: string;     // ISO
}

export interface ZcashAdapter {
  readonly network: Network;
  init(): Promise<void>;                          // open or create the treasury wallet
  sync(): Promise<void>;
  getReceiveAddress(): Promise<string>;           // unified address (orchard receiver at minimum)
  getUfvk(): Promise<string>;
  getBalance(): Promise<WalletBalance>;
  listTransactions(): Promise<WalletTx[]>;
  validateAddress(address: string): Promise<boolean>;
  send(toAddress: string, amountZat: number, memo?: string): Promise<{ txid: string }>;
}
```

All adapter calls go through a **single async mutex** (`lib/mutex.ts`): one wallet operation at a time. Every call has a timeout (sync: 10 min, others: 2 min) and throws a typed `ZcashError` with a safe message.

### 9.2 MockAdapter (`zcash/mock.ts`)

- Backed by the `mock_ledger` table. Starts empty.
- `getReceiveAddress()` returns a fixed fake unified address starting with `utest1mock…` (testnet) or `u1mock…` (mainnet).
- `getUfvk()` returns a fixed fake string starting with `uviewtest1mock…`.
- `getBalance()`: spendable = sum(in) − sum(out + fee). pending = 0.
- `send()`: fails with `insufficient_funds` if spendable < amount + 10,000; otherwise inserts an `out` row with fee 10,000 and a random 64-hex txid.
- `validateAddress()`: accepts strings starting with `utest1`, `ztestsapling1`, `tm` on testnet; `u1`, `zs1`, `t1` on mainnet; length ≥ 30.
- `sync()`: no-op that resolves after 300 ms.

### 9.3 ZIP-321 payment URI (`zcash/zip321.ts`)

Build `zcash:<address>?amount=<decimal ZEC>&memo=<base64url of UTF-8 memo>&message=<url-encoded>`. Amount and memo are optional. Memo must be ≤ 512 bytes before encoding. Base64url without padding. Unit-test it.

### 9.4 ZingoAdapter (`zcash/zingo.ts`) — **discovery first**

`zingo-cli` (from `zingolabs/zingolib`) is a lightwalletd client. Known facts from its README:
- `--data-dir <dir>` chooses where the wallet lives.
- `--server <url>` chooses the lightwalletd server.
- `--seed "<24 words>" --birthday <height>` restores a wallet.
- `--waitsync` waits for sync before running a command.
- Running `zingo-cli [flags] <command> [args]` executes one command and exits; `help` lists commands; examples include `addresses` and `balance`.

**Everything else must be discovered, not assumed.** Do this in M3 before writing `zingo.ts`:

1. Install zingo-cli (build from source: `cargo build --release --package zingo-cli` in zingolib at its **latest release tag**; or use a prebuilt release binary if one exists for the platform).
2. Run and save the output of:
   - `zingo-cli --help`
   - `zingo-cli --data-dir ./data/treasury --server $LIGHTWALLETD_URL <chain flag if any> help`
   - `help <command>` for each command you will use: addresses, balance, sync (or equivalent), transactions/list (or equivalent), send (and any confirm/quicksend variant), the command that exports the UFVK/viewing key, and anything that parses/validates addresses.
3. Determine how to select **testnet** (a `--chain` flag or similar). Confirm by checking that addresses start with `utest1`.
4. Find a working **testnet lightwalletd** server (check zingolib docs, Zcash community forum, ZecHub wiki). Record it in `ZINGO_NOTES.md` and `.env.example`.
5. Get testnet ZEC from a testnet faucet into the treasury address. If no faucet works, ask in the Zcash Global Discord and record what happened.
6. Capture **real outputs** (JSON or text) of balance, addresses, transaction list, send, and UFVK export into `apps/api/src/test/fixtures/zingo/*.txt`. Replace any real secrets in fixtures with `REDACTED`.
7. Write `zingoParse.ts` as **pure functions** that turn those outputs into the adapter types. Unit-test against the fixtures.
8. Write `zingo.ts` using `child_process.execFile` (never `exec`, never a shell string) with args as an array, through the mutex, with timeouts. Never pass the seed on the command line except during a one-time restore, and never log args.

Implementation notes:
- Sending may be a one-step command or a propose-then-confirm pair in the installed version. Support whichever exists; document it.
- Fees follow ZIP-317. Reserve `FEE_BUFFER_ZAT` per payout. If a send fails for fees, surface `insufficient_funds_for_fee`.
- If the wallet reports funds as not yet spendable (pending confirmations), `send` must fail cleanly with `funds_pending`; the claim page then shows "Your support is on its way, please try again in a few minutes" and the payout returns to `active`.
- Treasury seed: on first `init()` with an empty data dir, create the wallet, then print **one** line to the console: `Treasury wallet created. Back up the seed with: zingo-cli ... <seed command>`. Do not print the seed itself.

---

## 10. Claim links

### 10.1 Format

```
{PUBLIC_WEB_URL}/c/{payoutId}#{secret}
```
- `payoutId`: 10 chars from `[A-Za-z0-9]`, generated with `randomBytes`.
- `secret`: 32 bytes from `randomBytes`, base64url, no padding.
- The secret sits in the **URL fragment**, which browsers do not send in HTTP requests. Link previews (WhatsApp), server access logs and analytics therefore never see it. The claim page reads it from `window.location.hash` and sends it in a POST body only when the recipient acts.

### 10.2 PIN

- 6 digits from `randomInt(0, 1_000_000)`, zero-padded.
- Stored as `scrypt$<saltHex>$<hashHex>` (salt 16 bytes, keylen 32, N=16384).
- Shown to the organizer once, with the instruction "Send this PIN separately, by call or SMS. Never in the same message as the link."

### 10.3 State machine

```
active ──unlock ok──► (claim token issued, still active)
active ──redeem──► claiming ──send ok──► claimed
                         └──send fails──► active   (error returned to user)
active ──wrong PIN x PIN_MAX_ATTEMPTS──► locked ──admin unlock──► active
active|locked ──admin cancel──► cancelled
active|locked ──now > expires_at (job)──► expired
```

- The `active → claiming` transition must be a single atomic SQL statement: `UPDATE payouts SET status='claiming' WHERE id=? AND status='active' AND claim_token_hash=? AND claim_token_expires_at > ?`. If 0 rows changed → `409 { error: "already_processing" }`. This prevents double claims.
- Expired and cancelled payouts release their reservation automatically (they leave the reserved statuses).

### 10.4 Share messages

```
WhatsApp: https://wa.me/?text=<urlencoded message>
SMS:      sms:?body=<urlencoded message>
Message:  "Hi, you have received {amount, formatted in the payout's currency} in support from {FUND_NAME}. Open this private link to receive it: {link} . You will get a 6-digit PIN separately. Please do not share this link."
```
The PIN is **never** included.

### 10.5 Stretch: Mode B — one-time wallet per link (only after M5 is done)

Behind `CLAIM_MODE=ephemeral` (default `escrow`):
1. On payout creation, create a fresh zingo wallet in a temp data dir, read its address and seed, and have the treasury send `amount + fee buffer` to it.
2. Encrypt `seed|birthday` in the browser-only fragment: `AES-256-GCM` with a key from `PBKDF2(PIN, salt, 200000, SHA-256)`; fragment = base64url(salt|iv|ciphertext).
3. Delete the temp data dir. The server stores **no** seed.
4. Claim page decrypts with the PIN client-side (WebCrypto), then posts the seed to `/api/claims/:id/sweep`, which restores the wallet in a temp dir, sweeps to the chosen destination and deletes the dir.
Document clearly that the server briefly sees the seed during the sweep.

---

## 11. Frontend

### 11.1 Global

- Mobile-first, works well at 360 px wide. Max content width 640 px on public pages, 1040 px on admin.
- Fast on low-end Android: no heavy fonts (use system font stack), no images larger than 100 KB, code-split admin routes with `React.lazy`.
- Colors: deep ink background on hero (`#0B0F14`), warm accent (`#F4B728`, Zcash-adjacent gold), success green `#16A34A`, error `#DC2626`. Light theme for the claim page (readability outdoors).
- Every page shows the network: a small "TESTNET" pill when `network === "testnet"`.
- Anything simulated shows a `DemoBadge` reading "Demo".
- `index.html` includes `<meta name="referrer" content="no-referrer">`.
- All fetches use `credentials: "include"` and the relative base `/api`.

### 11.2 Pages

**Home `/`**
- Hero: "Private money you can send like a message." Sub: "Asiri helps community funds pay people quickly and privately. Recipients need only a phone."
- Three steps: *Donate privately* → *Organizers send a link* → *Anyone can verify the totals*.
- Buttons: "Donate" → `/donate`, "See where the money goes" → `/transparency`.
- Short "Why privacy" section: in a crisis, a public list of who received money can become a list of who to target.

**Donate `/donate`**
- Tabs: "Zcash" | "Card or bank (demo)".
- Zcash tab: QR of `paymentUri`, address in a monospace box with Copy, "Open in wallet" (`href=paymentUri`), and one line: "Your donation is private. Only the total is published."
- Demo tab: currency selector (default the fund currency) with that currency's limits, amount, "Donate (demo)" → POST simulate → thank-you state with DemoBadge.

**Transparency `/transparency`**
- Big numbers: Raised (fiat and ZEC), Paid out, Waiting to be claimed, People helped (claimed count). Fiat is shown in `FUND_CURRENCY`, with a small NGN/USD/GBP/CAD switcher that converts on the client using `/api/price`, labelled "approx., at today's rate". The viewer's choice is kept in localStorage (wrapped in try/catch). The admin overview has the same switcher.
- Simulated donations shown on a separate line with DemoBadge, never added to "Raised".
- Bar chart (recharts) of the last 8 weeks: received vs paid out.
- Category table.
- Latest report card.
- "Verify it yourself" section: UFVK in a copy box + `verifyHint`: "This is the fund's viewing key. Import it into a Zcash wallet that supports viewing keys to see every incoming and outgoing payment amount. It cannot spend money and it does not reveal who anyone is."

**Claim `/c/:id`** (most important screen; see 11.3)
States: `loading` → `pin` → `reveal` → (`cashout` | `wallet` | `keep`) → `done`; terminal error states `not_found`, `claimed`, `expired`, `cancelled`, `locked`, `pending_funds`, `network_error`.
- If the URL has no fragment → `not_found` state: "This link is incomplete. Ask the sender to send it again."
- PIN input: 6 large boxes, numeric keyboard (`inputMode="numeric"`, `autoComplete="one-time-code"`), paste support.
- Reveal: "{amount} is yours" in the payout's currency (big), "from {FUND_NAME}". Expiry date in plain words.
- Three option cards: "Cash out to my bank" (DemoBadge), "Keep it for later", and a collapsed "Advanced: send to a Zcash wallet".
- Bank form, by payout currency (Section 8.2): free-text bank name plus that currency's fields. Note under the form: "Demo: no real bank transfer happens in this version."
- Done: green check, "Done. Take care." For wallet sends, show the txid in a small monospace line with copy.
- After done, call `history.replaceState(null, "", "/c/" + id)` to drop the secret from the address bar.

**Login `/login`**, **Admin `/admin`**, **New payout `/admin/payouts/new`**, **Reports `/admin/reports`** — as described in Sections 2.1 and 8.4. Admin shows a "Sync now" button and last sync time/error. The new-payout result screen shows link + PIN in large text, copy buttons, WhatsApp and SMS buttons, and a red note: "This is the only time you will see this PIN and link." Internal note field shows a hint: "Do not write names or phone numbers here."

### 11.3 Recipient copy rules

All strings live in `src/copy.ts`. On the default claim path never use: *wallet, seed, blockchain, ZEC, shielded, address, crypto, token, transaction*. These words are allowed only inside the "Advanced: send to a Zcash wallet" section. Write in short, warm sentences. Reading level: a 12-year-old should understand every line.

Optional (stretch): a language toggle on the claim page, strings in `copy.ts`. Planned languages include French, Spanish, Arabic and Nigerian Pidgin, among others.

---

## 12. AI donor reports (`services/reports.ts`)

- Input: **aggregates only** for the period: totals received, simulated, paid out, outstanding, count of claimed payouts, by-category counts/amounts, all pre-formatted in the fund currency, plus that currency's name, symbol and ZEC rate. No ids, no notes, no memos, no addresses.
- If `ANTHROPIC_API_KEY` is set, call the Messages API with `ANTHROPIC_MODEL`, `max_tokens: 600`.
- System prompt:

```
You write short, warm, factual updates for donors of a community relief fund.
Rules:
- Use ONLY the numbers in the JSON you are given. Do not invent or estimate any figure.
- Never guess or describe who the recipients are.
- No crypto jargon. Say "donations" and "payments", not "transactions" or "ZEC".
- Show amounts in {currency name} using {symbol} and the formatting given.
- 120 to 180 words, plain text, no headings, no bullet points.
- End with one sentence inviting readers to verify the totals on the transparency page.
```

- User message: `Write the update for this period:\n` + the stats JSON.
- Validation: if the response is empty or contains a digit sequence that does not appear in the formatted stats, fall back to the template. Keep it simple: build a set of allowed formatted numbers and reject outputs containing other 3+ digit numbers.
- Template fallback (no key or failure): a deterministic paragraph built from the same stats, with `generator: "template"`.
- Store `stats_json` with every report so the public card can show the numbers beside the text.

---

## 13. Security and privacy rules

1. `helmet()` on all routes. Strict CSP in production: `default-src 'self'; img-src 'self' data:; connect-src 'self'; style-src 'self' 'unsafe-inline'`.
2. `pino` logger with `redact: ["req.body", "req.headers.cookie", "*.secret", "*.pin", "*.claimToken", "*.password", "*.zcashAddress", "*.accountNumber"]`. Claim routes do not log bodies at all.
3. Rate limits: claims 10/min/IP, login 5/min/IP, everything else 120/min/IP.
4. Data minimization: recipient identity is never collected. The organizer's internal note is admin-only and the UI warns against names.
5. Secrets compared with `timingSafeEqual` on equal-length buffers (hash both sides first).
6. `SESSION_SECRET` must be ≥ 32 chars; boot fails otherwise. In production, `ADMIN_PASSWORD` must not equal `change-me-now`; boot fails otherwise.
7. The UFVK is intentionally public (it is the transparency feature). The spending key/seed never leaves the treasury data dir.
8. `audit_events` payloads contain ids, statuses, amounts and categories only.
9. Express `trust proxy` set to `1` in production so rate limits see real client IPs.

---

## 14. Milestones and acceptance checks

### M0 — Scaffold (target: 1–2 h)
- Workspaces, both apps, TS strict, scripts from Section 5, `.env.example`, `README.md` with run steps, Vite proxy, Tailwind v4.
- ✅ `npm install && npm run typecheck && npm run build` passes. `npm run dev` shows the Home page calling `/api/health`.

### M1 — API core on MockAdapter (target: 6–8 h)
- env, db + migrations, crypto helpers, money helpers, mutex, logger, MockAdapter, zip321, price service (with fixed fallback), payouts service + state machine, donations import, transparency aggregates, jobs loop, all routes in Section 8.
- Tests (vitest + supertest) for at least:
  - secret/PIN hashing and verification; wrong PIN decrements `attemptsLeft`; lockout at max.
  - create payout fails with `insufficient_funds`; succeeds after `mock-donate` + sync.
  - full happy path: donate → sync → create payout → open → unlock → redeem (`zcash_address`) → status `claimed`, mock ledger has an `out` row.
  - double redeem with the same token → second gets 409.
  - expired payout via job → `open` returns `expired`, reservation released.
  - transparency excludes simulated donations from `receivedZat`.
  - admin routes return 401 without session.
  - zip321 builder output.
- ✅ `npm test` green; `curl` walkthrough in README works.

### M2 — Web app on mock (target: 6–8 h)
- All pages in Section 11 wired to the API.
- ✅ Manual check on a 360 px viewport: complete the recipient flow from a link created in admin, using the mock. No forbidden words on the default claim path (add a vitest/grep check script `scripts/check-copy.mjs` that scans `copy.ts` claim strings).
- ✅ `npm run build` passes; production mode (`npm run build && npm start`) serves the web app from the API on one port.

### M3 — Real Zcash on testnet (target: 6–10 h)
- Discovery per Section 9.4, `docs/ZINGO_NOTES.md`, fixtures, `zingoParse.ts` + tests, `zingo.ts`.
- ✅ With `ZCASH_MODE=zingo` on testnet: treasury address shown on `/donate`, a faucet/test donation appears after sync, a payout is claimed to a second testnet wallet and the txid is visible in a testnet explorer.
- ✅ Mock tests still pass.

### M4 — AI reports (target: 2 h)
- Section 12 with fallback and validation. Test the fallback path without a key; test the number-validation function.
- ✅ Admin can generate and publish; the transparency page shows it.

### M5 — Demo readiness (target: 3–4 h)
- `npm run seed:demo` (mock mode only): creates simulated + mock donations over the last 6 weeks, ~12 claimed payouts across categories, 2 active, 1 expired, and one published report, so the transparency page looks alive.
- `docs/DEMO_SCRIPT.md` (Section 16).
- `docker/Dockerfile` (Section 17).
- README: what it is, why Zcash, how to run (mock and testnet), architecture, limitations (Section 18), roadmap.
- ✅ Fresh clone → follow README → working demo in under 10 minutes in mock mode.

### M6 — Stretch (only if time remains)
In order: language toggle (planned languages include French, Spanish, Arabic and Nigerian Pidgin) → Mode B ephemeral links → cross-chain donation option (e.g., swap into shielded ZEC via an intents/swap provider) → multi-organizer approval (document FROST threshold signing as the target design).

---

## 15. Testing conventions

- `apps/api/src/app.ts` exports `createApp({ db, adapter, env })` so tests inject an in-memory SQLite (`:memory:`) and a fresh MockAdapter.
- Use a fake clock helper for expiry tests (pass `now()` into services instead of calling `Date.now()` directly).
- Never hit the network in tests. Price service gets an injected fetcher.

---

## 16. Demo script (3 minutes, put in `docs/DEMO_SCRIPT.md`)

1. **Story (20 s):** "When a relief fund, a refugee-aid group or a legal defence fund needs money most, its bank or payment accounts can be frozen. A public blockchain avoids the freeze, but makes every donor and recipient traceable. Asiri fixes both, in whatever currency people use." (Describe the risk in general terms; cite a real event only if it is short, factual and checked, with examples from more than one region.)
2. **Donate (25 s):** show `/donate`, scan with a testnet wallet, or use the pre-funded treasury.
3. **Pay someone (40 s):** admin → New payout £40 (GBP), Medical → show link + PIN → tap WhatsApp → message arrives on a phone.
4. **Claim (40 s):** on the phone: open link → PIN → "£40.00 is yours" → Cash out (demo) or send to a testnet wallet → Done. Point out: no app, no seed phrase, no jargon.
5. **Accountability (35 s):** `/transparency` updates; show the UFVK "verify it yourself"; read the AI update. "Donors see that money moved. Nobody sees who received it."
6. **Close (20 s):** "Accountability without a hit list. Built on Zcash because only shielded money with viewing keys can do both."

---

## 17. Deployment

- **One container** runs the API, serves `apps/web/dist`, and includes `zingo-cli`.
- `docker/Dockerfile` (multi-stage):
  1. `rust` stage: clone `zingolabs/zingolib` at a pinned release tag, `cargo build --release --package zingo-cli`.
  2. `node` build stage: `npm ci`, `npm run build`.
  3. runtime: `node:22-slim` (or newer LTS), copy the zingo-cli binary to `/usr/local/bin/`, copy built apps and production deps, `ENV NODE_ENV=production`, `CMD ["npm","start"]`.
- Mount a persistent volume at `/app/data` (SQLite + treasury wallet). **Without a volume, the treasury wallet is lost on redeploy.**
- Set `PUBLIC_WEB_URL` to the public HTTPS URL.
- Any host that runs Docker with a persistent volume works (Fly.io, Railway, Render, a small VPS). If building zingo-cli in CI is too slow, build the image locally and push it.

---

## 18. Known limitations (state these honestly in README and pitch)

1. **Custodial treasury (MVP):** the server holds the fund's spending key. Roadmap: FROST threshold signing so several organizers must approve every payout.
2. **Bearer links:** whoever has both the link and the PIN can claim. Mitigations: PIN by a separate channel, attempt limits, expiry, cancel.
3. **Cash-out is simulated in every currency.** Real bank or mobile-money off-ramps need licensed partners in each region. Optional `OFFRAMP_ZCASH_ADDRESS` shows where funds would flow.
4. **Server sees claim secrets at claim time** (Mode A). Mode B reduces what the server stores.
5. **Fiat prices are indicative.** A payout's amount is fixed in its own currency at creation; other fiat figures use the current (or fixed fallback) rate.
6. Card/bank donations are simulated in this version.

---

## 19. Definition of done

- [ ] All M0–M5 acceptance checks pass.
- [ ] `npm run typecheck && npm test && npm run build` green on a fresh clone.
- [ ] Mock demo works with zero configuration beyond copying `.env.example` to `.env`.
- [ ] Testnet flow verified once end to end, with txids recorded in `docs/ZINGO_NOTES.md`.
- [ ] No secrets, PINs, seeds or recipient details in logs, DB (except hashes) or fixtures.
- [ ] README, DEMO_SCRIPT, DECISIONS and ZINGO_NOTES written.
