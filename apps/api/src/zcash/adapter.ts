import { Mutex, withTimeout } from "../lib/mutex.js";

export type Network = "testnet" | "mainnet";

export interface WalletBalance {
  spendableZat: number; // confirmed & spendable now
  pendingZat: number; // received but not yet spendable
  totalZat: number;
}

export interface WalletTx {
  txid: string;
  direction: "in" | "out";
  amountZat: number; // positive; for "out" this is value sent to others (excluding change)
  feeZat?: number;
  memo?: string;
  blockHeight?: number;
  timestamp?: string; // ISO
}

export interface ZcashAdapter {
  readonly network: Network;
  init(): Promise<void>; // open or create the treasury wallet
  sync(): Promise<void>;
  getReceiveAddress(): Promise<string>; // unified address (orchard receiver at minimum)
  getUfvk(): Promise<string>;
  getBalance(): Promise<WalletBalance>;
  listTransactions(): Promise<WalletTx[]>;
  validateAddress(address: string): Promise<boolean>;
  send(toAddress: string, amountZat: number, memo?: string): Promise<{ txid: string }>;
}

export type ZcashErrorCode =
  | "insufficient_funds"
  | "insufficient_funds_for_fee"
  | "funds_pending"
  | "invalid_address"
  | "timeout"
  | "unavailable"
  | "send_failed";

const SAFE_MESSAGES: Record<ZcashErrorCode, string> = {
  insufficient_funds: "The treasury does not have enough spendable funds.",
  insufficient_funds_for_fee: "The treasury cannot cover the network fee.",
  funds_pending: "Funds are not spendable yet. Try again in a few minutes.",
  invalid_address: "That address is not valid for this network.",
  timeout: "The wallet did not respond in time.",
  unavailable: "The wallet is unavailable.",
  send_failed: "The payment could not be sent.",
};

/** Typed wallet error. `message` is always safe to show and log (no addresses, seeds, or CLI args). */
export class ZcashError extends Error {
  constructor(
    readonly code: ZcashErrorCode,
    message: string = SAFE_MESSAGES[code],
  ) {
    super(message);
    this.name = "ZcashError";
  }
}

export interface GuardTimeouts {
  syncMs: number;
  otherMs: number;
}

const DEFAULT_TIMEOUTS: GuardTimeouts = { syncMs: 10 * 60_000, otherMs: 2 * 60_000 };

/**
 * Wraps an adapter so every call goes through one mutex (one wallet operation at a time)
 * and has a timeout. Non-ZcashError failures are replaced by a safe `unavailable` error.
 */
export function guardAdapter(inner: ZcashAdapter, timeouts: GuardTimeouts = DEFAULT_TIMEOUTS): ZcashAdapter {
  const mutex = new Mutex();
  const run = <T>(fn: () => Promise<T>, ms: number): Promise<T> =>
    mutex
      .runExclusive(() => withTimeout(fn(), ms, () => new ZcashError("timeout")))
      .catch((err: unknown) => {
        throw err instanceof ZcashError ? err : new ZcashError("unavailable");
      });
  const t = timeouts.otherMs;
  return {
    network: inner.network,
    init: () => run(() => inner.init(), timeouts.syncMs),
    sync: () => run(() => inner.sync(), timeouts.syncMs),
    getReceiveAddress: () => run(() => inner.getReceiveAddress(), t),
    getUfvk: () => run(() => inner.getUfvk(), t),
    getBalance: () => run(() => inner.getBalance(), t),
    listTransactions: () => run(() => inner.listTransactions(), t),
    validateAddress: (address) => run(() => inner.validateAddress(address), t),
    send: (to, amountZat, memo) => run(() => inner.send(to, amountZat, memo), t),
  };
}
