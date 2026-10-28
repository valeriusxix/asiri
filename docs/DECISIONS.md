# Decisions

Where Agent.md is ambiguous, impossible, or out of date with current libraries, the chosen resolution is recorded here (Agent.md rule 10). Newest at the bottom.

## D-001 Payout currency is naira only (superseded by D-038)
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

## D-027 Fixed fallback rate and seed pricing (rates superseded by D-038)
CoinGecko quoted ₦1,616,408 / $1,199 per ZEC on 2026-10-25, against the spec's placeholder of ₦60,000 / $40. `.env.example` and the env defaults now use ₦1,600,000 / $1,200, as Section 6 asks ("update before demo"), so the fallback rate stays in the same range as the live one. The demo seed writes donations in naira and converts them at the rate the app will show (the live quote, or the fixed one), rounded to 3 significant figures of ZEC. Seeded payouts and the public naira totals then add up at whatever price ZEC trades at.

## D-028 Unconfirmed sends keep the payout in `claiming`
D-005 returns a payout to `active` when a send fails. That is only safe when nothing went out. On testnet a quicksend can take over 3 minutes (mixnet retries), so a timeout during a send does not prove that nothing was sent. New error code `send_unconfirmed`, used when the send was killed after zingo-cli started narrating it, when it exited 0 without a readable txid, or when `guardAdapter`'s own send timeout (6 min, longer than the adapter's 5 min) fires. The payout then stays `claiming` (so the link can never pay twice), a `payout.send_unconfirmed` audit event is written, and the recipient gets `409 already_processing` ("This is already being sent…"). The organizer checks the wallet and resolves it by hand, as in D-014. A zingo-cli failure exit (it checks delivery and marks the transaction failed itself), or a session killed before the send began, still returns the payout to `active`.

## D-029 Stale-while-revalidate balance cache (zingo mode)
A testnet sync holds the wallet mutex for up to 4 minutes, and the admin dashboard queued behind it (271 s seen). Once a balance is known, `cacheAdapter` returns it immediately when it is older than its 15 s TTL or a sync has run, and refreshes it in the background (one refresh at a time). A send clears the cached balance completely and discards any refresh started before it. Otherwise the pre-send balance would overstate what is available for new payouts. `send` itself always reads the real balance before transmitting.

## D-030 Production refuses placeholder session secrets (audit H1)
The `.env.example` `SESSION_SECRET` is public and long enough to pass the 32-character rule, so anyone could sign an admin session cookie with it. In production, boot also refuses a secret that contains `replace-with`, `change-me` or `example`, or has fewer than 10 distinct characters, and prints the command that generates a new one. Development still boots from `.env.example` unchanged.

## D-031 Mock placeholders are labelled on public pages (audit H2)
In mock mode the treasury address, its QR code and the viewing key are fakes that no wallet accepts, and every total is mock data. `/api/fund` and `/api/transparency` add `mode` (additive, like D-017). When `mode` is `"mock"`, the Donate card and the transparency page show a Demo badge and say the address, totals and key are placeholders. The header pill reads **DEMO** instead of TESTNET, because mock mode touches no network at all (Section 11.1's TESTNET pill still shows whenever a real treasury runs on testnet). The web app now has render tests (`apps/web/src/test`, Vitest with `react-dom/server`), run by root `npm test`.

## D-032 Dev routes need the organizer session (audit H3)
Section 8.5 mounts `/api/dev/mock-donate` in mock mode without saying who may call it. The demo is served on a LAN (DEMO_SCRIPT), so an open route let anyone on the same Wi-Fi inflate the public totals (one call accepted 21 million ZEC) and write memos into the organizer's donation list. The dev router now requires the admin session, and `amountZat` is capped at 100 ZEC per call. The admin's "Add 0.5 ZEC" button, the curl walkthrough and the test helper send the session cookie.

## D-033 Demo cash-outs are broken out of Paid out (audit M1)
Section 8.1 defines `paidOutZat` as claimed payouts, so demo cash-outs (claimed, but no bank transfer and no on-chain send) stay in Paid out and People helped. The demo's "Paid out went up" moment depends on that. They are not silent any more: `/api/transparency` `totals` adds `demoCashoutZat` and `demoCashoutCount` (same definition as D-002's `settledOffchainZat`), and the page shows them in a Demo-badged line, "Counted in Paid out. Demo only: no real bank transfer happened." Report stats add `demoCashouts` / `demoCashoutsCount`, and the template says how much of the period's payments were demo cash-outs. A cash-out sent to `OFFRAMP_ZCASH_ADDRESS` moved real money on chain, so it is not counted as a demo cash-out.

## D-034 Report validation checks every number (audit M2, supersedes part of D-026)
Section 12 rejects only invented numbers of 3 or more digits, so "47 families", "₦3 million", "₦1.5m" and "85%" all passed, while the README promised that any number not in the totals is rejected. The validator now rejects every number that doesn't appear in the stats, whatever its length. It also rejects figures it can't check: percentages, scale words (thousand, million, `k`, `m`, `bn`) and numbers above ten written as words. Report stats add `periodDays`, so "the last 30 days" is allowed. The ZEC rate is no longer an allowed number, because the text must never mention ZEC. Small number words (one to ten), a figure that happens to match a date or count in the stats ("₦2,026" in a 2026 report), and descriptions of people can't be caught reliably, so the draft-then-publish review stays the final check, and the README says so. Stricter checking means Claude's text falls back to the template a little more often, which is the safe direction.

## D-035 Production login requires HTTPS (audit M3)
In production the session cookie is `Secure` (Section 8.3). Over plain HTTP, cookie-session silently skips it, so `POST /api/auth/login` returned 200 and the organizer was never logged in. Locally, `docker run -p 8787:8787`, which runs in production mode, hit exactly this. Production login over a non-secure request now returns `400 { error: "https_required" }`, before any credential check, and the login page explains it. Behind a TLS-terminating proxy, `trust proxy` (Section 13.9) makes `req.secure` true. The README's Docker section says how to try the image over `http://localhost`.

## D-036 A reload after a claim says it was received (audit L2)
Section 11.2 drops the secret from the address bar after "Done", and a URL without a fragment shows "This link is incomplete. Ask the sender to send it again." So a recipient who refreshed the page right after being paid was told to ask for a new link. On "Done", the claim page now writes `asiri:claimed:<payoutId>` to `sessionStorage` (only the id, cleared when the tab closes). A fragment-less load in the same tab then shows "You have received this support". If storage is blocked, the old message shows.

## D-037 Redeem answers only the holder of the claim token (audit L1)
`/redeem` takes no secret, only the payout id (which is in the URL path, so it reaches access logs and WhatsApp's link-preview fetch) and a claim token. It used to branch on the payout's status before checking the token, so a garbage token returned 401 for active, 409 for claimed, 410 for cancelled or expired, and 404 for unknown ids. It now compares the token hash first (timing-safe), and every non-matching token, including unknown ids, gets `401 claim_session_expired`. The claim page then asks for the PIN again, and `/unlock` (secret + PIN) gives the true status. The spent token's hash is now kept after a claim, so replaying it is still the `409 already_processing` double claim Section 14 requires. Cancel, expiry and lock still clear the token. This refines D-003.

## D-038 Multi-currency (NGN, USD, GBP, CAD) and global framing
Supersedes D-001 (naira only) and the rates in D-027. The field names in D-017 are renamed as listed below.
- **One definition per app.** `apps/api/src/lib/currency.ts` (mirrored by hand in `apps/web/src/currency.ts`, since there is no shared package) defines each currency: code, symbol, locale, 2 minor units, and payout and donation limits. Formatting is `Intl.NumberFormat(locale, { style: "currency", currency })`, with two adjustments. The currency symbol is replaced by the defined one, because en-CA prints "$" for CAD, which would read as USD on a page that mixes currencies, so CAD shows "CA$". NGN drops ".00" on whole amounts ("₦50,000"), as naira amounts are usually written; the others keep it ("$50.00").
- **Env.** `FUND_CURRENCY` (default `USD`) is the display currency. `FIXED_ZEC_NGN/USD/GBP/CAD` are fallback rates. Their `.env.example` and default values (1,000,000 / 1,000 / 1,000 / 1,000) are deliberately round placeholders, not market prices; the operator sets them before a demo. Default `FUND_NAME` is "Community Relief Fund".
- **Prices.** One CoinGecko call (`vs_currencies=ngn,usd,gbp,cad`), cached 5 minutes. A currency missing or invalid in the answer falls back to its fixed rate alone, and `/api/price` reports the source of each.
- **Payouts.** `{ amount, currency? }`: up to 2 decimals, stored as integer minor units, within the currency's limits (default currency `FUND_CURRENCY`). New columns `currency`, `amount_fiat_minor` and `rate_zec_fiat` are added with `ALTER TABLE ADD COLUMN` (idempotent, no rebuild), and old rows are backfilled as NGN. The legacy `amount_ngn_at_creation` and `rate_zec_ngn` are NOT NULL, so new rows still write them (the naira equivalent at creation), but nothing reads them.
- **Renamed fields.** `amountNgn` becomes `amount` (+ `currency`); `amountNgnDisplay` becomes `amountDisplay` (+ `currency`); overview `zecNgn` becomes `rates` + `fundCurrency`; transparency `currency` becomes `fundCurrency`; `/api/price` becomes `{ rates, sources, fundCurrency, updatedAt }`; report stats `rateZecNgn` becomes `rateZecFiat` + `currency`, `currencyName`, `currencySymbol`. Agent.md is updated to match.
- **Transparency and admin overview** show fiat in `FUND_CURRENCY` with an NGN/USD/GBP/CAD switcher converted on the client and labelled "approx., at today's rate"; the choice is kept in localStorage behind try/catch. The admin overview uses the `rates` it returns, which come from the same price service as `/api/price`.
- **Share message** now names the formatted amount, as requested ("you have received £40.00 in support from …"). The trade-off: anyone who sees the WhatsApp or SMS message sees the amount. The link's secret and the PIN stay separate as before.
- **Demo cash-out** asks for the payout currency's usual details (NGN account number; USD routing + account; GBP sort code + account; CAD institution + transit + account), with a free-text bank name for all. The API checks them against the payout's currency only after the claim token is verified, so a request without the token learns nothing about the payout (D-037), and then drops them.
- **Reports.** The prompt names the fund currency and its symbol. Number matching compares canonical figures, so "£1,250" and "£1,250.00" match, in every currency's format.
- **Seed.** Every amount is written once in dollar terms and converted at the seeding rates, so the history adds up at any rates. Payouts mix all four currencies, rounded to two significant figures in their own currency.
- **Internal-note guard** now rejects runs of 7 or more digits (was 10), because phone and account numbers elsewhere are shorter (UK accounts are 8 digits).
- **Framing.** Recipient and public copy, README, DEMO_SCRIPT and Agent.md describe global use cases. The home page's "why privacy" text and the pitch story describe the risk in general terms instead of citing one country's event. Facts kept as records (the testnet run's ₦5,000 payout in ZINGO_NOTES, README and DEMO_SCRIPT, and the audit in AUDIT.md) are unchanged.

## D-039 Brand tokens from the logo, one Navbar (supersedes the colours in Section 11.1)
The logo (`apps/web/src/assets/logo.png`, 4500 x 2700) is a violet rounded square with a dark "A" on a dark canvas. Its colours were read from the pixels: the square runs from `#7C44FA` (top) to `#C890FE` (bottom), and the letter is `#04011F`. The Navbar uses `logo-mark.png`, the square alone, cut from that file with transparent corners and scaled to 208 x 200. The whole canvas would make the mark about 15 px tall at Navbar size, and the 240 KB original breaks Section 11.1's 100 KB image limit; the mark is 10 KB. It is imported through Vite, so the build ships it hashed under `/assets/`. The mark has no wordmark, so the Navbar shows "Asiri" beside it.
- **Tokens** live in the `@theme` block in `apps/web/src/index.css`: `brand-primary` (#7C44FA) with hover, pressed, strong and tint shades; `brand-secondary` (#C890FE); `brand-ink` (#04011F); violet-tinted neutrals; and success, error, warning and info colours kept apart from the violet. The logo has no third distinct hue, so there is no `brand-accent`: the ink takes that role on dark surfaces.
- **Contrast (WCAG AA).** White on `brand-primary` is 5.2:1, so primary buttons use white labels (the old gold used dark ones). `brand-secondary` is 2.4:1 on white, so it is used only on `brand-ink` (8.6:1) or behind ink text, never as text on a light background. `brand-primary` as text on its own tint is 4.48:1, so text on tints uses `brand-primary-strong` (#6A31EB, 5.6:1). Muted text is #58536E (7.3:1) and small print #6C6784 (5.0:1 on the page background); the old `black/45` small print was about 3.4:1. Form fields have a #8E88A6 edge (3.4:1). The success colour for white labels is #15803D (5.0:1), because #16A34A is 3.3:1.
- **Status badges** stay away from the brand violet: blue for active, amber for sending, green for claimed, grey for expired and cancelled, red for locked. Each badge also has a dot and its label, so colour is never the only cue.
- **One Navbar** (`components/Navbar.tsx`) on every page. Public pages: logo to `/` plus Donate and Transparency. Claim page: logo and network pill only. Dashboard: logo to `/admin`, with its links collapsing into a menu below 768 px. The Demo and Testnet pills stay everywhere.
- **Icons.** `public/favicon.png` (64 px), `public/icon-512.png` and `public/apple-touch-icon.png` (180 px, opaque on the ink, with padding) are square versions of the mark. The mark is 1336 x 1285 in the source, so it is padded to square, not stretched. `scripts/check-logo.mjs` checks that the logo ships and loads on every kind of page.

## D-040 Render deployment (render.yaml)
The public demo deploys on Render from a Blueprint: one Node web service, no Docker, so builds take minutes instead of a Rust compile. It runs in mock mode with `DEMO_MODE` on, like the local demo.
- **Free plan by default.** A free service has no persistent disk, so SQLite is wiped on every restart. `scripts/render-start.sh` reseeds an empty database (`seed.js --if-empty`, gated by `SEED_DEMO_DATA`), so the site always comes up with the demo data. A paid plan with a disk keeps data; `render.yaml` has that block commented out.
- **Claim links default to `RENDER_EXTERNAL_URL`** when `PUBLIC_WEB_URL` is unset, so a new service needs no URL typed in before its first deploy. An explicit `PUBLIC_WEB_URL`, such as a custom domain, still wins.
- **Secrets.** Render generates `SESSION_SECRET`, and `ADMIN_EMAIL` and `ADMIN_PASSWORD` are entered in the Dashboard (`sync: false`), so none of them is in git. The `FIXED_ZEC_*` fallback prices are left out of the Blueprint: they are placeholders to be set to the day's rates in the Dashboard, and values in the Blueprint would overwrite those edits on every sync.
- **Node 24** is pinned in `.node-version`, because Render resolves an open `engines` range to the newest major.

## D-041 Testnet Blueprint (render.testnet.yaml)
A separate Blueprint file, so the free demo (`render.yaml`) stays as it is. The testnet service builds the full image from `docker/Dockerfile`, whose last stage carries zingo-cli and nym-proxy. Render builds the last stage, and its Blueprint has no build-target field. The service uses `ZCASH_MODE=zingo` on testnet with `DEMO_MODE=false`. It needs a paid plan, because the treasury wallet must live on a persistent disk at `/app/data`. `CARGO_BUILD_JOBS=2` is set because Render passes env vars to the Docker build as build args, and the nym-proxy build is memory-hungry. Not yet built or run on Render; DEPLOY_RENDER.md lists what to watch on the first deploy.
