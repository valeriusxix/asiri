import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseDotenv } from "dotenv";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { insecureDefaults, isPlaceholderSecret, parseEnv, ROOT_DIR } from "../env.js";
import { setup, TEST_ENV } from "./helpers.js";

describe("GET /api/health", () => {
  it("reports mode and network", async () => {
    const { app } = setup();
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, mode: "mock", network: "testnet", demoMode: true });
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

  it("boots from .env.example in development, but production refuses its public SESSION_SECRET (audit H1)", () => {
    const example = parseDotenv(readFileSync(path.join(ROOT_DIR, ".env.example"), "utf8"));
    expect(() => parseEnv(example)).not.toThrow();
    // Changing only the password (which production already forces) must not be enough.
    expect(() => parseEnv({ ...example, NODE_ENV: "production", ADMIN_PASSWORD: "a-real-password-123" })).toThrow(/SESSION_SECRET/);
    const random = randomBytes(32).toString("hex");
    expect(() => parseEnv({ ...example, NODE_ENV: "production", ADMIN_PASSWORD: "a-real-password-123", SESSION_SECRET: random })).not.toThrow();
  });

  it("refuses non-random session secrets in production", () => {
    const prod = { ...TEST_ENV, NODE_ENV: "production", ADMIN_PASSWORD: "a-real-password-123" };
    for (const secret of ["s".repeat(64), "0".repeat(40), "replace-with-something-random-later-please", "change-me-change-me-change-me-change-me"]) {
      expect(() => parseEnv({ ...prod, SESSION_SECRET: secret })).toThrow(/SESSION_SECRET/);
    }
    expect(isPlaceholderSecret(randomBytes(32).toString("base64url"))).toBe(false);
  });

  it("warns at boot while the public login defaults are in use, without echoing them (audit H4)", () => {
    const example = parseDotenv(readFileSync(path.join(ROOT_DIR, ".env.example"), "utf8"));
    const warnings = insecureDefaults(parseEnv(example));
    expect(warnings).toHaveLength(2);
    expect(warnings.join(" ")).toMatch(/ADMIN_PASSWORD/);
    expect(warnings.join(" ")).toMatch(/SESSION_SECRET/);
    expect(warnings.join(" ")).not.toContain(example.ADMIN_PASSWORD!);
    expect(warnings.join(" ")).not.toContain(example.SESSION_SECRET!);
    const changed = { ...example, ADMIN_PASSWORD: "a-real-password-123", SESSION_SECRET: randomBytes(32).toString("hex") };
    expect(insecureDefaults(parseEnv(changed))).toEqual([]);
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
