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
