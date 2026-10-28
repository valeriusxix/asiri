import { describe, expect, it } from "vitest";
import { openDb } from "../db/db.js";
import { parseEnv } from "../env.js";
import { createLogger } from "../lib/logger.js";
import { clearData, hasData, niceAmount, roundDonationZat, SEED_DONATIONS_USD, seedDemo } from "../services/demoSeed.js";
import { getTransparency } from "../services/transparency.js";
import { fixedRates, PriceService } from "../services/price.js";
import { MockAdapter } from "../zcash/mock.js";
import { TEST_ENV } from "./helpers.js";

describe("seed:demo", () => {
  it("builds the M5 demo history: donations over 6 weeks, ~12 claimed, 2 active, 1 expired, 1 published report", async () => {
    const db = openDb(":memory:");
    const env = parseEnv(TEST_ENV);
    const end = new Date("2026-10-25T12:00:00.000Z").getTime();
    const r = await seedDemo({ db, env, logger: createLogger("silent"), end });
    expect(r).toEqual({ zcashDonations: 14, simulatedDonations: 4, claimed: 12, active: 2, expired: 1, reportGenerator: "template" });

    const statuses = db.prepare(`SELECT status, COUNT(*) n FROM payouts GROUP BY status ORDER BY status`).all();
    expect(statuses).toEqual([
      { status: "active", n: 2 },
      { status: "claimed", n: 12 },
      { status: "expired", n: 1 },
    ]);
    const categories = db.prepare(`SELECT COUNT(DISTINCT category) n FROM payouts WHERE status='claimed'`).get();
    expect(categories).toEqual({ n: 5 });

    const t = await getTransparency({
      db,
      env,
      adapter: new MockAdapter(db, "testnet", { syncDelayMs: 0 }),
      logger: createLogger("silent"),
      now: () => new Date(end),
      price: new PriceService({ source: "fixed", fixed: fixedRates(env) }),
    });
    expect(t.totals.payoutsCount).toBe(12);
    // Donations are written in dollar terms: at the test rate of $40 per ZEC they come to about SEED_DONATIONS_USD / 40 ZEC.
    expect(Math.abs(t.totals.receivedZat / 1e8 - SEED_DONATIONS_USD / 40)).toBeLessThan((SEED_DONATIONS_USD / 40) * 0.01);
    expect(t.fundCurrency).toBe("NGN");
    expect(t.latestReport).not.toBeNull();
    expect(t.weekly.filter((w) => w.receivedZat > 0).length).toBeGreaterThanOrEqual(6);
    expect(t.weekly.filter((w) => w.paidOutZat > 0).length).toBeGreaterThanOrEqual(5);
    // No recipient address is stored anywhere.
    expect(JSON.stringify(db.prepare(`SELECT * FROM mock_ledger`).all())).not.toMatch(/utest1[0-9a-f]{20}/);

    expect(hasData(db)).toBe(true);
    clearData(db);
    expect(hasData(db)).toBe(false);
  });

  it("adds up at live-like rates too, with payouts in all four currencies at natural amounts", async () => {
    const db = openDb(":memory:");
    const env = parseEnv({ ...TEST_ENV, FUND_CURRENCY: "USD" });
    const end = new Date("2026-10-25T12:00:00.000Z").getTime();
    // Test numbers in a realistic range, not market prices.
    const rates = { NGN: 1_616_408, USD: 1_199.07, GBP: 905.5, CAD: 1_660.2 };
    const r = await seedDemo({ db, env, logger: createLogger("silent"), end, rates });
    expect(r).toMatchObject({ zcashDonations: 14, simulatedDonations: 4, claimed: 12, active: 2, expired: 1 });
    const { received } = db.prepare(`SELECT SUM(amount_zat) received FROM donations WHERE source='zcash'`).get() as { received: number };
    expect(Math.abs((received / 1e8) * rates.USD - SEED_DONATIONS_USD)).toBeLessThan(SEED_DONATIONS_USD * 0.01);

    const payouts = db.prepare(`SELECT currency, amount_fiat_minor m, rate_zec_fiat r FROM payouts`).all() as { currency: keyof typeof rates; m: number; r: number }[];
    expect(new Set(payouts.map((p) => p.currency))).toEqual(new Set(["NGN", "USD", "GBP", "CAD"]));
    for (const p of payouts) {
      expect(p.r).toBe(rates[p.currency]);
      expect(p.m % 100).toBe(0); // whole units: £72, ₦28,000, CA$14
    }
  });

  it("rounds payout amounts to two significant figures", () => {
    expect(niceAmount(72.4)).toBe(72);
    expect(niceAmount(28_469)).toBe(28_000);
    expect(niceAmount(13.75)).toBe(14);
    expect(niceAmount(7.2)).toBe(7);
  });

  it("rounds donations to 3 significant figures of ZEC", () => {
    expect(roundDonationZat(18_559_825)).toBe(18_600_000); // 0.186 ZEC
    expect(roundDonationZat(225_000_000)).toBe(225_000_000); // 2.25 ZEC
    expect(roundDonationZat(512)).toBe(512);
  });

  it("refuses to run outside mock mode", async () => {
    const env = parseEnv({ ...TEST_ENV, ZCASH_MODE: "zingo", LIGHTWALLETD_URL: "https://example.invalid:443" });
    await expect(seedDemo({ db: openDb(":memory:"), env, logger: createLogger("silent") })).rejects.toThrow(/mock/);
  });
});
