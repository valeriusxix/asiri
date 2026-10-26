import type { Network, WalletBalance, WalletTx, ZcashAdapter } from "./adapter.js";

export interface CacheOptions {
  /** How long a balance read stays fresh. Sync and send always invalidate it. */
  balanceTtlMs?: number;
  now?: () => number;
}

/**
 * Read-through cache placed OUTSIDE the mutex guard, so pages do not queue behind a long wallet sync (minutes on
 * testnet) just to show the treasury address or UFVK (both never change for a wallet) or the balance.
 * - Balance: fresh for `balanceTtlMs`. After that, or after a sync, the last known value is served at once while one
 *   refresh runs behind it. A send clears it, because a stale pre-send balance would overstate what is available
 *   for new payouts. The next read then waits, and the wallet is free right after a send.
 * - Transactions: cached until the next sync or send.
 */
export function cacheAdapter(inner: ZcashAdapter, opts: CacheOptions = {}): ZcashAdapter {
  const ttl = opts.balanceTtlMs ?? 15_000;
  const now = opts.now ?? (() => Date.now());
  let address: Promise<string> | null = null;
  let ufvk: Promise<string> | null = null;
  let balance: { value: WalletBalance; at: number } | null = null;
  let loading: Promise<WalletBalance> | null = null;
  let txs: Promise<WalletTx[]> | null = null;
  /** Bumped by every send, so a refresh that started before the send cannot store its pre-send result. */
  let generation = 0;

  /** Memoize a promise, but forget it if it rejects so the next call retries. */
  const remember = <T>(p: Promise<T>, forget: () => void): Promise<T> => {
    p.catch(forget);
    return p;
  };
  const loadBalance = (): Promise<WalletBalance> => {
    const gen = generation;
    loading ??= inner
      .getBalance()
      .then((value) => {
        if (gen === generation) balance = { value, at: now() };
        return value;
      })
      .finally(() => {
        loading = null;
      });
    return loading;
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
        if (balance) balance.at = -Infinity;
        txs = null;
      }
    },
    getReceiveAddress: () => (address ??= remember(inner.getReceiveAddress(), () => (address = null))),
    getUfvk: () => (ufvk ??= remember(inner.getUfvk(), () => (ufvk = null))),
    getBalance() {
      if (!balance) return loadBalance();
      if (now() - balance.at > ttl) loadBalance().catch(() => {});
      return Promise.resolve(balance.value);
    },
    listTransactions: () => (txs ??= remember(inner.listTransactions(), () => (txs = null))),
    validateAddress: (a) => inner.validateAddress(a),
    async send(to, amountZat, memo) {
      try {
        return await inner.send(to, amountZat, memo);
      } finally {
        generation++;
        balance = null;
        loading = null;
        txs = null;
      }
    },
  };
}
