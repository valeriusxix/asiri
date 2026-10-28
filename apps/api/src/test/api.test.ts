import request from "supertest";
import { describe, expect, it } from "vitest";
import { PriceService, COINGECKO_URL, type Fetcher } from "../services/price.js";
import { createPayout, setup, TESTNET_ADDRESS } from "./helpers.js";

const ONE_ZEC = 100_000_000;

describe("auth", () => {
  it("admin routes return 401 without a session", async () => {
    const h = setup();
    const routes: [string, string][] = [
      ["get", "/api/admin/overview"],
      ["post", "/api/admin/sync"],
      ["get", "/api/admin/donations"],
      ["get", "/api/admin/payouts"],
      ["post", "/api/admin/payouts"],
      ["post", "/api/admin/payouts/AAAAAAAAAA/cancel"],
      ["post", "/api/admin/payouts/AAAAAAAAAA/unlock"],
      ["post", "/api/admin/reports/generate"],
      ["post", "/api/admin/reports/x/publish"],
      ["get", "/api/admin/reports"],
    ];
    for (const [method, path] of routes) {
      const res = await (method === "get" ? request(h.app).get(path) : request(h.app).post(path).send({}));
      expect(res.status, `${method} ${path}`).toBe(401);
      expect(res.body).toEqual({ error: "unauthorized" });
    }
    expect((await request(h.app).get("/api/auth/me")).status).toBe(401);
  });

  it("in production, login over plain HTTP says https_required instead of silently setting no cookie (audit M3)", async () => {
    const h = setup({ NODE_ENV: "production", ADMIN_PASSWORD: "a-real-password-123", SESSION_SECRET: "9f2c4e7a1b3d5f8e0a6c2b4d7e9f1a3c5b8d0e2f4a6c8e1b3d5f7a9c2e4b6d8f" });
    const credentials = { email: h.env.ADMIN_EMAIL, password: h.env.ADMIN_PASSWORD };

    const plain = await request(h.app).post("/api/auth/login").send(credentials);
    expect(plain.status).toBe(400);
    expect(plain.body).toEqual({ error: "https_required" });
    expect(plain.headers["set-cookie"]).toBeUndefined();

    // Behind a TLS-terminating proxy (trust proxy = 1 in production), the same login works and the cookie is Secure.
    const tls = await request(h.app).post("/api/auth/login").set("X-Forwarded-Proto", "https").send(credentials);
    expect(tls.status).toBe(200);
    const cookies = ([] as string[]).concat(tls.headers["set-cookie"] ?? []);
    expect(cookies.some((c) => c.startsWith("asiri_session=") && /;\s*secure/i.test(c) && /;\s*httponly/i.test(c))).toBe(true);
  });

  it("logs in with the env credentials, sets an httpOnly cookie, and logs out", async () => {
    const h = setup();
    const agent = request.agent(h.app);
    const bad = await agent.post("/api/auth/login").send({ email: h.env.ADMIN_EMAIL, password: "nope" });
    expect(bad.status).toBe(401);
    expect(bad.body).toEqual({ error: "invalid_credentials" });

    const ok = await agent.post("/api/auth/login").send({ email: "Organizer@Example.com", password: h.env.ADMIN_PASSWORD });
    expect(ok.status).toBe(200);
    const cookies = ([] as string[]).concat(ok.headers["set-cookie"] ?? []);
    expect(cookies.join(";")).toMatch(/httponly/i);
    expect(cookies.join(";")).toMatch(/samesite=lax/i);
    expect((await agent.get("/api/auth/me")).body).toEqual({ email: h.env.ADMIN_EMAIL });
    expect((await agent.get("/api/admin/overview")).status).toBe(200);

    await agent.post("/api/auth/logout");
    expect((await agent.get("/api/auth/me")).status).toBe(401);
  });

  it("expires sessions after 12 hours server-side", async () => {
    const h = setup();
    const agent = await h.admin();
    h.advance(12 * 60 * 60 * 1000 + 1000);
    expect((await agent.get("/api/admin/overview")).status).toBe(401);
  });

  it("rate-limits login to 5/min/IP by default", async () => {
    const h = setup();
    const { createApp } = await import("../app.js");
    const app = createApp({ db: h.db, adapter: h.mock, env: h.env, webDistDir: "/nonexistent" });
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await request(app).post("/api/auth/login").send({ email: "x@y.z", password: "p" })).status);
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
  });

  it("rate-limits claim routes to 10/min/IP by default", async () => {
    const h = setup();
    const { createApp } = await import("../app.js");
    const app = createApp({ db: h.db, adapter: h.mock, env: h.env, webDistDir: "/nonexistent" });
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await request(app).post("/api/claims/AAAAAAAAAA/open").send({ secret: "x".repeat(43) })).status);
    expect(statuses.slice(0, 10).every((s) => s === 404)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});

describe("public routes", () => {
  it("GET /api/fund returns the mock address, UFVK and a ZIP-321 URI", async () => {
    const h = setup();
    const res = await request(h.app).get("/api/fund");
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Test Relief Fund");
    expect(res.body.network).toBe("testnet");
    expect(res.body.receiveAddress).toMatch(/^utest1mock/);
    expect(res.body.ufvk).toMatch(/^uviewtest1mock/);
    expect(res.body.paymentUri).toBe(`zcash:${res.body.receiveAddress}?message=Donation%20to%20Test%20Relief%20Fund`);
    expect(res.body.demoMode).toBe(true);
  });

  it("tells the web app when the address, totals and viewing key are mock placeholders (audit H2)", async () => {
    const h = setup();
    expect((await request(h.app).get("/api/fund")).body.mode).toBe("mock");
    expect((await request(h.app).get("/api/transparency")).body.mode).toBe("mock");
  });

  it("GET /api/price returns all four rates, the source of each, and the fund currency", async () => {
    const h = setup();
    const res = await request(h.app).get("/api/price");
    expect(res.body).toMatchObject({
      rates: { NGN: 60_000, USD: 40, GBP: 32, CAD: 50 },
      sources: { NGN: "fixed", USD: "fixed", GBP: "fixed", CAD: "fixed" },
      fundCurrency: "NGN",
    });
    expect(typeof res.body.updatedAt).toBe("string");
  });

  it("simulated donations are 404 when DEMO_MODE=false", async () => {
    const h = setup({ DEMO_MODE: "false" });
    expect((await request(h.app).post("/api/donations/simulate").send({ amount: 1000 })).status).toBe(404);
  });

  it("mock-donate needs the organizer session and caps the amount (audit H3)", async () => {
    const h = setup();
    const anon = await request(h.app).post("/api/dev/mock-donate").send({ amountZat: 2_100_000_000_000_000, memo: "anyone can write this" });
    expect(anon.status).toBe(401);
    expect(anon.body).toEqual({ error: "unauthorized" });
    await h.jobs.runOnce();
    expect((await request(h.app).get("/api/transparency")).body.totals.receivedZat).toBe(0);

    const agent = await h.admin();
    expect((await agent.post("/api/dev/mock-donate").send({ amountZat: 100 * ONE_ZEC + 1 })).status).toBe(400);
    expect((await agent.post("/api/dev/mock-donate").send({ amountZat: 100 * ONE_ZEC })).status).toBe(201);
  });

  it("dev routes are 404 outside mock mode", async () => {
    const h = setup({ ZCASH_MODE: "zingo", LIGHTWALLETD_URL: "https://example.invalid:443" });
    expect((await request(h.app).post("/api/dev/mock-donate").send({ amountZat: 1000 })).status).toBe(404);
  });

  it("returns validation_error for bad JSON and bad bodies", async () => {
    const h = setup();
    const badJson = await request(h.app).post("/api/donations/simulate").set("content-type", "application/json").send("{nope");
    expect(badJson.status).toBe(400);
    expect(badJson.body.error).toBe("validation_error");
    const badBody = await request(h.app).post("/api/donations/simulate").send({ amount: 5 });
    expect(badBody.status).toBe(400);
    expect(badBody.body.error).toBe("validation_error");
    expect(badBody.body.details.fieldErrors.amount).toEqual(["Amount must be between ₦100 and ₦10,000,000"]);
  });
});

describe("transparency", () => {
  it("excludes simulated donations from receivedZat and counts claimed payouts", async () => {
    const h = setup();
    await h.fund(3 * ONE_ZEC);
    const sim = await request(h.app).post("/api/donations/simulate").send({ amount: 60_000 });
    expect(sim.status).toBe(200);
    expect(sim.body.amountZat).toBe(ONE_ZEC);

    const p1 = await createPayout(h, { amount: 30_000, category: "medical" });
    const t1 = (await request(h.app).post(`/api/claims/${p1.id}/unlock`).send({ secret: p1.secret, pin: p1.pin })).body.claimToken;
    await request(h.app).post(`/api/claims/${p1.id}/redeem`).send({ claimToken: t1, method: "zcash_address", zcashAddress: TESTNET_ADDRESS }).expect(200);
    await createPayout(h, { amount: 6_000, category: "food" }); // open, not claimed

    const res = await request(h.app).get("/api/transparency");
    expect(res.status).toBe(200);
    expect(res.body.totals).toEqual({
      receivedZat: 3 * ONE_ZEC,
      simulatedZat: ONE_ZEC,
      paidOutZat: 50_000_000,
      outstandingZat: 10_000_000,
      payoutsCount: 1,
      demoCashoutZat: 0,
      demoCashoutCount: 0,
    });
    expect(res.body.byCategory).toEqual([{ category: "medical", count: 1, amountZat: 50_000_000 }]);
    expect(res.body.weekly).toHaveLength(8);
    expect(res.body.weekly[7]).toEqual({ weekStart: "2026-10-19", receivedZat: 3 * ONE_ZEC, paidOutZat: 50_000_000 });
    expect(res.body.ufvk).toMatch(/^uviewtest1mock/);
    expect(res.body.verifyHint).toContain("viewing key");
    expect(res.body.fundCurrency).toBe("NGN");
    expect(res.body.latestReport).toBeNull();

    // Nothing that could identify a recipient is public.
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(p1.id);
    expect(text).not.toContain(TESTNET_ADDRESS);
  });

  it("breaks out demo cash-outs, where no money moved, from real payments (audit M1)", async () => {
    const h = setup();
    await h.fund(3 * ONE_ZEC);
    const claim = async (p: { id: string; secret: string; pin: string }, body: Record<string, string>) => {
      const token = (await request(h.app).post(`/api/claims/${p.id}/unlock`).send({ secret: p.secret, pin: p.pin })).body.claimToken;
      await request(h.app).post(`/api/claims/${p.id}/redeem`).send({ claimToken: token, ...body }).expect(200);
    };
    await claim(await createPayout(h, { amount: 30_000, category: "medical" }), { method: "cashout_demo", bankName: "UBA", accountNumber: "0123456789" });
    await claim(await createPayout(h, { amount: 6_000, category: "food" }), { method: "zcash_address", zcashAddress: TESTNET_ADDRESS });

    const { totals } = (await request(h.app).get("/api/transparency")).body;
    expect(totals).toMatchObject({ paidOutZat: 60_000_000, payoutsCount: 2, demoCashoutZat: 50_000_000, demoCashoutCount: 1 });

    const agent = await h.admin();
    const report = (await agent.post("/api/admin/reports/generate").send({ periodDays: 7 })).body;
    expect(report.stats).toMatchObject({ paidOut: "₦36,000", demoCashouts: "₦30,000", demoCashoutsCount: 1 });
    expect(report.body).toContain("This includes ₦30,000 in 1 demo cash-out, where no real bank transfer happened.");
  });

  it("a cash-out sent to OFFRAMP_ZCASH_ADDRESS moved real money, so it is not a demo cash-out", async () => {
    const h = setup({ OFFRAMP_ZCASH_ADDRESS: TESTNET_ADDRESS });
    await h.fund(3 * ONE_ZEC);
    const p = await createPayout(h, { amount: 30_000, category: "medical" });
    const token = (await request(h.app).post(`/api/claims/${p.id}/unlock`).send({ secret: p.secret, pin: p.pin })).body.claimToken;
    await request(h.app).post(`/api/claims/${p.id}/redeem`).send({ claimToken: token, method: "cashout_demo", bankName: "UBA", accountNumber: "0123456789" }).expect(200);
    expect((await request(h.app).get("/api/transparency")).body.totals).toMatchObject({ payoutsCount: 1, demoCashoutCount: 0, demoCashoutZat: 0 });
  });

  it("admin donations list includes memos; transparency never does", async () => {
    const h = setup();
    await h.mockDonate(ONE_ZEC, "for the clinic");
    await h.jobs.runOnce();
    await h.jobs.runOnce(); // idempotent import
    const agent = await h.admin();
    const list = (await agent.get("/api/admin/donations")).body;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ source: "zcash", amountZat: ONE_ZEC, memo: "for the clinic", amountDisplay: "₦60,000" });
    expect(JSON.stringify((await request(h.app).get("/api/transparency")).body)).not.toContain("clinic");
  });
});

describe("reports (template)", () => {
  it("generates a draft, publishes it, and shows it on the transparency page", async () => {
    const h = setup();
    await h.fund(ONE_ZEC);
    const agent = await h.admin();
    const gen = await agent.post("/api/admin/reports/generate").send({ periodDays: 7 });
    expect(gen.status).toBe(201);
    expect(gen.body).toMatchObject({ generator: "template", published: false });
    expect(gen.body.body).toContain("₦60,000");
    expect(gen.body.stats.donationsReceived).toBe("₦60,000");

    expect((await request(h.app).get("/api/transparency")).body.latestReport).toBeNull();
    const pub = await agent.post(`/api/admin/reports/${gen.body.id}/publish`);
    expect(pub.status).toBe(200);
    expect(pub.body.published).toBe(true);
    const latest = (await request(h.app).get("/api/transparency")).body.latestReport;
    expect(latest.body).toBe(gen.body.body);
    expect((await agent.get("/api/admin/reports")).body).toHaveLength(1);
  });
});

describe("admin sync", () => {
  it("POST /api/admin/sync imports mock donations and returns the overview", async () => {
    const h = setup();
    await h.mockDonate(ONE_ZEC);
    const agent = await h.admin();
    const res = await agent.post("/api/admin/sync");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ spendableZat: ONE_ZEC, availableZat: ONE_ZEC, lastSyncError: null });
    expect(res.body.lastSyncAt).toBe("2026-10-20T12:00:00.000Z");
    expect((await agent.get("/api/admin/donations")).body).toHaveLength(1);
  });
});

describe("price service", () => {
  // Test numbers, not market prices.
  const FIXED = { NGN: 60_000, USD: 40, GBP: 32, CAD: 50 };
  const LIVE = { ngn: 71_234.5, usd: 45.6, gbp: 36.1, cad: 62.75 };
  const ok: Fetcher = async (url) => {
    expect(url).toBe(COINGECKO_URL);
    return { ok: true, json: async () => ({ zcash: LIVE }) };
  };

  it("asks CoinGecko for all four currencies in one request", () => {
    expect(COINGECKO_URL).toBe("https://api.coingecko.com/api/v3/simple/price?ids=zcash&vs_currencies=ngn,usd,gbp,cad");
  });

  it("uses CoinGecko and caches for 5 minutes", async () => {
    let t = 0;
    let calls = 0;
    const svc = new PriceService({
      source: "coingecko",
      fixed: FIXED,
      now: () => new Date(t),
      fetcher: async (u, i) => {
        calls++;
        return ok(u, i);
      },
    });
    expect(await svc.get()).toMatchObject({
      rates: { NGN: 71_234.5, USD: 45.6, GBP: 36.1, CAD: 62.75 },
      sources: { NGN: "coingecko", USD: "coingecko", GBP: "coingecko", CAD: "coingecko" },
    });
    t += 4 * 60_000;
    await svc.get();
    expect(calls).toBe(1);
    t += 2 * 60_000;
    await svc.get();
    expect(calls).toBe(2);
  });

  it("falls back per currency: a missing or junk rate uses its fixed rate, the others stay live", async () => {
    const partial = new PriceService({ source: "coingecko", fixed: FIXED, fetcher: async () => ({ ok: true, json: async () => ({ zcash: { usd: 45.6, gbp: "oops", cad: -1 } }) }) });
    expect(await partial.get()).toMatchObject({
      rates: { NGN: 60_000, USD: 45.6, GBP: 32, CAD: 50 },
      sources: { NGN: "fixed", USD: "coingecko", GBP: "fixed", CAD: "fixed" },
    });
  });

  it("falls back to every fixed rate when the fetch fails or returns junk", async () => {
    const failing = new PriceService({ source: "coingecko", fixed: FIXED, fetcher: async () => { throw new Error("offline"); } });
    expect(await failing.get()).toMatchObject({ rates: FIXED, sources: { NGN: "fixed", USD: "fixed", GBP: "fixed", CAD: "fixed" } });
    const junk = new PriceService({ source: "coingecko", fixed: FIXED, fetcher: async () => ({ ok: true, json: async () => ({ nope: 1 }) }) });
    expect((await junk.get()).sources.USD).toBe("fixed");
  });
});
