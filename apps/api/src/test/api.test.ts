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

  it("GET /api/price returns the fixed rate", async () => {
    const h = setup();
    const res = await request(h.app).get("/api/price");
    expect(res.body).toMatchObject({ zecNgn: 60_000, zecUsd: 40, source: "fixed" });
  });

  it("simulated donations are 404 when DEMO_MODE=false", async () => {
    const h = setup({ DEMO_MODE: "false" });
    expect((await request(h.app).post("/api/donations/simulate").send({ amountNgn: 1000 })).status).toBe(404);
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
    const badBody = await request(h.app).post("/api/donations/simulate").send({ amountNgn: 5 });
    expect(badBody.status).toBe(400);
    expect(badBody.body.error).toBe("validation_error");
    expect(badBody.body.details.fieldErrors.amountNgn).toBeDefined();
  });
});

describe("transparency", () => {
  it("excludes simulated donations from receivedZat and counts claimed payouts", async () => {
    const h = setup();
    await h.fund(3 * ONE_ZEC);
    const sim = await request(h.app).post("/api/donations/simulate").send({ amountNgn: 60_000 });
    expect(sim.status).toBe(200);
    expect(sim.body.amountZat).toBe(ONE_ZEC);

    const p1 = await createPayout(h, { amountNgn: 30_000, category: "medical" });
    const t1 = (await request(h.app).post(`/api/claims/${p1.id}/unlock`).send({ secret: p1.secret, pin: p1.pin })).body.claimToken;
    await request(h.app).post(`/api/claims/${p1.id}/redeem`).send({ claimToken: t1, method: "zcash_address", zcashAddress: TESTNET_ADDRESS }).expect(200);
    await createPayout(h, { amountNgn: 6_000, category: "food" }); // open, not claimed

    const res = await request(h.app).get("/api/transparency");
    expect(res.status).toBe(200);
    expect(res.body.totals).toEqual({
      receivedZat: 3 * ONE_ZEC,
      simulatedZat: ONE_ZEC,
      paidOutZat: 50_000_000,
      outstandingZat: 10_000_000,
      payoutsCount: 1,
    });
    expect(res.body.byCategory).toEqual([{ category: "medical", count: 1, amountZat: 50_000_000 }]);
    expect(res.body.weekly).toHaveLength(8);
    expect(res.body.weekly[7]).toEqual({ weekStart: "2026-10-19", receivedZat: 3 * ONE_ZEC, paidOutZat: 50_000_000 });
    expect(res.body.ufvk).toMatch(/^uviewtest1mock/);
    expect(res.body.verifyHint).toContain("viewing key");
    expect(res.body.currency).toEqual({ zecNgn: 60_000, source: "fixed" });
    expect(res.body.latestReport).toBeNull();

    // Nothing that could identify a recipient is public.
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(p1.id);
    expect(text).not.toContain(TESTNET_ADDRESS);
  });

  it("admin donations list includes memos; transparency never does", async () => {
    const h = setup();
    await request(h.app).post("/api/dev/mock-donate").send({ amountZat: ONE_ZEC, memo: "for the clinic" }).expect(201);
    await h.jobs.runOnce();
    await h.jobs.runOnce(); // idempotent import
    const agent = await h.admin();
    const list = (await agent.get("/api/admin/donations")).body;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ source: "zcash", amountZat: ONE_ZEC, memo: "for the clinic", amountNgnDisplay: "₦60,000" });
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
    await request(h.app).post("/api/dev/mock-donate").send({ amountZat: ONE_ZEC }).expect(201);
    const agent = await h.admin();
    const res = await agent.post("/api/admin/sync");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ spendableZat: ONE_ZEC, availableZat: ONE_ZEC, lastSyncError: null });
    expect(res.body.lastSyncAt).toBe("2026-10-20T12:00:00.000Z");
    expect((await agent.get("/api/admin/donations")).body).toHaveLength(1);
  });
});

describe("price service", () => {
  const ok: Fetcher = async (url) => {
    expect(url).toBe(COINGECKO_URL);
    return { ok: true, json: async () => ({ zcash: { ngn: 71_234.5, usd: 45.6 } }) };
  };

  it("uses CoinGecko and caches for 5 minutes", async () => {
    let t = 0;
    let calls = 0;
    const svc = new PriceService({
      source: "coingecko",
      fixedZecNgn: 1,
      fixedZecUsd: 1,
      now: () => new Date(t),
      fetcher: async (u, i) => {
        calls++;
        return ok(u, i);
      },
    });
    expect(await svc.get()).toMatchObject({ zecNgn: 71_234.5, zecUsd: 45.6, source: "coingecko" });
    t += 4 * 60_000;
    await svc.get();
    expect(calls).toBe(1);
    t += 2 * 60_000;
    await svc.get();
    expect(calls).toBe(2);
  });

  it("falls back to the fixed rate when the fetch fails or returns junk", async () => {
    const failing = new PriceService({ source: "coingecko", fixedZecNgn: 60_000, fixedZecUsd: 40, fetcher: async () => { throw new Error("offline"); } });
    expect(await failing.get()).toMatchObject({ zecNgn: 60_000, zecUsd: 40, source: "fixed" });
    const junk = new PriceService({ source: "coingecko", fixedZecNgn: 60_000, fixedZecUsd: 40, fetcher: async () => ({ ok: true, json: async () => ({ zcash: {} }) }) });
    expect((await junk.get()).source).toBe("fixed");
  });
});
