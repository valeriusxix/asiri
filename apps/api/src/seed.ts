// npm run seed:demo             (mock mode only; refuses to touch a database that already has data)
// npm run seed:demo -- --reset  (wipes the demo database first)
// Creates six weeks of mock donations, ~12 claimed payouts, 2 active links, 1 expired link and one
// published report, so the transparency page looks alive (Agent.md M5). Never prints links or PINs.

import { openDb } from "./db/db.js";
import { loadDotenvFile, parseEnv } from "./env.js";
import { createLogger } from "./lib/logger.js";
import { formatNgn } from "./lib/money.js";
import { clearData, hasData, seedDemo } from "./services/demoSeed.js";
import { PriceService } from "./services/price.js";
import { createReportWriter } from "./services/reportWriter.js";

loadDotenvFile();
const env = parseEnv(process.env);
if (env.ZCASH_MODE !== "mock") {
  console.error("seed:demo only runs with ZCASH_MODE=mock (it writes fake chain history).");
  process.exit(1);
}

const db = openDb(env.DATABASE_PATH);
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
  // Seed at the rate the app will display (live CoinGecko, or the fixed fallback), so naira totals add up.
  const rate = await new PriceService({ source: env.PRICE_SOURCE, fixedZecNgn: env.FIXED_ZEC_NGN, fixedZecUsd: env.FIXED_ZEC_USD }).get();
  const r = await seedDemo({ db, env, logger, writer: createReportWriter(env, logger), rate });
  console.log(
    `Seeded at ${formatNgn(rate.zecNgn)} per ZEC (${rate.source}): ${r.zcashDonations} Zcash donations, ` +
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
