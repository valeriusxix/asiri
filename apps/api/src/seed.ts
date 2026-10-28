// npm run seed:demo             (mock mode only; refuses to touch a database that already has data)
// npm run seed:demo -- --reset  (wipes the demo database first)
// node apps/api/dist/seed.js --if-empty  (seeds only an empty database, otherwise exits 0: the Render start script)
// Creates six weeks of mock donations, ~12 claimed payouts, 2 active links, 1 expired link and one
// published report, so the transparency page looks alive (Agent.md M5). Never prints links or PINs.

import { openDb } from "./db/db.js";
import { loadDotenvFile, parseEnv } from "./env.js";
import { createLogger } from "./lib/logger.js";
import { formatMoney, toMinor } from "./lib/currency.js";
import { clearData, hasData, seedDemo } from "./services/demoSeed.js";
import { fixedRates, PriceService } from "./services/price.js";
import { createReportWriter } from "./services/reportWriter.js";

loadDotenvFile();
const env = parseEnv(process.env);
if (env.ZCASH_MODE !== "mock") {
  console.error("seed:demo only runs with ZCASH_MODE=mock (it writes fake chain history).");
  process.exit(1);
}

const db = openDb(env.DATABASE_PATH);
if (hasData(db) && process.argv.includes("--if-empty")) {
  console.log("The database already has data, so the demo seed was skipped.");
  db.close();
  process.exit(0);
}
if (hasData(db)) {
  if (!process.argv.includes("--reset")) {
    console.error(`The database at ${env.DATABASE_PATH} already has data. Run: npm run seed:demo -- --reset`);
    process.exit(1);
  }
  clearData(db);
  console.log("Cleared the existing demo database.");
}

async function main(): Promise<void> {
  const logger = createLogger("warn");
  // Seed at the rates the app will display (live CoinGecko, or the fixed fallback), so the totals add up.
  const quote = await new PriceService({ source: env.PRICE_SOURCE, fixed: fixedRates(env), apiKey: env.COINGECKO_API_KEY }).get();
  const r = await seedDemo({ db, env, logger, writer: createReportWriter(env, logger), rates: quote.rates });
  const c = env.FUND_CURRENCY;
  console.log(
    `Seeded at 1 ZEC = ${formatMoney(toMinor(quote.rates[c], c) ?? Math.round(quote.rates[c] * 100), c)} (${quote.sources[c]}): ${r.zcashDonations} Zcash donations, ` +
      `${r.simulatedDonations} simulated donations, ${r.claimed} claimed payouts, ${r.active} active, ${r.expired} expired, ` +
      `1 published report (${r.reportGenerator}).`,
  );
  console.log("Open /transparency to see it. Create a new payout in /admin to try the claim flow.");
}

main()
  .catch((err: unknown) => {
    console.error("seed failed:", (err as Error).message);
    process.exitCode = 1;
  })
  .finally(() => db.close());
