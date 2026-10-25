import { describe, expect, it } from "vitest";
import { ZcashError, type ZcashAdapter } from "../zcash/adapter.js";
import { cacheAdapter } from "../zcash/cache.js";

function counting() {
  const calls: Record<string, number> = {};
  let spendable = 100;
  let failAddress = true;
  const hit = (k: string) => (calls[k] = (calls[k] ?? 0) + 1);
  const inner: ZcashAdapter = {
    network: "testnet",
    init: async () => {},
    sync: async () => void hit("sync"),
    getReceiveAddress: async () => {
      hit("address");
      if (failAddress) {
        failAddress = false;
        throw new ZcashError("unavailable");
      }
      return "utest1addr";
    },
    getUfvk: async () => (hit("ufvk"), "uviewtest1key"),
    getBalance: async () => (hit("balance"), { spendableZat: spendable, pendingZat: 0, totalZat: spendable }),
    listTransactions: async () => (hit("txs"), []),
    validateAddress: async () => (hit("validate"), true),
    send: async () => {
      hit("send");
      spendable -= 10;
      return { txid: "t" };
    },
  };
  return { inner, calls };
}

describe("cacheAdapter", () => {
  it("caches address and UFVK forever, but retries after a failure", async () => {
    const { inner, calls } = counting();
    const a = cacheAdapter(inner);
    await expect(a.getReceiveAddress()).rejects.toThrow();
    expect(await a.getReceiveAddress()).toBe("utest1addr");
    expect(await a.getReceiveAddress()).toBe("utest1addr");
    await a.getUfvk();
    await a.getUfvk();
    expect(calls).toMatchObject({ address: 2, ufvk: 1 });
  });

  it("caches balance for the TTL and invalidates it on sync and send", async () => {
    const { inner, calls } = counting();
    let t = 0;
    const a = cacheAdapter(inner, { balanceTtlMs: 1000, now: () => t });
    await a.getBalance();
    await a.getBalance();
    expect(calls.balance).toBe(1);
    t = 1500;
    await a.getBalance();
    expect(calls.balance).toBe(2);
    await a.send("utest1x", 10);
    expect((await a.getBalance()).spendableZat).toBe(90);
    await a.listTransactions();
    await a.listTransactions();
    await a.sync();
    await a.listTransactions();
    expect(calls).toMatchObject({ balance: 3, txs: 2, sync: 1, send: 1 });
  });
});
