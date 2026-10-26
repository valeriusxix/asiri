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

  it("caches balance for the TTL, serves it stale while refreshing, and clears it on send", async () => {
    const { inner, calls } = counting();
    let t = 0;
    const a = cacheAdapter(inner, { balanceTtlMs: 1000, now: () => t });
    await a.getBalance();
    await a.getBalance();
    expect(calls.balance).toBe(1);
    t = 1500;
    expect((await a.getBalance()).spendableZat).toBe(100); // stale value at once, refresh behind it
    await Promise.resolve();
    expect(calls.balance).toBe(2);
    await a.send("utest1x", 10);
    expect((await a.getBalance()).spendableZat).toBe(90); // after a send the read waits for the real balance
    await a.listTransactions();
    await a.listTransactions();
    await a.sync();
    await a.listTransactions();
    expect(calls).toMatchObject({ balance: 3, txs: 2, sync: 1, send: 1 });
  });

  it("never makes a reader wait behind a long wallet operation once a balance is known", async () => {
    const { inner } = counting();
    const a = cacheAdapter(inner);
    await a.getBalance();
    let release!: () => void;
    inner.getBalance = () =>
      new Promise((resolve) => {
        release = () => resolve({ spendableZat: 77, pendingZat: 0, totalZat: 77 });
      });
    await a.sync(); // marks the balance stale
    expect((await a.getBalance()).spendableZat).toBe(100); // returns although the refresh is still blocked
    release();
    await new Promise((r) => setTimeout(r, 0));
    expect((await a.getBalance()).spendableZat).toBe(77);
  });

  it("drops a refresh that started before a send", async () => {
    const { inner } = counting();
    let t = 0;
    const a = cacheAdapter(inner, { balanceTtlMs: 1000, now: () => t });
    await a.getBalance();
    let release!: () => void;
    const original = inner.getBalance;
    inner.getBalance = () =>
      new Promise((resolve) => {
        release = () => resolve({ spendableZat: 100, pendingZat: 0, totalZat: 100 });
      });
    t = 1500;
    await a.getBalance(); // starts a refresh that will answer with the pre-send balance
    inner.getBalance = original;
    await a.send("utest1x", 10);
    release();
    await new Promise((r) => setTimeout(r, 0));
    expect((await a.getBalance()).spendableZat).toBe(90);
  });
});
