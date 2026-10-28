import Database from "better-sqlite3";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { applyMigrations, BASE_SCHEMA } from "../db/db.js";
import { createPayout, setup, TESTNET_ADDRESS } from "./helpers.js";

const ONE_ZEC = 100_000_000;

async function unlock(h: ReturnType<typeof setup>, p: { id: string; secret: string; pin: string }) {
  return request(h.app).post(`/api/claims/${p.id}/unlock`).send({ secret: p.secret, pin: p.pin });
}

describe("migration to multi-currency payouts", () => {
  /** A database as it was before the migration: the base schema only, with one naira payout in it. */
  function legacyDb() {
    const db = new Database(":memory:");
    db.exec(BASE_SCHEMA);
    db.prepare(
      `INSERT INTO payouts (id, amount_zat, fee_buffer_zat, amount_ngn_at_creation, rate_zec_ngn, category, status, secret_hash,
                            pin_hash, pin_attempts, created_at, expires_at)
       VALUES ('LegacyNGN1', 83333333, 20000, 50000, 60000, 'medical', 'active', 'h', 'scrypt$00$00', 0,
               '2026-10-01T00:00:00.000Z', '2026-10-15T00:00:00.000Z')`,
    ).run();
    return db;
  }

  it("backfills an existing NGN payout from the legacy columns, keeping them", () => {
    const db = legacyDb();
    applyMigrations(db);
    expect(db.prepare(`SELECT * FROM payouts WHERE id = 'LegacyNGN1'`).get()).toMatchObject({
      currency: "NGN",
      amount_fiat_minor: 5_000_000,
      rate_zec_fiat: 60_000,
      amount_ngn_at_creation: 50_000,
      rate_zec_ngn: 60_000,
      amount_zat: 83_333_333,
    });
  });

  it("is idempotent: running it again changes nothing and raises nothing", () => {
    const db = legacyDb();
    applyMigrations(db);
    const once = db.prepare(`SELECT * FROM payouts`).all();
    const columns = db.prepare(`PRAGMA table_info(payouts)`).all();
    expect(() => applyMigrations(db)).not.toThrow();
    expect(db.prepare(`SELECT * FROM payouts`).all()).toEqual(once);
    expect(db.prepare(`PRAGMA table_info(payouts)`).all()).toEqual(columns);
  });

  it("only allows the four supported currency codes", () => {
    const db = legacyDb();
    applyMigrations(db);
    expect(() => db.prepare(`UPDATE payouts SET currency = 'EUR' WHERE id = 'LegacyNGN1'`).run()).toThrow(/CHECK/);
  });
});

describe("payouts in any supported currency", () => {
  it("defaults to FUND_CURRENCY and enforces each currency's limits", async () => {
    const h = setup({ FUND_CURRENCY: "USD" });
    await h.fund(10 * ONE_ZEC);
    const agent = await h.admin();
    const create = (body: Record<string, unknown>) => agent.post("/api/admin/payouts").send({ category: "food", ...body });

    const dflt = await create({ amount: 25 });
    expect(dflt.status).toBe(201);
    expect(dflt.body.payout).toMatchObject({ currency: "USD", amountFiatMinor: 2_500, amountDisplay: "$25.00", amountZat: 62_500_000 }); // $25 at $40/ZEC

    for (const [body, message] of [
      [{ amount: 0.99 }, "Amount must be between $1.00 and $5,000.00"],
      [{ amount: 5_000.01, currency: "GBP" }, "Amount must be between £1.00 and £5,000.00"],
      [{ amount: 499, currency: "NGN" }, "Amount must be between ₦500 and ₦5,000,000"],
      [{ amount: 12.345, currency: "CAD" }, "Use at most 2 decimal places"],
    ] as const) {
      const res = await create(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.details.fieldErrors.amount).toEqual([message]);
    }
    expect((await create({ amount: 10, currency: "EUR" })).status).toBe(400);
    expect((await create({ amount: 19.99, currency: "CAD" })).body.payout).toMatchObject({ amountFiatMinor: 1_999, amountDisplay: "CA$19.99" });
  });

  it("puts the payout's formatted amount in the share message, never the PIN", async () => {
    const h = setup();
    await h.fund(10 * ONE_ZEC);
    const p = await createPayout(h, { amount: 120.5, currency: "GBP", category: "legal" });
    const text = decodeURIComponent(p.body.whatsappUrl.replace("https://wa.me/?text=", ""));
    expect(text).toContain("you have received £120.50 in support from Test Relief Fund");
    expect(text).not.toContain(p.pin);
    expect(decodeURIComponent(p.body.smsUrl.replace("sms:?body=", ""))).toBe(text);
  });

  it.each([
    ["USD", 40, "$40.00", 100_000_000], // $40 at $40 per ZEC
    ["GBP", 16, "£16.00", 50_000_000], // £16 at £32 per ZEC
  ] as const)("full claim flow with a %s payout: open, unlock, redeem, transparency", async (currency, amount, display, zat) => {
    const h = setup({ FUND_CURRENCY: "USD" });
    await h.fund(5 * ONE_ZEC);
    const p = await createPayout(h, { amount, currency, category: "medical" });
    expect(p.body.payout).toMatchObject({ currency, amountDisplay: display, amountZat: zat });

    expect((await request(h.app).post(`/api/claims/${p.id}/open`).send({ secret: p.secret })).body).toEqual({ status: "available", fundName: "Test Relief Fund" });
    const unlocked = await unlock(h, p);
    expect(unlocked.body).toMatchObject({ currency, amountDisplay: display, amountZat: zat });
    expect(JSON.stringify(unlocked.body)).not.toContain("Ngn");

    const redeemed = await request(h.app)
      .post(`/api/claims/${p.id}/redeem`)
      .send({ claimToken: unlocked.body.claimToken, method: "zcash_address", zcashAddress: TESTNET_ADDRESS });
    expect(redeemed.status).toBe(200);
    expect(redeemed.body).toMatchObject({ status: "claimed", method: "zcash_address", demo: false });

    const t = (await request(h.app).get("/api/transparency")).body;
    expect(t).toMatchObject({ fundCurrency: "USD", totals: { paidOutZat: zat, payoutsCount: 1 } });
  });
});

describe("demo cash-out details, by payout currency", () => {
  const formats = {
    NGN: { good: { accountNumber: "0123456789" }, bad: { accountNumber: "12345678" }, fields: ["accountNumber"] },
    USD: { good: { routingNumber: "021000021", accountNumber: "123456789012" }, bad: { routingNumber: "02100002", accountNumber: "123" }, fields: ["routingNumber", "accountNumber"] },
    GBP: { good: { sortCode: "20-00-00", accountNumber: "12345678" }, bad: { sortCode: "2000", accountNumber: "1234567" }, fields: ["sortCode", "accountNumber"] },
    CAD: {
      good: { institutionNumber: "001", transitNumber: "00011", accountNumber: "1234567" },
      bad: { institutionNumber: "1", transitNumber: "0001", accountNumber: "123456" },
      fields: ["institutionNumber", "transitNumber", "accountNumber"],
    },
  } as const;
  const amounts = { NGN: 50_000, USD: 20, GBP: 15, CAD: 25 } as const;

  it.each(Object.keys(formats) as (keyof typeof formats)[])("%s: checks the format, then discards the details", async (currency) => {
    const h = setup();
    await h.fund(10 * ONE_ZEC);
    const p = await createPayout(h, { amount: amounts[currency], currency, category: "food" });
    const { claimToken } = (await unlock(h, p)).body;
    const redeem = (details: Record<string, string>) =>
      request(h.app).post(`/api/claims/${p.id}/redeem`).send({ claimToken, method: "cashout_demo", bankName: "First Community Bank", accountNumber: "", ...details });

    const bad = await redeem(formats[currency].bad);
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.details.fieldErrors).sort()).toEqual([...formats[currency].fields].sort());
    expect(JSON.stringify(bad.body)).not.toMatch(/\d{4,}/); // field messages never echo the values
    expect(h.db.prepare(`SELECT status FROM payouts WHERE id = ?`).get(p.id)).toEqual({ status: "active" });

    const good = await redeem(formats[currency].good);
    expect(good.status).toBe(200);
    expect(good.body).toEqual({ status: "claimed", method: "cashout_demo", demo: true });

    const everything = JSON.stringify([h.db.prepare(`SELECT * FROM payouts`).all(), h.db.prepare(`SELECT * FROM audit_events`).all()]);
    for (const v of Object.values(formats[currency].good)) expect(everything).not.toContain(v);
    expect(everything).not.toContain("First Community Bank");
  });

  it("asks a request without the claim token nothing about the format, so the currency stays hidden", async () => {
    const h = setup();
    await h.fund(10 * ONE_ZEC);
    const p = await createPayout(h, { amount: 15, currency: "GBP", category: "food" });
    const res = await request(h.app)
      .post(`/api/claims/${p.id}/redeem`)
      .send({ claimToken: "g".repeat(43), method: "cashout_demo", bankName: "Any Bank", accountNumber: "1" });
    expect([res.status, res.body]).toEqual([401, { error: "claim_session_expired" }]);
  });
});
