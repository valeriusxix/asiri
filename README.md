# Asiri

> *àṣírí* (Yoruba): "secret, confidential".
> **Private money you can send like a message.**

Asiri lets a community fund receive donations and pay people privately on Zcash, without anyone needing a wallet. Built for ZECATHON.

The full product spec is in [Agent.md](Agent.md). Design decisions are logged in [docs/DECISIONS.md](docs/DECISIONS.md).

## Run it (mock mode, no blockchain needed)

Requires Node.js 22.12+ (tested on 24).

```bash
npm install
cp .env.example .env        # Windows PowerShell: Copy-Item .env.example .env
npm run dev                 # API on :8787, web on http://localhost:5173
```

Open http://localhost:5173.

### Checks

```bash
npm run typecheck && npm test && npm run build
```

### Single-port production build

```bash
npm run build
npm start                   # serves the web app and the API on http://localhost:8787
```

When using `npm start`, set `PUBLIC_WEB_URL=http://localhost:8787` in `.env` so claim links point at the right port.

### API walkthrough with curl (mock mode)

With the API running (`npm run dev` or `npm start`), run the whole money flow from a terminal:

```bash
bash scripts/curl-walkthrough.sh            # defaults to http://localhost:8787
```

It runs these calls (shown here by hand; `$B=http://localhost:8787/api`):

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
