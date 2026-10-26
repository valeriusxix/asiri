import request from "supertest";
import { describe, expect, it } from "vitest";
import { ZcashError } from "../zcash/adapter.js";
import { createPayout, parseLink, setup, TESTNET_ADDRESS } from "./helpers.js";

const ONE_ZEC = 100_000_000;
const DAY = 24 * 60 * 60 * 1000;

async function unlock(h: ReturnType<typeof setup>, id: string, secret: string, pin: string) {
  return request(h.app).post(`/api/claims/${id}/unlock`).send({ secret, pin });
}

function wrongPin(pin: string): string {
  return pin === "000000" ? "111111" : "000000";
}

describe("payout creation", () => {
  it("fails with insufficient_funds on an empty treasury, succeeds after mock-donate + sync", async () => {
    const h = setup();
    const agent = await h.admin();
    const empty = await agent.post("/api/admin/payouts").send({ amountNgn: 50_000, category: "medical" });
    expect(empty.status).toBe(409);
    expect(empty.body).toEqual({ error: "insufficient_funds", availableZat: 0 });

    await h.fund(ONE_ZEC);
    const ok = await agent.post("/api/admin/payouts").send({ amountNgn: 50_000, category: "medical" });
    expect(ok.status).toBe(201);
    expect(ok.body.pin).toMatch(/^\d{6}$/);
    expect(ok.body.link).toMatch(/^http:\/\/localhost:5173\/c\/[A-Za-z0-9]{10}#[A-Za-z0-9_-]{43}$/);
    expect(ok.body.payout).toMatchObject({ amountZat: 83_333_333, feeBufferZat: 20_000, amountNgn: 50_000, status: "active" });

    const overview = await agent.get("/api/admin/overview");
    expect(overview.body).toMatchObject({
      spendableZat: ONE_ZEC,
      reservedZat: 83_353_333,
      availableZat: ONE_ZEC - 83_353_333,
      counts: { active: 1, claimed: 0, expired: 0, cancelled: 0, locked: 0 },
    });
  });

  it("refuses a payout that would exceed the available balance (fee buffer included)", async () => {
    const h = setup();
    await h.fund(83_353_332); // one zat short of 50,000 NGN + buffer
    const agent = await h.admin();
    const res = await agent.post("/api/admin/payouts").send({ amountNgn: 50_000, category: "food" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("insufficient_funds");
  });

  it("builds WhatsApp and SMS links without the PIN", async () => {
    const h = setup();
    await h.fund(ONE_ZEC);
    const { body, pin } = await createPayout(h);
    const wa = decodeURIComponent(body.whatsappUrl.replace("https://wa.me/?text=", ""));
    expect(body.whatsappUrl.startsWith("https://wa.me/?text=")).toBe(true);
    expect(body.smsUrl.startsWith("sms:?body=")).toBe(true);
    expect(wa).toContain(body.link);
    expect(wa).toContain("Test Relief Fund");
    expect(wa).not.toContain(pin);
    expect(decodeURIComponent(body.smsUrl)).not.toContain(pin);
  });

  it("validates the body and rejects phone numbers in the internal note", async () => {
    const h = setup();
    await h.fund(ONE_ZEC);
    const agent = await h.admin();
    expect((await agent.post("/api/admin/payouts").send({ amountNgn: 100, category: "medical" })).status).toBe(400);
    expect((await agent.post("/api/admin/payouts").send({ amountNgn: 5000, category: "rent" })).status).toBe(400);
    const phone = await agent.post("/api/admin/payouts").send({ amountNgn: 5000, category: "other", internalNote: "call 0803 123 4567" });
    expect(phone.status).toBe(400);
    expect(phone.body.error).toBe("validation_error");
  });

  it("never exposes secrets, PINs or hashes in the admin list", async () => {
    const h = setup();
    await h.fund(ONE_ZEC);
    const { agent, pin, secret } = await createPayout(h);
    const list = await agent.get("/api/admin/payouts");
    expect(list.status).toBe(200);
    const text = JSON.stringify(list.body);
    expect(text).not.toContain(secret);
    expect(text).not.toContain("scrypt$");
    expect(text).not.toMatch(/secret|pin_hash|pinHash|claim_token|claimToken/i);
    expect(list.body[0]).not.toHaveProperty("pin");
    expect(pin).toMatch(/^\d{6}$/);
  });
});

describe("claim flow", () => {
  it("happy path: donate -> sync -> create -> open -> unlock -> redeem to a Zcash address", async () => {
    const h = setup();
    await h.fund(2 * ONE_ZEC);
    const { id, secret, pin } = await createPayout(h, { amountNgn: 50_000, category: "medical" });

    const opened = await request(h.app).post(`/api/claims/${id}/open`).send({ secret });
    expect(opened.status).toBe(200);
    expect(opened.body).toEqual({ status: "available", fundName: "Test Relief Fund" });

    const unlocked = await unlock(h, id, secret, pin);
    expect(unlocked.status).toBe(200);
    expect(unlocked.body).toMatchObject({ amountZat: 83_333_333, amountNgnDisplay: "₦50,000", amountZecDisplay: "0.83333333 ZEC" });
    expect(unlocked.body.claimToken).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const redeemed = await request(h.app)
      .post(`/api/claims/${id}/redeem`)
      .send({ claimToken: unlocked.body.claimToken, method: "zcash_address", zcashAddress: TESTNET_ADDRESS });
    expect(redeemed.status).toBe(200);
    expect(redeemed.body).toMatchObject({ status: "claimed", method: "zcash_address", demo: false });
    expect(redeemed.body.txid).toMatch(/^[0-9a-f]{64}$/);

    const out = h.db.prepare(`SELECT * FROM mock_ledger WHERE direction = 'out'`).all() as {
      amount_zat: number;
      fee_zat: number;
      memo: string;
      to_address: string;
      txid: string;
    }[];
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ amount_zat: 83_333_333, fee_zat: 10_000, memo: "Asiri payout", txid: redeemed.body.txid });
    // The recipient address itself is never stored.
    expect(out[0]!.to_address).not.toContain(TESTNET_ADDRESS);

    const row = h.db.prepare(`SELECT status, claim_method, claim_txid, claim_token_hash FROM payouts WHERE id = ?`).get(id);
    expect(row).toEqual({ status: "claimed", claim_method: "zcash_address", claim_txid: redeemed.body.txid, claim_token_hash: null });

    expect((await request(h.app).post(`/api/claims/${id}/open`).send({ secret })).body.status).toBe("claimed");

    const agent = await h.admin();
    const overview = await agent.get("/api/admin/overview");
    expect(overview.body).toMatchObject({ spendableZat: 2 * ONE_ZEC - 83_333_333 - 10_000, reservedZat: 0 });
  });

  it("returns 404 for a wrong secret or unknown id, without revealing anything", async () => {
    const h = setup();
    await h.fund(ONE_ZEC);
    const { id, secret } = await createPayout(h);
    const wrongSecret = secret.slice(0, -1) + (secret.endsWith("A") ? "B" : "A");
    const wrong = await request(h.app).post(`/api/claims/${id}/open`).send({ secret: wrongSecret });
    expect(wrong.status).toBe(404);
    expect(wrong.body).toEqual({ error: "not_found" });
    const unknown = await request(h.app).post(`/api/claims/ZZZZZZZZZZ/open`).send({ secret });
    expect(unknown.status).toBe(404);
    const malformed = await request(h.app).post(`/api/claims/bad/open`).send({ secret });
    expect(malformed.status).toBe(404);
  });

  it("wrong PIN decrements attemptsLeft and locks at PIN_MAX_ATTEMPTS", async () => {
    const h = setup();
    await h.fund(ONE_ZEC);
    const { id, secret, pin, agent } = await createPayout(h);
    const bad = wrongPin(pin);

    for (let left = 4; left >= 1; left--) {
      const res = await unlock(h, id, secret, bad);
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: "wrong_pin", attemptsLeft: left });
    }
    const fifth = await unlock(h, id, secret, bad);
    expect(fifth.status).toBe(423);
    expect(fifth.body).toEqual({ error: "locked" });

    // Even the right PIN is refused while locked.
    expect((await unlock(h, id, secret, pin)).status).toBe(423);
    expect((await request(h.app).post(`/api/claims/${id}/open`).send({ secret })).body.status).toBe("locked");

    // Locked payouts stay reserved; admin unlock makes it claimable again with fresh attempts.
    expect((await agent.get("/api/admin/overview")).body.counts.locked).toBe(1);
    const unlocked = await agent.post(`/api/admin/payouts/${id}/unlock`);
    expect(unlocked.status).toBe(200);
    expect(unlocked.body).toMatchObject({ status: "active", pinAttempts: 0 });
    expect((await unlock(h, id, secret, bad)).body.attemptsLeft).toBe(4);
    expect((await unlock(h, id, secret, pin)).status).toBe(200);
  });

  it("a correct PIN resets the attempt counter", async () => {
    const h = setup();
    await h.fund(ONE_ZEC);
    const { id, secret, pin } = await createPayout(h);
    await unlock(h, id, secret, wrongPin(pin));
    await unlock(h, id, secret, wrongPin(pin));
    expect((await unlock(h, id, secret, pin)).status).toBe(200);
    expect((await unlock(h, id, secret, wrongPin(pin))).body.attemptsLeft).toBe(4);
  });

  it("double redeem with the same token: the second gets 409", async () => {
    const h = setup();
    await h.fund(2 * ONE_ZEC);
    const { id, secret, pin } = await createPayout(h);
    const { claimToken } = (await unlock(h, id, secret, pin)).body;
    const body = { claimToken, method: "zcash_address", zcashAddress: TESTNET_ADDRESS };

    const first = await request(h.app).post(`/api/claims/${id}/redeem`).send(body);
    expect(first.status).toBe(200);
    const second = await request(h.app).post(`/api/claims/${id}/redeem`).send(body);
    expect(second.status).toBe(409);
    expect(second.body).toEqual({ error: "already_processing" });
    expect(h.db.prepare(`SELECT COUNT(*) n FROM mock_ledger WHERE direction='out'`).get()).toEqual({ n: 1 });
  });

  it("concurrent redeems send only once", async () => {
    const h = setup();
    await h.fund(3 * ONE_ZEC);
    const { id, secret, pin } = await createPayout(h);
    const { claimToken } = (await unlock(h, id, secret, pin)).body;
    const body = { claimToken, method: "zcash_address", zcashAddress: TESTNET_ADDRESS };
    const results = await Promise.all([1, 2, 3].map(() => request(h.app).post(`/api/claims/${id}/redeem`).send(body)));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    expect(h.db.prepare(`SELECT COUNT(*) n FROM mock_ledger WHERE direction='out'`).get()).toEqual({ n: 1 });
  });

  it("rejects an expired claim session and an invalid address", async () => {
    const h = setup();
    await h.fund(ONE_ZEC);
    const { id, secret, pin } = await createPayout(h);
    const { claimToken } = (await unlock(h, id, secret, pin)).body;

    const badAddr = await request(h.app)
      .post(`/api/claims/${id}/redeem`)
      .send({ claimToken, method: "zcash_address", zcashAddress: `zs1${"q".repeat(60)}` }); // mainnet address on testnet
    expect(badAddr.status).toBe(400);
    expect(badAddr.body.error).toBe("invalid_address");

    h.advance(16 * 60 * 1000); // past CLAIM_TOKEN_TTL_MINUTES
    const late = await request(h.app)
      .post(`/api/claims/${id}/redeem`)
      .send({ claimToken, method: "zcash_address", zcashAddress: TESTNET_ADDRESS });
    expect(late.status).toBe(401);
    expect(late.body.error).toBe("claim_session_expired");
  });

  it("a failed send returns the payout to active and keeps the token for a retry", async () => {
    const h = setup();
    await h.fund(ONE_ZEC);
    const { id, secret, pin } = await createPayout(h);
    const { claimToken } = (await unlock(h, id, secret, pin)).body;
    // Drain the treasury behind the app's back so the send fails.
    h.db
      .prepare(`INSERT INTO mock_ledger (txid, direction, amount_zat, fee_zat, created_at) VALUES ('drain', 'out', ?, 0, ?)`)
      .run(ONE_ZEC, new Date().toISOString());
    const body = { claimToken, method: "zcash_address", zcashAddress: TESTNET_ADDRESS };
    const failed = await request(h.app).post(`/api/claims/${id}/redeem`).send(body);
    expect(failed.status).toBe(503);
    expect(failed.body.error).toBe("insufficient_funds");
    expect(h.db.prepare(`SELECT status FROM payouts WHERE id = ?`).get(id)).toEqual({ status: "active" });

    await h.fund(ONE_ZEC);
    const retry = await request(h.app).post(`/api/claims/${id}/redeem`).send(body);
    expect(retry.status).toBe(200);
  });

  it("an unconfirmed send keeps the payout claiming, so the link can never pay twice", async () => {
    const h = setup();
    await h.fund(ONE_ZEC);
    const { id, secret, pin } = await createPayout(h);
    const { claimToken } = (await unlock(h, id, secret, pin)).body;
    h.mock.send = async () => {
      throw new ZcashError("send_unconfirmed");
    };
    const body = { claimToken, method: "zcash_address", zcashAddress: TESTNET_ADDRESS };
    const res = await request(h.app).post(`/api/claims/${id}/redeem`).send(body);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "already_processing" });
    expect(h.db.prepare(`SELECT status FROM payouts WHERE id = ?`).get(id)).toEqual({ status: "claiming" });
    const again = await request(h.app).post(`/api/claims/${id}/redeem`).send(body);
    expect(again.status).toBe(409);
    expect(h.db.prepare(`SELECT type FROM audit_events WHERE type = 'payout.send_unconfirmed'`).all()).toHaveLength(1);
  });

  it("demo cash-out: no send, demo flag, bank details never stored, funds stay earmarked", async () => {
    const h = setup();
    await h.fund(ONE_ZEC);
    const { id, secret, pin, agent } = await createPayout(h);
    const { claimToken } = (await unlock(h, id, secret, pin)).body;

    const bad = await request(h.app)
      .post(`/api/claims/${id}/redeem`)
      .send({ claimToken, method: "cashout_demo", bankName: "GTBank", accountNumber: "12345" });
    expect(bad.status).toBe(400);

    const res = await request(h.app)
      .post(`/api/claims/${id}/redeem`)
      .send({ claimToken, method: "cashout_demo", bankName: "GTBank", accountNumber: "0123456789" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "claimed", method: "cashout_demo", demo: true });
    expect(h.db.prepare(`SELECT COUNT(*) n FROM mock_ledger WHERE direction='out'`).get()).toEqual({ n: 0 });

    const dump = JSON.stringify([
      h.db.prepare(`SELECT * FROM payouts`).all(),
      h.db.prepare(`SELECT * FROM audit_events`).all(),
    ]);
    expect(dump).not.toContain("0123456789");
    expect(dump).not.toContain("GTBank");

    const overview = (await agent.get("/api/admin/overview")).body;
    expect(overview).toMatchObject({ spendableZat: ONE_ZEC, reservedZat: 0, settledOffchainZat: 83_353_333 });
    expect(overview.availableZat).toBe(ONE_ZEC - 83_353_333);
  });

  it("demo cash-out sends real funds when OFFRAMP_ZCASH_ADDRESS is set", async () => {
    const h = setup({ OFFRAMP_ZCASH_ADDRESS: TESTNET_ADDRESS });
    await h.fund(ONE_ZEC);
    const { id, secret, pin } = await createPayout(h);
    const { claimToken } = (await unlock(h, id, secret, pin)).body;
    const res = await request(h.app)
      .post(`/api/claims/${id}/redeem`)
      .send({ claimToken, method: "cashout_demo", bankName: "Access Bank", accountNumber: "0123456789" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "claimed", method: "cashout_demo", demo: false });
    expect(res.body.txid).toMatch(/^[0-9a-f]{64}$/);
  });

  it("cash-out is refused when DEMO_MODE=false", async () => {
    const h = setup({ DEMO_MODE: "false" });
    await h.fund(ONE_ZEC);
    const { id, secret, pin } = await createPayout(h);
    const { claimToken } = (await unlock(h, id, secret, pin)).body;
    const res = await request(h.app)
      .post(`/api/claims/${id}/redeem`)
      .send({ claimToken, method: "cashout_demo", bankName: "Access Bank", accountNumber: "0123456789" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("method_not_available");
  });
});

describe("expiry and cancellation", () => {
  it("an expired payout (via the job) opens as expired and releases its reservation", async () => {
    const h = setup();
    await h.fund(ONE_ZEC);
    const { id, secret, pin, agent } = await createPayout(h, { amountNgn: 50_000, category: "legal", expiresInDays: 1 });
    expect((await agent.get("/api/admin/overview")).body.reservedZat).toBe(83_353_333);

    h.advance(DAY + 1000);
    await h.jobs.runOnce();

    expect(h.db.prepare(`SELECT status FROM payouts WHERE id = ?`).get(id)).toEqual({ status: "expired" });
    const opened = await request(h.app).post(`/api/claims/${id}/open`).send({ secret });
    expect(opened.body.status).toBe("expired");
    expect((await unlock(h, id, secret, pin)).status).toBe(410);

    // The first session is past its 12 h lifetime by now, so log in again.
    expect((await agent.get("/api/admin/overview")).status).toBe(401);
    const overview = (await (await h.admin()).get("/api/admin/overview")).body;
    expect(overview.reservedZat).toBe(0);
    expect(overview.availableZat).toBe(ONE_ZEC);
    expect(overview.counts.expired).toBe(1);
  });

  it("expiry is also enforced between job runs", async () => {
    const h = setup();
    await h.fund(ONE_ZEC);
    const { id, secret } = await createPayout(h, { amountNgn: 5_000, category: "food", expiresInDays: 1 });
    h.advance(DAY + 1);
    expect((await request(h.app).post(`/api/claims/${id}/open`).send({ secret })).body.status).toBe("expired");
  });

  it("admin can cancel an active payout; cancelled links stop working", async () => {
    const h = setup();
    await h.fund(ONE_ZEC);
    const { id, secret, pin, agent } = await createPayout(h);
    const cancelled = await agent.post(`/api/admin/payouts/${id}/cancel`);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe("cancelled");
    expect((await request(h.app).post(`/api/claims/${id}/open`).send({ secret })).body.status).toBe("cancelled");
    expect((await unlock(h, id, secret, pin)).body).toEqual({ error: "cancelled" });
    expect((await agent.post(`/api/admin/payouts/${id}/cancel`)).status).toBe(409);
    expect((await agent.get("/api/admin/overview")).body.reservedZat).toBe(0);
  });
});

describe("links", () => {
  it("parses link parts", () => {
    expect(parseLink("http://x/c/AbCdEfGhIj#sec-ret_")).toEqual({ id: "AbCdEfGhIj", secret: "sec-ret_" });
  });
});
