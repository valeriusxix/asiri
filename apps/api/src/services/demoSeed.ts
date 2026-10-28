// Six weeks of believable mock history, built through the real services with a moving clock.
// Used by `npm run seed:demo` (src/seed.ts) and covered by src/test/seed.test.ts.

import { randomBytes, randomUUID } from "node:crypto";
import { audit, type DB } from "../db/db.js";
import type { Env } from "../env.js";
import type { Logger } from "../lib/logger.js";
import { CURRENCIES, fiatMinorToZat, toMinor, type CurrencyCode } from "../lib/currency.js";
import { guardAdapter } from "../zcash/adapter.js";
import { mockReceive, MockAdapter } from "../zcash/mock.js";
import type { AppContext } from "./context.js";
import { importFromWallet } from "./donations.js";
import { createPayout, expireDue, redeemClaim, unlockClaim, type Category } from "./payouts.js";
import { fixedRates, PriceService } from "./price.js";
import { generateReport, publishReport, templateWriter, type ReportWriter } from "./reports.js";

const DAY = 24 * 60 * 60 * 1000;

/** Round to 3 significant figures, so donations look like amounts people send (0.186 ZEC, 2.25 ZEC). */
export function roundDonationZat(zat: number): number {
  const step = 10 ** Math.max(0, Math.floor(Math.log10(zat)) - 2);
  return Math.round(zat / step) * step;
}

export const SEED_TABLES = ["donations", "payouts", "reports", "audit_events", "mock_ledger"] as const;

type Event =
  | { day: number; kind: "donation"; usd: number; memo?: string }
  | { day: number; kind: "simulated"; usd: number }
  | { day: number; kind: "payout"; usd: number; currency: CurrencyCode; category: Category; claimAfterDays: number; method: "zcash_address" | "cashout_demo" }
  | { day: number; kind: "expiring"; usd: number; currency: CurrencyCode; category: Category }
  | { day: number; kind: "active"; usd: number; currency: CurrencyCode; category: Category };

/**
 * `day` is days before "now". Every amount is written once in US-dollar terms and converted at the seeding rates, so
 * the history adds up whatever ZEC trades at. Payouts mix all four supported currencies, each rounded to an amount that
 * reads naturally in its own currency; the pages show the totals in FUND_CURRENCY. Payouts only happen once enough has
 * been donated.
 */
const EVENTS: Event[] = [
  { day: 42, kind: "donation", usd: 225, memo: "With love, from far away" },
  { day: 40, kind: "donation", usd: 112 },
  { day: 39, kind: "payout", usd: 38, currency: "USD", category: "medical", claimAfterDays: 0.3, method: "cashout_demo" },
  { day: 37, kind: "donation", usd: 54 },
  { day: 36, kind: "payout", usd: 90, currency: "GBP", category: "legal", claimAfterDays: 1.2, method: "zcash_address" },
  { day: 35, kind: "donation", usd: 360, memo: "In memory of my mother" },
  { day: 33, kind: "payout", usd: 19, currency: "NGN", category: "food", claimAfterDays: 0.1, method: "cashout_demo" },
  { day: 31, kind: "donation", usd: 34 },
  { day: 30, kind: "simulated", usd: 19 },
  { day: 30, kind: "payout", usd: 11, currency: "CAD", category: "transport", claimAfterDays: 0.5, method: "zcash_address" },
  { day: 28, kind: "donation", usd: 135 },
  { day: 27, kind: "payout", usd: 60, currency: "USD", category: "shelter", claimAfterDays: 2, method: "cashout_demo" },
  { day: 26, kind: "donation", usd: 68 },
  { day: 25, kind: "expiring", usd: 30, currency: "USD", category: "food" },
  { day: 24, kind: "payout", usd: 49, currency: "GBP", category: "medical", claimAfterDays: 0.4, method: "zcash_address" },
  { day: 23, kind: "donation", usd: 270, memo: "Keep going" },
  { day: 21, kind: "payout", usd: 22, currency: "CAD", category: "food", claimAfterDays: 0.2, method: "zcash_address" },
  { day: 20, kind: "simulated", usd: 8 },
  { day: 19, kind: "donation", usd: 90 },
  { day: 18, kind: "payout", usd: 112, currency: "USD", category: "legal", claimAfterDays: 1.5, method: "zcash_address" },
  { day: 16, kind: "donation", usd: 22 },
  { day: 14, kind: "payout", usd: 34, currency: "NGN", category: "medical", claimAfterDays: 0.6, method: "cashout_demo" },
  { day: 12, kind: "donation", usd: 180 },
  { day: 11, kind: "simulated", usd: 38 },
  { day: 10, kind: "payout", usd: 52, currency: "CAD", category: "shelter", claimAfterDays: 0.8, method: "zcash_address" },
  { day: 9, kind: "donation", usd: 45 },
  { day: 7, kind: "payout", usd: 15, currency: "GBP", category: "food", claimAfterDays: 0.3, method: "cashout_demo" },
  { day: 5, kind: "donation", usd: 100 },
  { day: 4, kind: "payout", usd: 14, currency: "USD", category: "transport", claimAfterDays: 0.5, method: "zcash_address" },
  { day: 3, kind: "simulated", usd: 11 },
  { day: 2, kind: "donation", usd: 158 },
  { day: 1, kind: "active", usd: 26, currency: "GBP", category: "medical" },
  { day: 0.2, kind: "active", usd: 45, currency: "CAD", category: "shelter" },
];

/** The total seeded donations in US-dollar terms (used by the seed test). */
export const SEED_DONATIONS_USD = EVENTS.reduce((sum, e) => sum + (e.kind === "donation" ? e.usd : 0), 0);

/** Two significant figures, so payouts read like amounts people choose: 72, 28,000, 14. */
export function niceAmount(major: number): number {
  const step = 10 ** Math.max(0, Math.floor(Math.log10(major)) - 1);
  return Math.round(major / step) * step;
}


export interface SeedResult {
  zcashDonations: number;
  simulatedDonations: number;
  claimed: number;
  active: number;
  expired: number;
  reportGenerator: "claude" | "template";
}

export function hasData(db: DB): boolean {
  return SEED_TABLES.some((t) => (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n > 0);
}

export function clearData(db: DB): void {
  db.transaction(() => SEED_TABLES.forEach((t) => db.prepare(`DELETE FROM ${t}`).run()))();
}

export interface SeedOptions {
  db: DB;
  env: Env;
  logger: Logger;
  end?: number;
  writer?: ReportWriter;
  /** ZEC rates for the whole history. Default to the fixed env rates; the CLI passes the live quote. */
  rates?: Record<CurrencyCode, number>;
}

export async function seedDemo(opts: SeedOptions): Promise<SeedResult> {
  const { db, env, logger } = opts;
  if (env.ZCASH_MODE !== "mock") throw new Error("seedDemo only runs with ZCASH_MODE=mock (it writes fake chain history).");
  const end = opts.end ?? Date.now();
  let t = end - 42 * DAY;
  const now = () => new Date(t);
  const ctx: AppContext = {
    db,
    adapter: guardAdapter(new MockAdapter(db, env.ZCASH_NETWORK, { syncDelayMs: 0, now })),
    env,
    logger,
    now,
    // One rate for the whole history, so the clock can move without refetching prices.
    price: new PriceService({ source: "fixed", fixed: opts.rates ?? fixedRates(env), now }),
  };
  const { rates } = await ctx.price.get();
  const zatOf = (usd: number) => roundDonationZat(fiatMinorToZat(usd * 100, rates.USD, "USD"));
  // A payout written in dollar terms, as a natural amount in its own currency, at least that currency's minimum.
  const fiat = (e: { usd: number; currency: CurrencyCode }) => {
    const major = Math.max(CURRENCIES[e.currency].payout.min, niceAmount((e.usd * rates[e.currency]) / rates.USD));
    return { amountMinor: toMinor(major, e.currency)!, currency: e.currency };
  };
  const fakeRecipient = () => `${env.ZCASH_NETWORK === "testnet" ? "utest1" : "u1"}${randomBytes(40).toString("hex")}`;
  const result: SeedResult = { zcashDonations: 0, simulatedDonations: 0, claimed: 0, active: 0, expired: 0, reportGenerator: "template" };

  for (const e of EVENTS) {
    t = end - e.day * DAY;
    switch (e.kind) {
      case "donation":
        mockReceive(db, zatOf(e.usd), { memo: e.memo, at: now() });
        break;
      case "simulated": {
        const id = randomUUID();
        const amountZat = zatOf(e.usd);
        db.prepare(`INSERT INTO donations (id, source, txid, amount_zat, memo, observed_at) VALUES (?, 'simulated', NULL, ?, NULL, ?)`).run(
          id,
          amountZat,
          now().toISOString(),
        );
        audit(db, "donation.simulated", { id, amountZat }, now());
        result.simulatedDonations++;
        break;
      }
      case "payout": {
        const created = await createPayout(ctx, { ...fiat(e), category: e.category });
        const secret = new URL(created.link).hash.slice(1);
        t += e.claimAfterDays * DAY;
        const { claimToken } = await unlockClaim(ctx, created.payout.id, secret, created.pin);
        const method = e.method === "cashout_demo" && !env.DEMO_MODE ? "zcash_address" : e.method;
        await redeemClaim(
          ctx,
          created.payout.id,
          method === "zcash_address" ? { claimToken, method, zcashAddress: fakeRecipient() } : { claimToken, method, bankDetailsErrors: () => null },
        );
        result.claimed++;
        break;
      }
      case "expiring":
        await createPayout(ctx, { ...fiat(e), category: e.category, expiresInDays: 3 });
        t += 4 * DAY;
        result.expired += expireDue(ctx);
        break;
      case "active":
        await createPayout(ctx, { ...fiat(e), category: e.category });
        result.active++;
        break;
    }
  }

  t = end;
  result.zcashDonations = await importFromWallet(ctx);
  const report = await generateReport(ctx, 30, opts.writer ?? templateWriter);
  publishReport(ctx, report.id);
  result.reportGenerator = report.generator;
  return result;
}
