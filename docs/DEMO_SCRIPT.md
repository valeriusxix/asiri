# Asiri demo script (3 minutes)

This runs in mock mode (`ZCASH_MODE=mock`), which needs no blockchain, no faucet and no API key. Every click below works offline except the live price, which falls back to the fixed rate in `.env`.

## Before the demo (10 minutes, once)

1. **Find the laptop's LAN IP** so the phone can open claim links. On Windows run `ipconfig` and read the "IPv4 Address" of the Wi-Fi adapter. On macOS or Linux run `ipconfig getifaddr en0` or `hostname -I`. The examples below use `192.168.1.20`.
2. **Edit `.env`** (copied from `.env.example`):
   ```ini
   PUBLIC_WEB_URL=http://192.168.1.20:8787   # claim links must open on the phone
   DEMO_MODE=true
   PRICE_SOURCE=fixed                        # optional: numbers will not move during the pitch
   FIXED_ZEC_NGN=1600000                     # set to today's rate if you use fixed
   ANTHROPIC_API_KEY=sk-ant-...              # optional: AI-written update; without it the template is used
   ADMIN_PASSWORD=<a password only you know> # required: the default is printed in the README
   SESSION_SECRET=<64 random hex chars>      # required: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
   **Change `ADMIN_PASSWORD` and `SESSION_SECRET` before every demo.** The laptop can be reached by everyone on the venue Wi-Fi, and the defaults are public. With them, anyone there could log in as the organizer mid-pitch, or forge the session cookie, then cancel your payout or create their own. The server prints a warning at startup while either default is still in use.
   Keep `NODE_ENV=development`. Production mode sets secure cookies, which need HTTPS.
3. **Build, seed and start on one port:**
   ```bash
   npm run build
   npm run seed:demo -- --reset   # six weeks of history, 12 claimed payouts, 1 published update
   npm start                      # web + API on http://localhost:8787
   ```
   The first time, Windows asks whether Node.js may use the network. Allow it on **private** networks, or the phone cannot connect.
4. **Check the phone:** put it on the same Wi-Fi, open `http://192.168.1.20:8787/transparency` and confirm the page loads. Make sure the phone has WhatsApp, or plan to use the SMS button.
5. **Open these tabs on the laptop:**
   - `http://localhost:8787/donate`
   - `http://localhost:8787/admin` (log in with `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `.env`)
   - `http://localhost:8787/transparency`
6. **Optional:** in the admin, go to **Reports → Last 30 days → Generate draft**, then **Publish**, so the update on the transparency page is labelled **AI written** (this needs `ANTHROPIC_API_KEY`).

## The 3 minutes

### 1. Story (20 s), on the home page
> "In 2020, during #EndSARS, a Nigerian relief group's bank accounts were frozen. They moved to Bitcoin, which fixed the freezing, but made every donor and recipient traceable. Asiri fixes both."

### 2. Donate (25 s), on the `/donate` tab
- Show the QR and the "Your donation is private. Only the total is published." line.
- > "Donors send shielded Zcash. In this demo the treasury is already funded."
- In mock mode the QR holds a pretend address, so a real wallet can't pay it. You can also show the **Card or bank (demo)** tab: enter ₦20,000 and click **Donate (demo)**. Demo donations are listed separately and never count as money raised.

### 3. Pay someone (40 s), on the `/admin` tab
- Point at **Available for new payouts**.
- Click **New payout**, then enter **Amount ₦50,000**, **Category: Medical** and **Create payout**.
- Show the result: the claim link, and the PIN with the line "Send this PIN separately… Never in the same message as the link."
- Tap **Send link via WhatsApp** and send it to the phone. Then tap **Text the PIN (separate SMS)**, or read the PIN out loud.
- > "The link and the PIN travel separately. The PIN is shown once, and we only store its hash."

### 4. Claim (40 s), on the phone
- Open the WhatsApp message and tap the link. It shows "You've received support from Lagos Community Relief Fund".
- Enter the 6-digit PIN and tap **Continue**. It shows **₦50,000 is yours**.
- Tap **Cash out to my bank**, choose a bank, enter any 10 digits and tap **Send to my bank**. It shows **Done. Take care.**
- > "No app, no seed phrase, no jargon. The recipient never sees the words wallet or crypto. We don't keep their bank details."
- Optionally, open **Advanced: send to a Zcash wallet** to show that people who already have a Zcash wallet can paste an address instead.
- Open the same link again. It now says "This support has already been received", so a forwarded link is useless once claimed.

### 5. Accountability (35 s), on the `/transparency` tab (refresh it)
- **Paid out** and **People helped** have gone up, and this week's bar has grown. **Payments by need** shows Medical.
- Scroll to **Verify it yourself**, which shows the fund's viewing key (UFVK). In mock mode the page labels it **Demo**, because the mock treasury's key is a placeholder that no wallet will import. Don't invite anyone to import it.
- > "With the real treasury on Zcash, anyone can load the fund's viewing key and check these totals against the payments themselves. Here it's a mock treasury, so the key is a placeholder, as the page says. Either way, nobody can see who received money."
- Read two lines of **Latest update**, the plain-language report written from totals only.
- > "Donors see that money moved. Nobody sees who received it."

### 6. Close (20 s)
> "Accountability without a hit list. Built on Zcash because only shielded money with viewing keys can do both."

## Backup plans

| Problem | What to do |
|---|---|
| Phone can't reach the laptop (Wi-Fi isolation, firewall) | In the admin result, click **Open claim page** and narrow the browser window, or use DevTools device mode. Use the PIN shown on screen. The flow is identical. |
| WhatsApp is slow or not installed | Use **Send link via SMS**, or **Copy** the link and open it on the phone some other way. |
| Not enough to pay out | In the admin, click **Add 0.5 ZEC** under **Mock treasury (demo)**. |
| You need fresh data | Stop the server, run `npm run seed:demo -- --reset`, then `npm start`. |
| No internet at all | Set `PRICE_SOURCE=fixed`. Without `ANTHROPIC_API_KEY`, everything else, including the report template, works offline. |
| A link was used by mistake | In the admin, **Cancel** it (if still active) and create another payout. A locked link has an **Unlock** button. |

## Testnet proof (show it, don't run it live)

The real-Zcash path (`ZCASH_MODE=zingo`) works end to end on the Zcash testnet. On 2026-10-26 a ₦5,000 Medical payout was claimed to a second testnet wallet: txid `e50c15de6c0d0838a68115af8e97098543b477012b3c7e2f4134d63ff798648f`, block 4,545,316 (details in `docs/ZINGO_NOTES.md`).

A live testnet send takes 40 to 200 s over the Nym mixnet and sometimes stalls, so the 3-minute pitch uses the mock treasury. To show that it's real:
- After step 5, run this in a terminal (about 2 s, and it needs internet):
  `node scripts/verify-testnet-tx.mjs e50c15de6c0d0838a68115af8e97098543b477012b3c7e2f4134d63ff798648f`
  It prints the block (4,545,316), its hash and "in block list yes".
- > "Same interface, same claim page. On testnet this exact flow sent shielded ZEC to a second wallet. Here is the transaction in the chain. Nobody can see who received it or how much."
- Don't use the testnet.zcashexplorer.app link. On 2026-10-27 it did not list this transaction ("may not exist or may not yet be indexed"), probably because it has not followed the NU7 chain.

If you want to run testnet live anyway (allow 5 extra minutes):
1. Use the `ZCASH_MODE=zingo` settings in the README and `SYNC_INTERVAL_SECONDS=300`.
2. Click **Sync now** at least 10 minutes before you present.
3. Keep the payout small (₦5,000).
4. Start the claim on the phone before you talk through the transparency page, so the send finishes in the background.
