import { Writable } from "node:stream";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import {
  generatePin,
  hashPin,
  randomId,
  randomSecret,
  safeEqualHex,
  safeEqualString,
  sha256Hex,
  verifyPin,
  verifySecret,
} from "../lib/crypto.js";
import { REDACT_PATHS } from "../lib/logger.js";
import { CURRENCIES, CURRENCY_CODES, checkAmount, fiatMinorToZat, formatMoney, toMinor, zatToFiatMinor } from "../lib/currency.js";
import { formatZec, zatToZecString } from "../lib/money.js";
import { Mutex, withTimeout } from "../lib/mutex.js";

describe("crypto", () => {
  it("generates 10-char alphanumeric ids", () => {
    for (let i = 0; i < 200; i++) expect(randomId()).toMatch(/^[A-Za-z0-9]{10}$/);
  });

  it("generates 32-byte base64url secrets without padding", () => {
    const s = randomSecret();
    expect(s).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(s, "base64url")).toHaveLength(32);
  });

  it("verifies secrets by sha256", () => {
    const s = randomSecret();
    const h = sha256Hex(s);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(verifySecret(s, h)).toBe(true);
    expect(verifySecret(`${s}x`, h)).toBe(false);
    expect(verifySecret(s, "")).toBe(false);
  });

  it("compares hex and strings safely", () => {
    expect(safeEqualHex("abcd", "abcd")).toBe(true);
    expect(safeEqualHex("abcd", "abce")).toBe(false);
    expect(safeEqualHex("abcd", "abcdef")).toBe(false);
    expect(safeEqualString("a@b.c", "a@b.c")).toBe(true);
    expect(safeEqualString("a@b.c", "a@b.cd")).toBe(false);
  });

  it("generates 6-digit PINs", () => {
    for (let i = 0; i < 200; i++) expect(generatePin()).toMatch(/^\d{6}$/);
  });

  it("hashes PINs with scrypt and verifies them", async () => {
    const stored = await hashPin("012345");
    expect(stored).toMatch(/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
    expect(stored).not.toContain("012345");
    expect(await verifyPin("012345", stored)).toBe(true);
    expect(await verifyPin("012346", stored)).toBe(false);
    expect(await verifyPin("012345", "garbage")).toBe(false);
    // Same PIN, different salt.
    expect(await hashPin("012345")).not.toBe(stored);
  });
});

describe("money", () => {
  it("converts zat to exact ZEC strings", () => {
    expect(zatToZecString(0)).toBe("0");
    expect(zatToZecString(100_000_000)).toBe("1");
    expect(zatToZecString(83_333_333)).toBe("0.83333333");
    expect(zatToZecString(150_000_000)).toBe("1.5");
    expect(zatToZecString(1)).toBe("0.00000001");
  });

  it("formats ZEC display strings", () => {
    expect(formatZec(83_333_333)).toBe("0.8333 ZEC");
    expect(formatZec(83_333_333, 8)).toBe("0.83333333 ZEC");
    expect(formatZec(100_000_000)).toBe("1.00 ZEC");
  });

});

describe("currencies", () => {
  it("formats all four with their locale, symbol and decimals", () => {
    expect(formatMoney(5_000_000, "NGN")).toBe("₦50,000");
    expect(formatMoney(125_050, "NGN")).toBe("₦1,250.50");
    expect(formatMoney(125_000, "USD")).toBe("$1,250.00");
    expect(formatMoney(1_999, "GBP")).toBe("£19.99");
    expect(formatMoney(125_000, "CAD")).toBe("CA$1,250.00");
    expect(formatMoney(5, "USD")).toBe("$0.05");
    expect(formatMoney(500_000_000, "NGN")).toBe("₦5,000,000");
  });

  it("defines every currency once, with 2 minor units and the specified limits", () => {
    expect(CURRENCY_CODES).toEqual(["NGN", "USD", "GBP", "CAD"]);
    for (const c of CURRENCY_CODES) expect(CURRENCIES[c].minorUnits).toBe(2);
    expect(CURRENCIES.NGN.payout).toEqual({ min: 500, max: 5_000_000 });
    for (const c of ["USD", "GBP", "CAD"] as const) expect(CURRENCIES[c].payout).toEqual({ min: 1, max: 5_000 });
    expect(CURRENCIES.NGN.locale).toBe("en-NG");
    expect(CURRENCIES.CAD.locale).toBe("en-CA");
  });

  it("turns entered amounts into minor units, refusing a third decimal", () => {
    expect(toMinor(19.99, "USD")).toBe(1_999); // 19.99 * 100 is 1998.9999999999998 in floating point
    expect(toMinor(0.1 + 0.2, "GBP")).toBe(30);
    expect(toMinor(50_000, "NGN")).toBe(5_000_000);
    expect(toMinor(1.005, "USD")).toBeNull();
    expect(toMinor(Number.NaN, "CAD")).toBeNull();
  });

  it("converts fiat to zat and back, rounding to the nearest zatoshi", () => {
    expect(fiatMinorToZat(5_000_000, 60_000, "NGN")).toBe(83_333_333); // ₦50,000 at ₦60,000 per ZEC
    expect(fiatMinorToZat(4_000, 40, "USD")).toBe(100_000_000); // $40.00 at $40 per ZEC is exactly 1 ZEC
    expect(fiatMinorToZat(1, 1_203.37, "GBP")).toBe(831); // 1 penny
    expect(zatToFiatMinor(83_333_333, 60_000, "NGN")).toBe(5_000_000);
    expect(zatToFiatMinor(1_000_000, 1_203.37, "USD")).toBe(1_203); // $12.0337 -> $12.03
    expect(zatToFiatMinor(154_590_000, 1_600_000, "NGN")).toBe(247_344_000); // naira approximations are whole naira
    for (const zat of [1, 999, 123_456_789]) expect(Number.isInteger(zatToFiatMinor(zat, 1_234.56, "CAD"))).toBe(true);
  });

  it("checks per-currency payout and donation limits", () => {
    expect(checkAmount(499, "NGN", "payout")).toEqual({ error: "Amount must be between ₦500 and ₦5,000,000" });
    expect(checkAmount(500, "NGN", "payout")).toEqual({ minor: 50_000 });
    expect(checkAmount(5_000_001, "NGN", "payout")).toHaveProperty("error");
    expect(checkAmount(0.99, "USD", "payout")).toEqual({ error: "Amount must be between $1.00 and $5,000.00" });
    expect(checkAmount(5_000, "GBP", "payout")).toEqual({ minor: 500_000 });
    expect(checkAmount(5_000.01, "CAD", "payout")).toEqual({ error: "Amount must be between CA$1.00 and CA$5,000.00" });
    expect(checkAmount(12.345, "USD", "payout")).toEqual({ error: "Use at most 2 decimal places" });
    expect(checkAmount(10_000, "USD", "donation")).toEqual({ minor: 1_000_000 });
    expect(checkAmount(99, "NGN", "donation")).toHaveProperty("error");
  });
});

describe("mutex", () => {
  it("runs one operation at a time, in order", async () => {
    const m = new Mutex();
    const log: string[] = [];
    const task = (name: string, ms: number) =>
      m.runExclusive(async () => {
        log.push(`start ${name}`);
        await new Promise((r) => setTimeout(r, ms));
        log.push(`end ${name}`);
        return name;
      });
    const results = await Promise.all([task("a", 20), task("b", 1), task("c", 5)]);
    expect(results).toEqual(["a", "b", "c"]);
    expect(log).toEqual(["start a", "end a", "start b", "end b", "start c", "end c"]);
  });

  it("keeps going after a failure", async () => {
    const m = new Mutex();
    await expect(m.runExclusive(async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    await expect(m.runExclusive(async () => 42)).resolves.toBe(42);
  });

  it("times out", async () => {
    await expect(withTimeout(new Promise(() => {}), 10, () => new Error("timeout"))).rejects.toThrow("timeout");
  });
});

describe("logger redaction", () => {
  it("never writes secrets, PINs, tokens, passwords, addresses or account numbers", () => {
    let out = "";
    const sink = new Writable({
      write(chunk, _enc, cb) {
        out += chunk.toString();
        cb();
      },
    });
    const log = pino({ redact: { paths: REDACT_PATHS, censor: "[redacted]" } }, sink);
    log.info({
      req: { body: { pin: "123456" }, headers: { cookie: "asiri_session=abc" } },
      claim: { secret: "SECRET-VALUE", pin: "654321", claimToken: "TOKEN-VALUE", zcashAddress: "utest1ADDR", accountNumber: "0123456789" },
      login: { password: "hunter2" },
    });
    for (const leaked of ["123456", "abc", "SECRET-VALUE", "654321", "TOKEN-VALUE", "utest1ADDR", "0123456789", "hunter2"]) {
      expect(out).not.toContain(leaked);
    }
    expect(out).toContain("[redacted]");
  });
});
