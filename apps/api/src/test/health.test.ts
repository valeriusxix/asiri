import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { parseEnv } from "../env.js";

const baseEnv = {
  NODE_ENV: "test",
  ADMIN_EMAIL: "organizer@example.com",
  ADMIN_PASSWORD: "test-password",
  SESSION_SECRET: "x".repeat(40),
};

describe("GET /api/health", () => {
  it("reports mode and network", async () => {
    const app = createApp({ env: parseEnv(baseEnv), webDistDir: "/nonexistent" });
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, mode: "mock", network: "testnet" });
  });

  it("returns JSON 404 for unknown API routes", async () => {
    const app = createApp({ env: parseEnv(baseEnv), webDistDir: "/nonexistent" });
    const res = await request(app).get("/api/nope");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "not_found" });
  });
});

describe("parseEnv", () => {
  it("rejects a short SESSION_SECRET", () => {
    expect(() => parseEnv({ ...baseEnv, SESSION_SECRET: "short" })).toThrow(/SESSION_SECRET/);
  });

  it("rejects the default admin password in production", () => {
    expect(() => parseEnv({ ...baseEnv, NODE_ENV: "production", ADMIN_PASSWORD: "change-me-now" })).toThrow(/ADMIN_PASSWORD/);
  });

  it("requires LIGHTWALLETD_URL in zingo mode", () => {
    expect(() => parseEnv({ ...baseEnv, ZCASH_MODE: "zingo", LIGHTWALLETD_URL: "" })).toThrow(/LIGHTWALLETD_URL/);
  });
});
