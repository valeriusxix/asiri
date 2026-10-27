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
- `/unlock` on a payout that is `claimed`, `expired` or `cancelled` returns `410 { error: <status> }`; `claiming` returns `409 already_processing`. `locked` returns `423 { error: "locked" }`.
- `/redeem` on a `claiming` or `claimed` payout returns `409 already_processing` (the M1 double-redeem check); `expired`/`cancelled` return `410`.
- `/redeem` on an `active` payout whose claim token is wrong or past its TTL returns `401 { error: "claim_session_expired" }` (the client asks for the PIN again), instead of the spec's blanket 409, which would be misleading there.
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

## D-016 Mock ledger stores an address fingerprint, not the address
Section 7 gives `mock_ledger` a `to_address` column, but rule 6 forbids storing recipient Zcash addresses. The MockAdapter stores `sha256:<first 16 hex>` of the address instead. It is enough to tell sends apart in tests and reveals nothing.

## D-017 Additive response fields
Fields added on top of Section 8 (nothing removed or renamed):
- `GET /api/fund` and `GET /api/health` add `demoMode`, so the web app knows whether to show the demo cash-out and demo donation tab (the claim page reads it from the cheap health call).
- `GET /api/transparency` `latestReport` adds `stats` (the report's `stats_json`), so the public card shows the numbers beside the text (Section 12).
- `GET /api/admin/overview` adds `settledOffchainZat` (D-002), `zecNgn`, `mode`, `network`.
- Admin payout and donation lists include pre-formatted `amountNgnDisplay` / `amountZecDisplay`.
- `POST /api/admin/payouts` returns `201`.

## D-018 Internal note guard
Besides the UI hint, the API rejects internal notes containing a run of 10 or more digits (Nigerian phone numbers are 11 digits, NUBAN account numbers 10). Names cannot be detected reliably, so they rely on the UI warning.

## D-019 Transparency `outstandingZat`
`outstandingZat` is the sum of `amount_zat` for open links, without the fee buffer, because the public figure means "money waiting for people". The admin `reservedZat` keeps the fee buffer, as in Section 7.

## D-020 Admin sessions also expire server-side
cookie-session stores the session in a signed cookie, so `maxAge` alone is only enforced by the browser. The session also carries its issue time, and the API rejects sessions older than 12 hours.

## D-021 Request logging
The request logger writes only method, path (no query string), status and duration. Claim-link secrets are in the URL fragment and never reach the server. No body, header or cookie is ever logged.

## D-022 Code splitting beyond admin
Section 11.1 asks for admin routes to be code-split. Donate (QR library) and Transparency (recharts, about 100 KB gzipped) are lazy-loaded too, so the claim page, the one recipients open on low-end phones, ships only React, the router and its own code. The Transparency page starts fetching the chart chunk as soon as its module loads.

## D-023 Chart colors
Weekly chart: received `#b47700` (Asiri gold, darkened) and paid out `#2a78d6`, checked with a palette validator against the white card (CVD ΔE 26.6, normal-vision ΔE 29.7, both at least 3:1 contrast). The chart always has a legend, a per-bar tooltip, and a "Show as table" view.

## D-024 "Text the PIN" button
The payout result screen also offers an SMS button prefilled with only the PIN ("Your PIN is 123456. Do not share it."), which makes the separate channel in Section 2.1 one tap away. The WhatsApp and SMS link messages still never contain the PIN.

## D-025 Claude report request settings
- Model comes from `ANTHROPIC_MODEL` (spec default `claude-sonnet-5-5`), with `max_tokens: 600` as specified.
- `output_config.effort: "low"`: current models think by default, and thinking tokens count against `max_tokens`. Low effort keeps a 120 to 180 word paragraph from being truncated. Any `stop_reason` other than `end_turn` (refusal, max_tokens, …) falls back to the template.
- Server-side refusal fallback (`betas: ["server-side-fallback-2026-07-01"]`, `fallbacks: "default"`) is sent only when `ANTHROPIC_BASE_URL` is unset, since it is a first-party Claude API beta and a custom gateway may reject it. Either way, our own template fallback covers refusals.
- No `temperature` / `top_p` (rejected by the API since 2026-10-21).

## D-026 Report validation
On top of Section 12's number check (any 3+ digit number not present in the stats rejects the output), the validator also rejects empty text and crypto jargon (`ZEC`, `zatoshi`, `blockchain`, `crypto`, `shielded`, `wallet`), since the text is published on the public page. Numbers allowed are collected from every field of the stats, including the period label, so dates like "2026" pass.

## D-027 Fixed fallback rate and seed pricing
CoinGecko quoted ₦1,616,408 / $1,199 per ZEC on 2026-10-25, against the spec's placeholder of ₦60,000 / $40. `.env.example` and the env defaults now use ₦1,600,000 / $1,200, as Section 6 asks ("update before demo"), so the fallback rate stays in the same range as the live one. The demo seed writes donations in naira and converts them at the rate the app will show (the live quote, or the fixed one), rounded to 3 significant figures of ZEC. Seeded payouts and the public naira totals then add up at whatever price ZEC trades at.

## D-028 Unconfirmed sends keep the payout in `claiming`
D-005 returns a payout to `active` when a send fails. That is only safe when nothing went out. On testnet a quicksend can take over 3 minutes (mixnet retries), so a timeout during a send does not prove that nothing was sent. New error code `send_unconfirmed`, used when the send was killed after zingo-cli started narrating it, when it exited 0 without a readable txid, or when `guardAdapter`'s own send timeout (6 min, longer than the adapter's 5 min) fires. The payout then stays `claiming` (so the link can never pay twice), a `payout.send_unconfirmed` audit event is written, and the recipient gets `409 already_processing` ("This is already being sent…"). The organizer checks the wallet and resolves it by hand, as in D-014. A zingo-cli failure exit (it checks delivery and marks the transaction failed itself), or a session killed before the send began, still returns the payout to `active`.

## D-029 Stale-while-revalidate balance cache (zingo mode)
A testnet sync holds the wallet mutex for up to 4 minutes, and the admin dashboard queued behind it (271 s seen). Once a balance is known, `cacheAdapter` returns it immediately when it is older than its 15 s TTL or a sync has run, and refreshes it in the background (one refresh at a time). A send clears the cached balance completely and discards any refresh started before it. Otherwise the pre-send balance would overstate what is available for new payouts. `send` itself always reads the real balance before transmitting.

## D-030 Production refuses placeholder session secrets (audit H1)
The `.env.example` `SESSION_SECRET` is public and long enough to pass the 32-character rule, so anyone could sign an admin session cookie with it. In production, boot also refuses a secret that contains `replace-with`, `change-me` or `example`, or has fewer than 10 distinct characters, and prints the command that generates a new one. Development still boots from `.env.example` unchanged.

## D-031 Mock placeholders are labelled on public pages (audit H2)
In mock mode the treasury address, its QR code and the viewing key are fakes that no wallet accepts, and every total is mock data. `/api/fund` and `/api/transparency` add `mode` (additive, like D-017). When `mode` is `"mock"`, the Donate card and the transparency page show a Demo badge and say the address, totals and key are placeholders. The header pill reads **DEMO** instead of TESTNET, because mock mode touches no network at all (Section 11.1's TESTNET pill still shows whenever a real treasury runs on testnet). The web app now has render tests (`apps/web/src/test`, Vitest with `react-dom/server`), run by root `npm test`.
