import type { Network, WalletBalance, WalletTx, ZcashAdapter } from "./adapter.js";

export interface CacheOptions {
  /** How long a balance read stays fresh. Sync and send always invalidate it. */
  balanceTtlMs?: number;
  now?: () => number;
}

/**
 * Read-through cache placed OUTSIDE the mutex guard, so public pages do not queue behind a long
 * wallet sync just to show the treasury address or UFVK (both never change for a wallet).
 * Balance and transactions are cached until the next sync or send.
 */
export function cacheAdapter(inner: ZcashAdapter, opts: CacheOptions = {}): ZcashAdapter {
  const ttl = opts.balanceTtlMs ?? 15_000;
  const now = opts.now ?? (() => Date.now());
  let address: Promise<string> | null = null;
  let ufvk: Promise<string> | null = null;
  let balance: { value: Promise<WalletBalance>; at: number } | null = null;
  let txs: Promise<WalletTx[]> | null = null;

  /** Memoize a promise, but forget it if it rejects so the next call retries. */
  const remember = <T>(p: Promise<T>, forget: () => void): Promise<T> => {
    p.catch(forget);
    return p;
  };
  const invalidate = () => {
    balance = null;
    txs = null;
  };

  return {
    get network(): Network {
      return inner.network;
    },
    init: () => inner.init(),
    async sync() {
      try {
        await inner.sync();
      } finally {
        invalidate();
      }
    },
    getReceiveAddress: () => (address ??= remember(inner.getReceiveAddress(), () => (address = null))),
    getUfvk: () => (ufvk ??= remember(inner.getUfvk(), () => (ufvk = null))),
    getBalance() {
      if (!balance || now() - balance.at > ttl) {
        const value = remember(inner.getBalance(), () => (balance = null));
        balance = { value, at: now() };
      }
      return balance.value;
    },
    listTransactions: () => (txs ??= remember(inner.listTransactions(), () => (txs = null))),
    validateAddress: (a) => inner.validateAddress(a),
    async send(to, amountZat, memo) {
      try {
        return await inner.send(to, amountZat, memo);
      } finally {
        invalidate();
      }
    },
  };
}
