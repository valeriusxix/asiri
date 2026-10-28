# Deploying on Render

`render.yaml` is a Render Blueprint for the public demo. It sets up one web service that builds the web app and the API and serves both on Render's port. It uses the mock treasury with `DEMO_MODE` on, takes live CoinGecko rates, and fills an empty database with the demo data. Every demo surface stays labelled Demo, as it is locally.

## Steps

1. Merge to `main`. The Blueprint deploys from `main`, and every new commit there deploys again.
2. In the [Render Dashboard](https://dashboard.render.com), click **New > Blueprint** and pick the `valeriusxix/asiri` repo. Render reads `render.yaml` from the repo root.
3. Render asks for two values:
   - `ADMIN_EMAIL`: the organizer login.
   - `ADMIN_PASSWORD`: a strong password. Production refuses `change-me-now`.

   Render generates `SESSION_SECRET` itself.
4. Click **Apply**. The first build takes a few minutes. The service is then live at `https://asiri.onrender.com`, or at `https://asiri-xxxx.onrender.com` if that name is taken.
5. Set the fallback prices (see the next section).

## Live prices: add a CoinGecko key

The app asks CoinGecko for the ZEC rate. On Render, the keyless CoinGecko API refused every request on the first deploy (28 October 2026), and every currency fell back to the fixed placeholders. Render's outbound IPs are shared, which is the likely reason.

To fix it:
1. Create a free Demo API key at [coingecko.com/en/api](https://www.coingecko.com/en/api).
2. Add it as `COINGECKO_API_KEY` under the service's **Environment** tab. The service redeploys.
3. Open `https://<your-url>/api/price`. Every `sources` entry should say `coingecko`.

While the live price is unavailable, the logs show `live ZEC price unavailable, using the FIXED_ZEC_* rates` with the reason, such as `CoinGecko answered HTTP 429`. The key itself is never logged.

## Set the fallback prices

If CoinGecko still can't be reached, the app uses `FIXED_ZEC_NGN`, `FIXED_ZEC_USD`, `FIXED_ZEC_GBP` and `FIXED_ZEC_CAD`. Their defaults are **placeholders, not market prices** (1,000,000 and 1,000).

- Before a demo, set all four under the service's **Environment** tab to that day's rates.
- They aren't in `render.yaml` on purpose: values in the Blueprint would overwrite your Dashboard edits on every sync.
- The footer of `/transparency` tells you which rate is in use: it says "live rate" when CoinGecko answered.

## Check the deploy

- `https://<your-url>/api/health` should return `{"ok":true,"mode":"mock","network":"testnet","demoMode":true}`.
- Log in at `/login`, then create a payout. The claim link must start with your `onrender.com` URL. Open it on a phone.
- Check the logo on every page, from your machine:
  ```bash
  CHECK_BASE_URL=https://<your-url> CHECK_ADMIN_EMAIL=... CHECK_ADMIN_PASSWORD=... node scripts/check-logo.mjs
  ```

## The free plan

`render.yaml` uses `plan: free`, which costs nothing and has two consequences:

- **It sleeps.** After 15 minutes without traffic the service spins down. The next visit waits about a minute while it wakes. Open the site a minute before you present or record.
- **It forgets.** The filesystem is wiped whenever the service restarts, redeploys or spins down. The SQLite database goes with it, and the start script reseeds the demo data.
  - Payouts, donations and reports created since the last restart are gone.
  - A claim link sent before a spin-down stops working after it.
  - For a live demo, create the payout and claim it in the same session.

Free services share 750 hours a month per workspace. One service running all month fits.

## Keeping data

To keep data across restarts and deploys, change `render.yaml` as follows:
1. Set `plan: 0.5c-512mb` or larger. Persistent disks need a paid plan.
2. Uncomment the `disk` block. It mounts at `/var/data`.
3. Add these two env vars:
   ```yaml
   - key: DATABASE_PATH
     value: /var/data/asiri.db
   - key: TREASURY_DATA_DIR
     value: /var/data/treasury
   ```

With a disk attached, the demo data is seeded once; later boots leave the existing data alone. To start without demo data, set `SEED_DEMO_DATA` to `false`. A service with a disk can't scale beyond one instance, which suits SQLite.

## How it fits together

| Piece | What it does |
|---|---|
| `.node-version` | Pins Node 24, the version the Dockerfile and development use. `engines` alone (`>=22.12`) would let Render pick the newest major. |
| `buildCommand` | `npm ci --include=dev && npm run build && npm prune --omit=dev`. `NODE_ENV=production` would otherwise skip the devDependencies that the build needs (TypeScript, Vite). |
| `scripts/render-start.sh` | With `SEED_DEMO_DATA=true`, runs `seed.js --if-empty` (it seeds only an empty database), then `exec`s the server so Render's SIGTERM reaches Node for a clean shutdown. |
| `RENDER_EXTERNAL_URL` | Render sets it to the service's `https://….onrender.com` URL. When `PUBLIC_WEB_URL` is unset, claim links use it. For a custom domain, set `PUBLIC_WEB_URL` in the Dashboard. |
| HTTPS | Render terminates TLS. With `NODE_ENV=production` the app trusts one proxy hop, so organizer login sees the request as HTTPS and the session cookie is `Secure`. |
| `healthCheckPath` | `/api/health`. Render switches traffic to a new deploy only after it answers. |
| `PORT` | Render sets it (10000), and the server reads it. |

## Optional

- **AI-written updates:** add `ANTHROPIC_API_KEY` under Environment. Without it, reports use the template.
- **Testnet treasury:** see the next section.

## Testnet treasury (render.testnet.yaml)

`render.testnet.yaml` is a second Blueprint. It sets up a service with a real Zcash testnet wallet instead of the mock treasury: `ZCASH_MODE=zingo` against `testnet.zec.rocks`, with `DEMO_MODE` off. It runs beside the free demo, as its own service (`asiri-testnet`) with its own URL.

**This setup has not been built or run on Render.** The same flow ran end to end on testnet from a Windows machine on 26 October 2026 (README, "Testnet mode"). The Dockerfile has never been built, because the development machine has no Docker. Expect the first deploy to need fixes.

### Deploy it
1. In the Render Dashboard, click **New > Blueprint** and pick this repo.
2. Set **Blueprint Path** to `render.testnet.yaml`.
3. Enter `ADMIN_EMAIL` and `ADMIN_PASSWORD`.
4. Apply. This creates a paid service (`plan: 1c-2g`) and a 1 GB disk, both billed by Render.
   - The memory zingo-cli needs hasn't been measured; try `0.5c-512mb` if you want it cheaper.

### What to expect
- **A long first build.** The image compiles `zingo-cli` and `nym-proxy` from zingolib in Rust. On an 8-core Windows machine, zingo-cli alone took 19 minutes, and nym-proxy ran the machine out of memory twice (docs/ZINGO_NOTES.md).
  - `CARGO_BUILD_JOBS=2` keeps the build's memory down. Render passes env vars to the Docker build as build args.
  - If the build still hits Render's limits, it can't be finished on Render. The fallback is to build the image elsewhere and deploy it as a prebuilt image.
- **A slow first boot.** The server creates the treasury wallet online before it starts listening, which took 113 s on testnet. Health checks fail until then.
- **Back up the seed.** The boot log prints a backup command (never the seed itself).
  1. Open the service's **Shell** tab.
  2. Run the printed command, which ends in `recovery_info`.
  3. Store the seed offline.

  Render also snapshots the disk every day, but the seed is what recovers the funds.
- **Disk permissions.** The image runs as the `node` user and writes to `/app/data`, where the disk is mounted. If boot fails with `EACCES` on `/app/data`, the disk isn't writable by that user. That needs a change to the Dockerfile, which hasn't been tested on Render.
- **Funding.** Send testnet ZEC (TAZ) to the address on the Donate page. Then press **Sync now** in the dashboard, or wait for the next sync (`SYNC_INTERVAL_SECONDS=300`).
- **Claims.** Each payout takes 40 to 200 s over the Nym mixnet, and the next one waits for the change to reach 3 confirmations.
- **No bank cash-out.** With `DEMO_MODE=false`, recipients keep the payout or send it to their own Zcash wallet. Real bank or mobile-money cash-out needs a licensed partner and is not built.
- **Mainnet is out of scope.** Don't switch `ZCASH_NETWORK` to `mainnet` until these are done (docs/ROADMAP.md):
  - a security review;
  - a way to settle a payout stuck in `claiming`;
  - a plan for the single custodial key.
