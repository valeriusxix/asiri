import { describe, expect, it } from "vitest";
import { buildPaymentUri } from "../zcash/zip321.js";

const ADDR = "utest1abcdefghijklmnopqrstuvwxyz0123456789";

describe("buildPaymentUri (ZIP-321)", () => {
  it("builds a bare address URI", () => {
    expect(buildPaymentUri({ address: ADDR })).toBe(`zcash:${ADDR}`);
  });

  it("encodes amount as decimal ZEC without trailing zeros", () => {
    expect(buildPaymentUri({ address: ADDR, amountZat: 150_000_000 })).toBe(`zcash:${ADDR}?amount=1.5`);
    expect(buildPaymentUri({ address: ADDR, amountZat: 1 })).toBe(`zcash:${ADDR}?amount=0.00000001`);
    expect(buildPaymentUri({ address: ADDR, amountZat: 200_000_000 })).toBe(`zcash:${ADDR}?amount=2`);
  });

  it("encodes memo as base64url of UTF-8 without padding", () => {
    // "Thank you €" -> UTF-8 bytes (€ is 3 bytes) -> base64url
    const memo = "Thank you €";
    const expected = Buffer.from(memo, "utf8").toString("base64url");
    expect(expected).not.toContain("=");
    const uri = buildPaymentUri({ address: ADDR, memo });
    expect(uri).toBe(`zcash:${ADDR}?memo=${expected}`);
    expect(Buffer.from(uri.split("memo=")[1]!, "base64url").toString("utf8")).toBe(memo);
  });

  it("url-encodes the message and orders params amount, memo, message", () => {
    const uri = buildPaymentUri({ address: ADDR, amountZat: 10_000_000, memo: "hi", message: "Donation to Relief Fund & co" });
    expect(uri).toBe(`zcash:${ADDR}?amount=0.1&memo=aGk&message=Donation%20to%20Relief%20Fund%20%26%20co`);
  });

  it("rejects memos over 512 bytes and bad amounts", () => {
    expect(() => buildPaymentUri({ address: ADDR, memo: "a".repeat(513) })).toThrow(/512/);
    expect(() => buildPaymentUri({ address: ADDR, memo: "€".repeat(171) })).toThrow(/512/); // 3 bytes each = 513
    expect(() => buildPaymentUri({ address: ADDR, memo: "a".repeat(512) })).not.toThrow();
    expect(() => buildPaymentUri({ address: ADDR, amountZat: 0 })).toThrow();
    expect(() => buildPaymentUri({ address: ADDR, amountZat: 1.5 })).toThrow();
  });
});
