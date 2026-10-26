# Asiri

> *àṣírí* (Yoruba): "secret, confidential".
> **Private money you can send like a message.**

Asiri lets a community fund (mutual aid, relief, legal defence, medical support) receive donations and pay people privately on Zcash, without anyone needing a wallet. Built for **ZECATHON** (Zcash privacy hackathon).

- **Donors** give shielded Zcash by QR or payment link. A simulated card and bank option exists for the demo.
- **Organizers** create a payout in naira, and get a **claim link** plus a separate **6-digit PIN** to send over WhatsApp or SMS.
- **Recipients** open the link on any phone, enter the PIN, and choose **Cash out to my bank (demo)**, **Keep it for later**, or, under Advanced, **Send to a Zcash wallet**. There is no app, no sign-up, no seed phrase and no jargon.
- **Anyone** can open the transparency page and see totals raised and paid out, payments by need, a weekly chart, a plain-language update written by Claude, and the fund's **viewing key**, so the numbers can be checked independently. No recipient is ever identified.

**Accountability without a hit list.**

## Why Zcash

In 2020, during #EndSARS, relief groups in Nigeria had their bank accounts frozen. Moving to Bitcoin stopped the freezing, but it put every donor and every recipient on a public ledger. In a crisis, a public list of who received money can become a list of who to target.

Shielded Zcash fixes both problems at once:

- **Privacy:** shielded payments hide who gave, who received and how much, so a payout list cannot be turned against the people on it.
- **Accountability:** a **unified full viewing key (UFVK)** lets the fund publish read-only access to its own treasury. Donors and auditors can confirm the totals without being able to spend, and without learning who the recipients are.

Other chains offer one or the other. Asiri needs both.

## Quick start (mock mode, about 5 minutes)

Mock mode is the default. It needs no blockchain, no network and no API keys. A SQLite-backed mock treasury stands in for Zcash behind the same adapter interface as the real one.

Requires **Node.js 22.12 or newer** (tested on 24) and npm.

```bash
git clone <this repo> asiri && cd asiri
npm install
cp .env.example .env          # Windows PowerShell: Copy-Item .env.example .env
npm run seed:demo             # six weeks of demo history (optional, recommended)
npm run dev                   # API on :8787, web on http://localhost:5173
```

Open http://localhost:5173 and try:

1. **Organizers** (in the footer, or go to `/admin`), then log in with `organizer@example.com` / `change-me-now` (from `.env`).
2. **New payout**: ₦50,000, Medical. You get the link and the PIN, shown once.
3. **Open claim page** (or open the link on your phone, see below), then enter the PIN and **Cash out to my bank**.
4. Visit **Transparency** to see the payout counted, with no one identified.

`npm run seed:demo` refuses to touch a database that already has data. Use `npm run seed:demo -- --reset` to start over. It prices the seeded history at the current rate, which is CoinGecko when it is reachable and the fixed rate in `.env` otherwise.

### Single port, and opening links on a phone

```bash
npm run build
npm start                     # web app + API on http://localhost:8787
```

With `npm start`, set `PUBLIC_WEB_URL=http://localhost:8787` in `.env` so claim links point at the right port. To open claim links on a phone on the same Wi-Fi, use the laptop's LAN IP instead, for example `PUBLIC_WEB_URL=http://192.168.1.20:8787`, and allow Node.js through the firewall. The full pitch walkthrough, with prep and backup plans, is in [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md).

### Checks

```bash
npm run typecheck && npm test && npm run build
```

`npm test` runs the API test suite (Vitest and Supertest against in-memory SQLite and the mock adapter, with a fake clock and no network). It also runs `scripts/check-copy.mjs`, which fails if the recipient's default claim path ever uses the words *wallet, seed, blockchain, ZEC, shielded, address, crypto, token* or *transaction*.

### Optional: AI-written updates

Set `ANTHROPIC_API_KEY` (and optionally `ANTHROPIC_MODEL`, default `claude-sonnet-5-5`) to have Claude write the donor updates. Claude only ever sees aggregate totals, never individual payouts. Its output is rejected, and the built-in template is used instead, if it contains any number not in the totals or any crypto jargon. Without a key, the template is used everywhere.

## Testnet mode (verified end to end)

`ZCASH_MODE=zingo` swaps the mock for `zingo-cli` (zingolib v7) talking to a lightwalletd server, with sends routed over the Nym mixnet. On 2026-10-26 the full flow ran on the Zcash testnet:

1. A 1 TAZ donation reached the treasury and was imported by "Sync now".
2. A ₦5,000 Medical payout was claimed to a second testnet wallet, which received it with the memo "Asiri payout".
3. The claim's txid was [`e50c15de…98648f`](https://testnet.zcashexplorer.app/transactions/e50c15de6c0d0838a68115af8e97098543b477012b3c7e2f4134d63ff798648f), mined in block 4,545,316.

Every command, flag and output format came from the real binary: help output, captured fixtures, and tested parsers. See [docs/ZINGO_NOTES.md](docs/ZINGO_NOTES.md).

```ini
ZCASH_MODE=zingo
ZCASH_NETWORK=testnet
LIGHTWALLETD_URL=https://testnet.zec.rocks:443
ZINGO_CLI_PATH=/path/to/zingo-cli     # nym-proxy must sit beside it (both build from zingolib_v7.0.0)
TREASURY_DATA_DIR=./data/treasury     # the treasury wallet; back it up
SYNC_INTERVAL_SECONDS=300             # each testnet sync takes 20 to 120 s
```

On first boot the server creates the treasury wallet online and prints the command for backing up the seed. It never prints the seed itself.

Things to know on testnet:
- **Slow sends.** A send takes 40 to 200 s over the mixnet, so the claim page says "Sending…" for that long.
- **Stalled mixnet sessions.** The Nym mixnet bootstrap sometimes stalls a session. The adapter kills stalled sessions, retries syncs on the next tick, and never reopens a link whose send may have gone out (DECISIONS D-028).
- **Waiting change.** After a payout, the change needs 3 confirmations before the next payout can be sent. Until then the recipient sees "on its way, try again in a few minutes".
- **Faucets.** On 2026-10-26 the public faucets were down for NU7 (see ZINGO_NOTES).

## Docker

One container runs the API, serves the built web app, and includes zingo-cli (Section 17 of the spec):

```bash
docker build -f docker/Dockerfile -t asiri .                 # full image (compiles zingo-cli + nym-proxy: slow, needs RAM)
docker build -f docker/Dockerfile --target mock -t asiri .   # mock-only image, no Rust stage
docker run -p 8787:8787 -v asiri-data:/app/data --env-file .env asiri
```

- **Mount a persistent volume at `/app/data`.** It holds the SQLite database and the treasury wallet. Without it, the wallet is lost on redeploy.
- The image runs with `NODE_ENV=production`. Boot then refuses the default `ADMIN_PASSWORD`, and session cookies are `Secure`. Put it behind HTTPS (any host with TLS termination works, such as Fly.io, Railway, Render or a VPS with Caddy) and set `PUBLIC_WEB_URL` to the public HTTPS URL.
- The Dockerfile has not been built on the development machine, which has no Docker. The Rust stage follows zingolib's documented build steps, and the Node stage runs the same commands as above.

## Architecture

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
        │      └─ ZingoAdapter        │── spawns zingo-cli ──► lightwalletd ──► Zcash testnet
        │  - Claude report writer     │── Anthropic API (optional)
        │  - price service            │── CoinGecko (cached) / fixed rate
        └─────────────────────────────┘
```

- **npm workspaces:** `apps/api` (Express 5, zod 4, better-sqlite3, pino with redaction, helmet, express-rate-limit, cookie-session, @anthropic-ai/sdk) and `apps/web` (React 19, React Router, Tailwind CSS v4, qrcode.react, recharts). TypeScript strict throughout.
- **One adapter interface, two implementations.** Everything above `zcash/` (payouts, donations, transparency, reports) is the same in mock and testnet mode. All wallet calls run through one mutex with timeouts. In zingo mode, slow reads are cached.
- **Money is integer zatoshis** everywhere it is stored. Naira is fixed per payout at creation; everywhere else it is indicative, at the current rate.
- **Custody (MVP, "Mode A"):** one shielded treasury wallet held by the server. A payout reserves funds, and the on-chain send happens only at claim time.

### How a claim link stays safe

- The link is `/c/<payoutId>#<secret>`. The 32-byte secret sits in the **URL fragment**, which browsers never send to servers, so WhatsApp link previews, access logs and analytics never see it.
- The **PIN** travels separately (a call or the "Text the PIN" SMS button), is shown to the organizer once, and is stored only as an scrypt hash. Wrong PINs are counted, and the link locks after 5.
- The database stores only **hashes** of the secret, PIN and short-lived claim token, all compared with `timingSafeEqual`.
- `active → claiming` is one atomic SQL update conditioned on the status and a valid claim token, so a link can never be paid twice, even under concurrent requests.
- Links expire (14 days by default), and organizers can cancel or unlock them.
- **No recipient identity is collected.** Bank details are discarded on receipt. Zcash addresses are passed to the wallet and never stored (the mock stores a short hash). Request logs carry only method, path, status and timing, and the logger redacts secret-shaped fields.

### Layout

```
apps/api/src   index.ts (boot), app.ts (factory used by tests), env.ts, db/, lib/, zcash/, services/, routes/, jobs.ts, test/
apps/web/src   pages/, components/, copy.ts (every user-facing string), api.ts, types.ts
docs/          DECISIONS.md (every spec ambiguity and its resolution), ZINGO_NOTES.md, DEMO_SCRIPT.md
docker/        Dockerfile
scripts/       check-copy.mjs, curl-walkthrough.sh
```

The full product spec is [Agent.md](Agent.md). Every deviation from it is logged in [docs/DECISIONS.md](docs/DECISIONS.md).

## Known limitations

1. **Custodial treasury (MVP).** The server holds the fund's spending key. The roadmap is FROST threshold signing, so several organizers must approve every payout.
2. **Bearer links.** Whoever has both the link and the PIN can claim. The mitigations are the PIN by a separate channel, attempt limits, expiry and cancel.
3. **Cash-out is simulated.** Real naira or mobile-money off-ramps need a licensed partner. The optional `OFFRAMP_ZCASH_ADDRESS` shows where the funds would flow.
4. **The server sees claim secrets at claim time** (Mode A). Mode B, a one-time wallet per link, would reduce what the server holds.
5. **Naira figures are indicative.** A payout's naira amount is fixed at creation, and other figures use the current rate.
6. **Card and bank donations are simulated** in this version. They are labelled as such and never counted as money raised.
7. **An uncertain send needs a manual check.** If the server dies mid-send, or a testnet send times out after it started, the payout stays `claiming` and is not reverted automatically, because the money may have gone out (DECISIONS D-014, D-028). There's no admin button yet to resolve it against the wallet.
8. **Testnet sends are slow and occasionally stall** on the Nym mixnet (40 to 200 s per send). The live demo uses the mock treasury, and the testnet run is recorded in ZINGO_NOTES with its txids.

## Roadmap

1. Admin tools for the real treasury: resolve `claiming` payouts against the wallet's transactions, and show sync health and mixnet status.
2. Pidgin English toggle for recipient pages.
3. Mode B: fund a one-time wallet per link, so the server never holds a claimable secret.
4. Cross-chain donations, swapping into shielded ZEC through an intents or swap provider.
5. Multi-organizer approval with FROST threshold signing.
6. A real off-ramp partner for naira and mobile-money cash-outs.

## API walkthrough with curl (mock mode)

With the API running (`npm run dev` or `npm start`), you can run the whole money flow from a terminal:

```bash
bash scripts/curl-walkthrough.sh            # defaults to http://localhost:8787
```

It runs these calls (shown here by hand, with `$B=http://localhost:8787/api`):

```bash
curl -s $B/health
curl -s -c jar.txt -H 'Content-Type: application/json' \
  -d '{"email":"organizer@example.com","password":"change-me-now"}' $B/auth/login
curl -s -H 'Content-Type: application/json' -d '{"amountZat":200000000}' $B/dev/mock-donate   # fake 2 ZEC donation
curl -s -b jar.txt -X POST $B/admin/sync                                                     # import it
curl -s -b jar.txt -H 'Content-Type: application/json' \
  -d '{"amountNgn":50000,"category":"medical"}' $B/admin/payouts        # -> { link, pin, whatsappUrl, ... }
# link = http://localhost:5173/c/<id>#<secret>
curl -s -H 'Content-Type: application/json' -d '{"secret":"<secret>"}' $B/claims/<id>/open
curl -s -H 'Content-Type: application/json' -d '{"secret":"<secret>","pin":"<pin>"}' $B/claims/<id>/unlock   # -> claimToken
curl -s -H 'Content-Type: application/json' \
  -d '{"claimToken":"<token>","method":"zcash_address","zcashAddress":"utest1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq"}' \
  $B/claims/<id>/redeem                                                  # -> { status: "claimed", txid }
curl -s $B/transparency
```
