// Pure parsers for zingo-cli 0.4.0 (zingolib_v7.0.0) one-shot output.
// Every format here was captured from the real binary; see docs/ZINGO_NOTES.md and
// apps/api/src/test/fixtures/zingo/*.txt. Do not add a parser without a captured fixture.

import { ZcashError, type Network, type WalletBalance, type ZcashErrorCode } from "./adapter.js";

/**
 * zingo-cli prints plain log lines ("Launching save task...", "Save task shutdown successfully.")
 * around a command's JSON result. Returns the JSON value: the span from the first line that starts
 * with `{` or `[` to the last line that ends with `}` or `]`.
 */
export function extractJson(stdout: string): unknown {
  const lines = stdout.split(/\r?\n/);
  const start = lines.findIndex((l) => /^\s*[[{]/.test(l));
  let end = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/[\]}]\s*$/.test(lines[i]!)) {
      end = i;
      break;
    }
  }
  if (start === -1 || end < start) throw new ZcashError("unavailable", "Unexpected wallet output.");
  try {
    return JSON.parse(lines.slice(start, end + 1).join("\n")) as unknown;
  } catch {
    throw new ZcashError("unavailable", "Unexpected wallet output.");
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** `addresses`: JSON array of { account, address_index, has_orchard, has_sapling, has_transparent, encoded_address }. */
export function parseAddresses(stdout: string): { address: string; hasOrchard: boolean; index: number }[] {
  const data = extractJson(stdout);
  if (!Array.isArray(data)) throw new ZcashError("unavailable", "Unexpected addresses output.");
  return data.filter(isObject).map((a) => ({
    address: String(a.encoded_address),
    hasOrchard: a.has_orchard === true,
    index: Number(a.address_index ?? 0),
  }));
}

/** The treasury receive address: the first unified address with an Orchard receiver. */
export function parseReceiveAddress(stdout: string): string {
  const list = parseAddresses(stdout).sort((a, b) => a.index - b.index);
  const ua = list.find((a) => a.hasOrchard) ?? list[0];
  if (!ua) throw new ZcashError("unavailable", "The wallet has no address yet.");
  return ua.address;
}

/**
 * `balance` is NOT JSON. It prints a bracketed list of `<state>_<pool>_balance: <zat>` lines, with
 * state = confirmed | unconfirmed | total and pool = ironwood | orchard | sapling | transparent.
 */
export function parseBalanceLines(stdout: string): Record<string, Record<"confirmed" | "unconfirmed" | "total", number>> {
  const pools: Record<string, Record<"confirmed" | "unconfirmed" | "total", number>> = {};
  for (const m of stdout.matchAll(/^\s*(confirmed|unconfirmed|total)_([a-z]+)_balance:\s*(\d+)\s*$/gm)) {
    const [, state, pool, value] = m as unknown as [string, "confirmed" | "unconfirmed" | "total", string, string];
    pools[pool] ??= { confirmed: 0, unconfirmed: 0, total: 0 };
    pools[pool][state] = Number(value);
  }
  if (Object.keys(pools).length === 0) throw new ZcashError("unavailable", "Unexpected balance output.");
  return pools;
}

/** `spendable_balance`: { "spendable_balance": <zat> }. */
export function parseSpendable(stdout: string): number {
  const data = extractJson(stdout);
  if (!isObject(data) || typeof data.spendable_balance !== "number") throw new ZcashError("unavailable", "Unexpected spendable balance output.");
  return data.spendable_balance;
}

/**
 * Wallet balance from `balance` + `spendable_balance` outputs. Spendable is what the wallet will
 * actually spend now; pending is everything received but unconfirmed, across all pools.
 */
export function parseWalletBalance(balanceStdout: string, spendableStdout: string): WalletBalance {
  const pools = parseBalanceLines(balanceStdout);
  const sum = (k: "unconfirmed" | "total") => Object.values(pools).reduce((acc, p) => acc + p[k], 0);
  return { spendableZat: parseSpendable(spendableStdout), pendingZat: sum("unconfirmed"), totalZat: sum("total") };
}

/** `export_ufvk`: { "ufvk": "uview…", "birthday": <height> }. */
export function parseUfvk(stdout: string): { ufvk: string; birthday: number } {
  const data = extractJson(stdout);
  if (!isObject(data) || typeof data.ufvk !== "string") throw new ZcashError("unavailable", "Unexpected viewing key output.");
  return { ufvk: data.ufvk, birthday: Number(data.birthday) };
}

/** `height`: { "height": <n> }. */
export function parseHeight(stdout: string): number {
  const data = extractJson(stdout);
  if (!isObject(data) || typeof data.height !== "number") throw new ZcashError("unavailable", "Unexpected height output.");
  return data.height;
}

/**
 * `parse_address <addr>`: always exits 0. Valid: { status: "success", chain_name: "test"|"main", address_kind, … }.
 * Invalid: { status: "Invalid address", chain_name: null, address_kind: null }.
 */
export function parseAddressCheck(stdout: string): { valid: boolean; chainName: string | null; kind: string | null } {
  const data = extractJson(stdout);
  if (!isObject(data)) throw new ZcashError("unavailable", "Unexpected address check output.");
  return {
    valid: data.status === "success",
    chainName: typeof data.chain_name === "string" ? data.chain_name : null,
    kind: typeof data.address_kind === "string" ? data.address_kind : null,
  };
}

const CHAIN_NAME: Record<Network, string> = { testnet: "test", mainnet: "main" };

export function isValidForNetwork(stdout: string, network: Network): boolean {
  const r = parseAddressCheck(stdout);
  return r.valid && r.chainName === CHAIN_NAME[network];
}

/**
 * A failed `quicksend` exits 1 and explains itself on stderr, for example
 * "caused by: Insufficient balance (have 0, need 20000 including fee)". `need` includes the fee, so when the wallet
 * has the amount but not the fee, the fee is the problem.
 */
export function classifySendFailure(stderr: string, amountZat: number): ZcashErrorCode {
  const m = /Insufficient balance \(have (\d+), need (\d+) including fee\)/.exec(stderr);
  if (m) return Number(m[1]) >= amountZat ? "insufficient_funds_for_fee" : "insufficient_funds";
  return "send_failed";
}
