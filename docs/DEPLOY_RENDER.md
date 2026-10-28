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

## Set the fallback prices

The app asks CoinGecko for the ZEC rate. If CoinGecko can't be reached, or rate-limits Render's servers, it falls back to `FIXED_ZEC_NGN`, `FIXED_ZEC_USD`, `FIXED_ZEC_GBP` and `FIXED_ZEC_CAD`. Their defaults are **placeholders, not market prices** (1,000,000 and 1,000).

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
- **Testnet or mainnet treasury (`ZCASH_MODE=zingo`):** this Blueprint doesn't set it up. It needs the zingo-cli binary, so it means:
  - a `runtime: docker` service built from `docker/Dockerfile` (the full image compiles zingo-cli in Rust, which is slow);
  - a paid plan with a disk at `/app/data`, the Dockerfile's data directory, for the treasury wallet;
  - `LIGHTWALLETD_URL` set, and `SEED_DEMO_DATA` left off.

  The Dockerfile has not been built on Render.
