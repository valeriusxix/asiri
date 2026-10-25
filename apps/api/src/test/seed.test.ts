import { describe, expect, it } from "vitest";
import { openDb } from "../db/db.js";
import { parseEnv } from "../env.js";
import { createLogger } from "../lib/logger.js";
import { zatToNgn } from "../lib/money.js";
import { clearData, hasData, roundDonationZat, seedDemo } from "../services/demoSeed.js";
import { getTransparency } from "../services/transparency.js";
import { PriceService } from "../services/price.js";
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
      price: new PriceService({ source: "fixed", fixedZecNgn: 60_000, fixedZecUsd: 40 }),
    });
    expect(t.totals.payoutsCount).toBe(12);
    expect(t.totals.receivedZat).toBe(4_120_000_000); // 41.2 ZEC
    expect(t.latestReport).not.toBeNull();
    expect(t.weekly.filter((w) => w.receivedZat > 0).length).toBeGreaterThanOrEqual(6);
    expect(t.weekly.filter((w) => w.paidOutZat > 0).length).toBeGreaterThanOrEqual(5);
    // No recipient address is stored anywhere.
    expect(JSON.stringify(db.prepare(`SELECT * FROM mock_ledger`).all())).not.toMatch(/utest1[0-9a-f]{20}/);

    expect(hasData(db)).toBe(true);
    clearData(db);
    expect(hasData(db)).toBe(false);
  });

  it("adds up at a live-like rate too: every payout is funded and naira totals match the history", async () => {
    const db = openDb(":memory:");
    const env = parseEnv(TEST_ENV);
    const end = new Date("2026-10-25T12:00:00.000Z").getTime();
    const rate = { zecNgn: 1_616_408, zecUsd: 1199.07 };
    const r = await seedDemo({ db, env, logger: createLogger("silent"), end, rate });
    expect(r).toMatchObject({ zcashDonations: 14, simulatedDonations: 4, claimed: 12, active: 2, expired: 1 });
    const { received } = db.prepare(`SELECT SUM(amount_zat) received FROM donations WHERE source='zcash'`).get() as { received: number };
    // ₦2,472,000 of donations before rounding each to 3 significant figures of ZEC.
    expect(Math.abs(zatToNgn(received, rate.zecNgn) - 2_472_000)).toBeLessThan(2_472_000 * 0.01);
    const rates = db.prepare(`SELECT DISTINCT rate_zec_ngn r FROM payouts`).all();
    expect(rates).toEqual([{ r: 1_616_408 }]);
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
