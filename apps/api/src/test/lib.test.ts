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
import { formatNgn, formatZec, ngnToZat, zatToNgn, zatToZecString } from "../lib/money.js";
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

  it("formats display strings", () => {
    expect(formatNgn(50_000)).toBe("₦50,000");
    expect(formatNgn(1_234_567.6)).toBe("₦1,234,568");
    expect(formatZec(83_333_333)).toBe("0.8333 ZEC");
    expect(formatZec(83_333_333, 8)).toBe("0.83333333 ZEC");
    expect(formatZec(100_000_000)).toBe("1.00 ZEC");
  });

  it("converts naira to zat and back", () => {
    expect(ngnToZat(50_000, 60_000)).toBe(83_333_333);
    expect(zatToNgn(83_333_333, 60_000)).toBe(50_000);
    expect(Number.isInteger(ngnToZat(12_345, 61_234.56))).toBe(true);
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
