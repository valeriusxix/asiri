import request from "supertest";
import { createApp, getServices } from "../app.js";
import { openDb } from "../db/db.js";
import { parseEnv } from "../env.js";
import type { Fetcher } from "../services/price.js";
import { MockAdapter } from "../zcash/mock.js";

export const TEST_ENV: Record<string, string> = {
  NODE_ENV: "test",
  FUND_NAME: "Test Relief Fund",
  PUBLIC_WEB_URL: "http://localhost:5173",
  DEMO_MODE: "true",
  ADMIN_EMAIL: "organizer@example.com",
  ADMIN_PASSWORD: "test-password-123",
  SESSION_SECRET: "s".repeat(64),
  DATABASE_PATH: ":memory:",
  ZCASH_MODE: "mock",
  ZCASH_NETWORK: "testnet",
  PRICE_SOURCE: "fixed",
  FIXED_ZEC_NGN: "60000",
  FIXED_ZEC_USD: "40",
  FEE_BUFFER_ZAT: "20000",
};

/** Never hits the network. */
export const offlineFetcher: Fetcher = async () => {
  throw new Error("network disabled in tests");
};

export const TESTNET_ADDRESS = `utest1${"q".repeat(60)}`;

export function setup(envOverrides: Record<string, string> = {}, start = new Date("2026-10-20T12:00:00.000Z")) {
  const db = openDb(":memory:");
  const env = parseEnv({ ...TEST_ENV, ...envOverrides });
  const clock = { t: start.getTime() };
  const now = () => new Date(clock.t);
  const mock = new MockAdapter(db, env.ZCASH_NETWORK, { syncDelayMs: 0, now });
  const app = createApp({
    db,
    adapter: mock,
    env,
    now,
    fetcher: offlineFetcher,
    webDistDir: "/nonexistent",
    rateLimits: { claims: 1000, login: 1000, global: 1000 },
  });
  const { ctx, jobs } = getServices(app);

  return {
    db,
    env,
    app,
    ctx,
    jobs,
    mock,
    advance(ms: number) {
      clock.t += ms;
    },
    /** A supertest agent that keeps the session cookie. */
    async admin() {
      const agent = request.agent(app);
      const res = await agent.post("/api/auth/login").send({ email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD });
      if (res.status !== 200) throw new Error(`login failed: ${res.status}`);
      return agent;
    },
    /** Fund the mock treasury and import it, as a donor + sync would. */
    async fund(amountZat: number) {
      await request(app).post("/api/dev/mock-donate").send({ amountZat }).expect(201);
      await jobs.runOnce();
    },
  };
}

export type Harness = ReturnType<typeof setup>;

/** Splits a claim link into payout id and secret. */
export function parseLink(link: string): { id: string; secret: string } {
  const url = new URL(link);
  const id = url.pathname.split("/").pop()!;
  return { id, secret: url.hash.slice(1) };
}

/** Creates a payout through the admin API and returns the link parts + PIN. */
export async function createPayout(h: Harness, body: Record<string, unknown> = { amountNgn: 50_000, category: "medical" }) {
  const agent = await h.admin();
  const res = await agent.post("/api/admin/payouts").send(body);
  if (res.status !== 201) throw new Error(`create payout failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { ...parseLink(res.body.link), pin: res.body.pin as string, body: res.body, agent };
}
