import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  classifySendFailure,
  extractJson,
  isValidForNetwork,
  parseAddressCheck,
  parseAddresses,
  parseBalanceLines,
  parseHeight,
  parseReceiveAddress,
  parseSpendable,
  parseUfvk,
  parseValueTransfers,
  parseWalletBalance,
  toWalletTxs,
} from "../zcash/zingoParse.js";

/** Real zingo-cli 0.4.0 output captured on testnet (see docs/ZINGO_NOTES.md). */
const fx = (name: string) => readFileSync(new URL(`./fixtures/zingo/${name}`, import.meta.url), "utf8");

describe("zingoParse (fixtures from the real binary)", () => {
  it("extracts the JSON result from around the log lines", () => {
    expect(extractJson(fx("parse_address-1.txt"))).toMatchObject({ status: "success", address_kind: "unified" });
    expect(() => extractJson("Launching save task...\nno json here\n")).toThrow();
  });

  it("parses addresses and picks the Orchard unified address", () => {
    const list = parseAddresses(fx("empty-addresses.txt"));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ hasOrchard: true, index: 0 });
    expect(parseReceiveAddress(fx("empty-addresses.txt"))).toMatch(/^utest1[a-z0-9]{100,}$/);
  });

  it("parses the non-JSON balance listing per pool", () => {
    const pools = parseBalanceLines(fx("empty-balance.txt"));
    expect(Object.keys(pools).sort()).toEqual(["ironwood", "orchard", "sapling", "transparent"]);
    expect(pools.orchard).toEqual({ confirmed: 0, unconfirmed: 0, total: 0 });
    expect(() => parseBalanceLines("Launching save task...\n")).toThrow();
  });

  it("parses spendable balance and combines it into a WalletBalance", () => {
    expect(parseSpendable(fx("empty-spendable_balance.txt"))).toBe(0);
    expect(parseWalletBalance(fx("empty-balance.txt"), fx("empty-spendable_balance.txt"))).toEqual({
      spendableZat: 0,
      pendingZat: 0,
      totalZat: 0,
    });
    const synthetic = "[\n    confirmed_orchard_balance: 500\n    unconfirmed_orchard_balance: 125\n    total_orchard_balance: 625\n]";
    expect(parseWalletBalance(synthetic, '{\n  "spendable_balance": 500\n}')).toEqual({ spendableZat: 500, pendingZat: 125, totalZat: 625 });
  });

  it("parses the exported UFVK and birthday", () => {
    const { ufvk, birthday } = parseUfvk(fx("empty-export_ufvk.txt"));
    expect(ufvk).toMatch(/^uviewtest1/);
    expect(birthday).toBe(4133900);
  });

  it("parses height", () => {
    expect(parseHeight(fx("empty-height.txt"))).toBe(0);
  });

  it("parses a funded balance, whose amounts carry digit separators", () => {
    expect(parseBalanceLines(fx("funded-balance.txt")).ironwood).toEqual({ confirmed: 100_000_000, unconfirmed: 0, total: 100_000_000 });
    expect(parseWalletBalance(fx("funded-balance.txt"), fx("funded-spendable_balance.txt"))).toEqual({
      spendableZat: 100_000_000,
      pendingZat: 0,
      totalZat: 100_000_000,
    });
  });

  it("parses value_transfers, including a memo that spans lines", () => {
    const vts = parseValueTransfers(fx("funded-value_transfers.txt"));
    expect(vts).toEqual([
      {
        txid: "4b2e0785004efeca09d817cfcdf08215443f42e69c5c7f67d753ab8a0145e9f8",
        datetime: "2026-10-26T21:17:55.000Z",
        status: "confirmed",
        blockheight: 4_545_263,
        feeZat: 15_000,
        kind: "received",
        valueZat: 100_000_000,
        memos: ["fauzec/v1\n01M5X15XYRGKQ1M7FYH078ANAD\n1793135826149\nhttps://fauzec.com/help"],
      },
    ]);
    expect(toWalletTxs(vts)).toEqual([
      {
        txid: "4b2e0785004efeca09d817cfcdf08215443f42e69c5c7f67d753ab8a0145e9f8",
        direction: "in",
        amountZat: 100_000_000,
        feeZat: 15_000,
        memo: "fauzec/v1\n01M5X15XYRGKQ1M7FYH078ANAD\n1793135826149\nhttps://fauzec.com/help",
        blockHeight: 4_545_263,
        timestamp: "2026-10-26T21:17:55.000Z",
      },
    ]);
    expect(parseValueTransfers(fx("empty-value_transfers.txt"))).toEqual([]);
  });

  it("only counts confirmed receives as donations and skips self-sends", () => {
    const [vt] = parseValueTransfers(fx("funded-value_transfers.txt"));
    const base = vt!;
    expect(toWalletTxs([{ ...base, status: "mempool" }])).toEqual([]);
    expect(toWalletTxs([{ ...base, kind: "shield" }])).toEqual([]);
    const sent = toWalletTxs([
      { ...base, kind: "sent", status: "transmitted", valueZat: 300_000 },
      { ...base, kind: "sent", status: "transmitted", valueZat: 200_000 },
    ]);
    expect(sent).toEqual([expect.objectContaining({ direction: "out", amountZat: 500_000, feeZat: 15_000 })]);
    expect(sent[0]).not.toHaveProperty("memo");
    expect(toWalletTxs([{ ...base, kind: "sent", status: "failed" }])).toEqual([]);
  });

  it("parses the height printed after an online --waitsync sync", () => {
    expect(parseHeight(fx("waitsync-height.txt"))).toBe(4_542_152);
  });

  it("classifies a failed quicksend from its stderr", () => {
    const stderr = fx("quicksend-insufficient.stderr.txt");
    expect(stderr).toContain("Insufficient balance (have 0, need 20000 including fee)");
    expect(classifySendFailure(stderr, 10_000)).toBe("insufficient_funds");
    expect(classifySendFailure("caused by: Insufficient balance (have 15000, need 20000 including fee)", 10_000)).toBe(
      "insufficient_funds_for_fee",
    );
    expect(classifySendFailure("Error: something else", 10_000)).toBe("send_failed");
  });

  it("validates addresses per network with parse_address", () => {
    expect(parseAddressCheck(fx("parse_address-1.txt"))).toEqual({ valid: true, chainName: "test", kind: "unified" });
    expect(parseAddressCheck(fx("parse_address-2.txt"))).toEqual({ valid: true, chainName: "test", kind: "sapling" });
    expect(parseAddressCheck(fx("parse_address-3.txt"))).toEqual({ valid: true, chainName: "test", kind: "transparent" });
    expect(parseAddressCheck(fx("parse_address-5.txt"))).toEqual({ valid: false, chainName: null, kind: null });
    expect(isValidForNetwork(fx("parse_address-1.txt"), "testnet")).toBe(true);
    expect(isValidForNetwork(fx("parse_address-1.txt"), "mainnet")).toBe(false);
    expect(isValidForNetwork(fx("parse_address-4.txt"), "testnet")).toBe(false);
  });
});
