// Six weeks of believable mock history, built through the real services with a moving clock.
// Used by `npm run seed:demo` (src/seed.ts) and covered by src/test/seed.test.ts.

import { randomBytes, randomUUID } from "node:crypto";
import { audit, type DB } from "../db/db.js";
import type { Env } from "../env.js";
import type { Logger } from "../lib/logger.js";
import { ngnToZat } from "../lib/money.js";
import { guardAdapter } from "../zcash/adapter.js";
import { mockReceive, MockAdapter } from "../zcash/mock.js";
import type { AppContext } from "./context.js";
import { importFromWallet } from "./donations.js";
import { createPayout, expireDue, redeemClaim, unlockClaim, type Category } from "./payouts.js";
import { PriceService } from "./price.js";
import { generateReport, publishReport, templateWriter, type ReportWriter } from "./reports.js";

const DAY = 24 * 60 * 60 * 1000;

/** Round to 3 significant figures, so donations look like amounts people send (0.186 ZEC, 2.25 ZEC). */
export function roundDonationZat(zat: number): number {
  const step = 10 ** Math.max(0, Math.floor(Math.log10(zat)) - 2);
  return Math.round(zat / step) * step;
}

export const SEED_TABLES = ["donations", "payouts", "reports", "audit_events", "mock_ledger"] as const;

type Event =
  | { day: number; kind: "donation"; ngn: number; memo?: string }
  | { day: number; kind: "simulated"; ngn: number }
  | { day: number; kind: "payout"; ngn: number; category: Category; claimAfterDays: number; method: "zcash_address" | "cashout_demo" }
  | { day: number; kind: "expiring"; ngn: number; category: Category }
  | { day: number; kind: "active"; ngn: number; category: Category };

/**
 * `day` is days before "now". Payouts only happen once enough has been donated. Donations are written in
 * naira and converted at the seeding rate, so the page reads the same whatever ZEC trades at.
 */
const EVENTS: Event[] = [
  { day: 42, kind: "donation", ngn: 300_000, memo: "From the diaspora, with love" },
  { day: 40, kind: "donation", ngn: 150_000 },
  { day: 39, kind: "payout", ngn: 50_000, category: "medical", claimAfterDays: 0.3, method: "cashout_demo" },
  { day: 37, kind: "donation", ngn: 72_000 },
  { day: 36, kind: "payout", ngn: 120_000, category: "legal", claimAfterDays: 1.2, method: "zcash_address" },
  { day: 35, kind: "donation", ngn: 480_000, memo: "In memory of my mother" },
  { day: 33, kind: "payout", ngn: 25_000, category: "food", claimAfterDays: 0.1, method: "cashout_demo" },
  { day: 31, kind: "donation", ngn: 45_000 },
  { day: 30, kind: "simulated", ngn: 25_000 },
  { day: 30, kind: "payout", ngn: 15_000, category: "transport", claimAfterDays: 0.5, method: "zcash_address" },
  { day: 28, kind: "donation", ngn: 180_000 },
  { day: 27, kind: "payout", ngn: 80_000, category: "shelter", claimAfterDays: 2, method: "cashout_demo" },
  { day: 26, kind: "donation", ngn: 90_000 },
  { day: 25, kind: "expiring", ngn: 40_000, category: "food" },
  { day: 24, kind: "payout", ngn: 65_000, category: "medical", claimAfterDays: 0.4, method: "zcash_address" },
  { day: 23, kind: "donation", ngn: 360_000, memo: "Keep going" },
  { day: 21, kind: "payout", ngn: 30_000, category: "food", claimAfterDays: 0.2, method: "zcash_address" },
  { day: 20, kind: "simulated", ngn: 10_000 },
  { day: 19, kind: "donation", ngn: 120_000 },
  { day: 18, kind: "payout", ngn: 150_000, category: "legal", claimAfterDays: 1.5, method: "zcash_address" },
  { day: 16, kind: "donation", ngn: 30_000 },
  { day: 14, kind: "payout", ngn: 45_000, category: "medical", claimAfterDays: 0.6, method: "cashout_demo" },
  { day: 12, kind: "donation", ngn: 240_000 },
  { day: 11, kind: "simulated", ngn: 50_000 },
  { day: 10, kind: "payout", ngn: 70_000, category: "shelter", claimAfterDays: 0.8, method: "zcash_address" },
  { day: 9, kind: "donation", ngn: 60_000 },
  { day: 7, kind: "payout", ngn: 20_000, category: "food", claimAfterDays: 0.3, method: "cashout_demo" },
  { day: 5, kind: "donation", ngn: 135_000 },
  { day: 4, kind: "payout", ngn: 18_000, category: "transport", claimAfterDays: 0.5, method: "zcash_address" },
  { day: 3, kind: "simulated", ngn: 15_000 },
  { day: 2, kind: "donation", ngn: 210_000 },
  { day: 1, kind: "active", ngn: 35_000, category: "medical" },
  { day: 0.2, kind: "active", ngn: 60_000, category: "shelter" },
];

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
  /** Rate for the whole history. Defaults to the fixed env rate; the CLI passes the live quote. */
  rate?: { zecNgn: number; zecUsd: number };
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
    price: new PriceService({
      source: "fixed",
      fixedZecNgn: opts.rate?.zecNgn ?? env.FIXED_ZEC_NGN,
      fixedZecUsd: opts.rate?.zecUsd ?? env.FIXED_ZEC_USD,
      now,
    }),
  };
  const fakeRecipient = () => `${env.ZCASH_NETWORK === "testnet" ? "utest1" : "u1"}${randomBytes(40).toString("hex")}`;
  const { zecNgn } = await ctx.price.get();
  const result: SeedResult = { zcashDonations: 0, simulatedDonations: 0, claimed: 0, active: 0, expired: 0, reportGenerator: "template" };

  for (const e of EVENTS) {
    t = end - e.day * DAY;
    switch (e.kind) {
      case "donation":
        mockReceive(db, roundDonationZat(ngnToZat(e.ngn, zecNgn)), { memo: e.memo, at: now() });
        break;
      case "simulated": {
        const id = randomUUID();
        const amountZat = ngnToZat(e.ngn, zecNgn);
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
        const created = await createPayout(ctx, { amountNgn: e.ngn, category: e.category });
        const secret = new URL(created.link).hash.slice(1);
        t += e.claimAfterDays * DAY;
        const { claimToken } = await unlockClaim(ctx, created.payout.id, secret, created.pin);
        const method = e.method === "cashout_demo" && !env.DEMO_MODE ? "zcash_address" : e.method;
        await redeemClaim(
          ctx,
          created.payout.id,
          method === "zcash_address" ? { claimToken, method, zcashAddress: fakeRecipient() } : { claimToken, method },
        );
        result.claimed++;
        break;
      }
      case "expiring":
        await createPayout(ctx, { amountNgn: e.ngn, category: e.category, expiresInDays: 3 });
        t += 4 * DAY;
        result.expired += expireDue(ctx);
        break;
      case "active":
        await createPayout(ctx, { amountNgn: e.ngn, category: e.category });
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
