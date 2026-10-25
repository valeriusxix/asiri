import request from "supertest";
import { describe, expect, it } from "vitest";
import { parseEnv } from "../env.js";
import { setup, TEST_ENV } from "./helpers.js";

describe("GET /api/health", () => {
  it("reports mode and network", async () => {
    const { app } = setup();
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, mode: "mock", network: "testnet" });
  });

  it("returns JSON 404 for unknown API routes", async () => {
    const { app } = setup();
    const res = await request(app).get("/api/nope");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "not_found" });
  });

  it("sets security headers including the CSP", async () => {
    const { app } = setup();
    const res = await request(app).get("/api/health");
    expect(res.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(res.headers["content-security-policy"]).not.toContain("upgrade-insecure-requests");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });
});

describe("parseEnv", () => {
  it("rejects a short SESSION_SECRET", () => {
    expect(() => parseEnv({ ...TEST_ENV, SESSION_SECRET: "short" })).toThrow(/SESSION_SECRET/);
  });

  it("rejects the default admin password in production", () => {
    expect(() => parseEnv({ ...TEST_ENV, NODE_ENV: "production", ADMIN_PASSWORD: "change-me-now" })).toThrow(/ADMIN_PASSWORD/);
  });

  it("requires LIGHTWALLETD_URL in zingo mode", () => {
    expect(() => parseEnv({ ...TEST_ENV, ZCASH_MODE: "zingo", LIGHTWALLETD_URL: "" })).toThrow(/LIGHTWALLETD_URL/);
  });

  it("does not echo secret values in the error", () => {
    try {
      parseEnv({ ...TEST_ENV, SESSION_SECRET: "tooshort-secret-value" });
    } catch (err) {
      expect((err as Error).message).not.toContain("tooshort-secret-value");
    }
  });
});
