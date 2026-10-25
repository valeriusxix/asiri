# Decisions

Where Agent.md is ambiguous, impossible, or out of date with current libraries, the chosen resolution is recorded here (Agent.md rule 10). Newest at the bottom.

## D-001 Payout currency is naira only
Section 1 says organizers create payouts "in USD($), CAD or naira (₦)". Every detailed section (2.1, 7, 8.4, 11.2, 12, env vars) only models naira: `amountNgn`, `amount_ngn_at_creation`, `rate_zec_ngn`, `FIXED_ZEC_NGN`. There is no CAD rate anywhere.
**Resolution:** payouts are created in ₦ only. `/api/price` also returns `zecUsd` (as specified) and the UI may show USD as a secondary hint. Multi-currency payouts would need a schema change; not done unless requested.

## D-002 Demo cash-outs keep their funds earmarked
With `cashout_demo` and no `OFFRAMP_ZCASH_ADDRESS`, no send happens, so the ZEC stays in the treasury. Under the Section 7 formula the payout leaves the reserved statuses when claimed, so "available" would jump back up after a payout is paid: the same money could be paid twice.
**Resolution:** `settledOffchainZat = SUM(amount_zat + fee_buffer_zat)` over payouts with `status='claimed' AND claim_method='cashout_demo' AND claim_txid IS NULL`. `availableZat = max(0, spendableZat - reservedZat - settledOffchainZat)`. `reservedZat` keeps the spec meaning (open links). The admin overview gets one extra field, `settledOffchainZat`.

## D-003 Claim endpoint behaviour on non-active payouts
- `/open` reports `claiming` as `available` (a failed send returns it to `active`; a concurrent redeem gets `409 already_processing`).
- `/unlock` and `/redeem` on a payout that is `claimed`, `expired` or `cancelled` return `410 { error: <status> }`. `locked` returns `423 { error: "locked" }`.
- Expiry is enforced lazily on every claim request (an `active`/`locked` payout past `expires_at` is moved to `expired` first) in addition to the job loop, so a link never works past its expiry even between job ticks.

## D-004 PIN attempts
A correct PIN resets `pin_attempts` to 0. The attempt that reaches `PIN_MAX_ATTEMPTS` locks the payout and returns `423`, not `401 attemptsLeft: 0`.

## D-005 Failed sends keep the claim token
When a send fails, the payout goes `claiming → active` and the claim token stays valid until its normal expiry, so the recipient can retry without re-entering the PIN.

## D-006 Starting folder contents
The folder contained a stock `create-vite` React JS template. It was moved to `.template-backup/` (gitignored). The root `src/` folder of that template could not be moved because a process holds a lock on it; it is gitignored and can be deleted by hand. `Agent.Md` was renamed to `Agent.md` to match the spec and case-sensitive filesystems. ESLint (optional in Section 4) is not set up, to save time.

## D-007 Library versions newer than the spec assumed
Installed at latest stable on 2026-10-25: TypeScript 7, React 19.3, React Router 8, Vite 8, Tailwind 4.3, Zod 4, Vitest 5, Express 5.3, better-sqlite3 13, pino 10, dotenv 18, @anthropic-ai/sdk 1.x. API differences found while building are listed below as separate entries.

## D-008 Relative paths resolve against the repo root
`npm run <x> -w apps/api` runs with `apps/api` as the working directory, but the Docker volume is mounted at `/app/data` (Section 17). `DATABASE_PATH` and `TREASURY_DATA_DIR` are resolved relative to the repo root, not the process cwd. `.env` is read from the repo root.

## D-009 Copy check
`scripts/check-copy.mjs` scans the text between `// @claim-default:start` and `// @claim-default:end` markers in `apps/web/src/copy.ts` (keys and values) for the Section 11.3 forbidden words, case-insensitive, whole words. It runs as part of root `npm test`. Text scanning avoids needing a TS loader in the script.

## D-010 CSP
The Section 13 CSP is applied in every mode (not only production), with `upgrade-insecure-requests` left out, so `npm start` over `http://localhost` works. Helmet's other defaults stay on.

## D-011 Audit events for sync
`sync.ok` is written only when a sync imports at least one donation, and `sync.error` only when the error message changes, so a 60-second loop does not add a row every minute. The last sync time and error are kept in memory for `/api/admin/overview`.

## D-012 Weekly buckets
`weekly` uses ISO weeks starting Monday 00:00 UTC; `weekStart` is a `YYYY-MM-DD` date. Received counts only `zcash` donations (simulated ones are excluded everywhere they would count as raised).

## D-013 Naira figures on the transparency page
Totals are stored and returned in zat. The page converts them to ₦ at the current rate (indicative, Section 18.5). The ₦ amount a recipient sees is the one fixed at payout creation.

## D-014 Stuck `claiming` payouts
If the server dies between `claiming` and the send result, the payout stays `claiming`. It is not auto-reverted, because the send may have happened. The admin list shows it; recovery is manual. Documented as a limitation.

## D-015 Optional `ANTHROPIC_BASE_URL`
Added an optional env var passed to the Anthropic SDK client, so the report generator can run through an Anthropic-compatible gateway. Empty means the SDK default.
