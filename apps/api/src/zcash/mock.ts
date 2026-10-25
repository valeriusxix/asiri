import { createHash, randomBytes } from "node:crypto";
import type { DB } from "../db/db.js";
import { ZcashError, type Network, type WalletBalance, type WalletTx, type ZcashAdapter } from "./adapter.js";

export const MOCK_FEE_ZAT = 10_000;
const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

/** Deterministic fake bech32-looking string so the mock address/UFVK stay stable across restarts. */
function fakeBech32(seed: string, length: number): string {
  let out = "";
  let counter = 0;
  while (out.length < length) {
    for (const b of createHash("sha256").update(`${seed}:${counter++}`).digest()) {
      out += BECH32_CHARSET[b % 32];
      if (out.length === length) break;
    }
  }
  return out;
}

const PREFIXES: Record<Network, { address: string; ufvk: string; valid: string[] }> = {
  testnet: { address: "utest1mock", ufvk: "uviewtest1mock", valid: ["utest1", "ztestsapling1", "tm"] },
  mainnet: { address: "u1mock", ufvk: "uview1mock", valid: ["u1", "zs1", "t1"] },
};

/** The mock never stores a recipient address (Agent.md rule 6): only a short one-way fingerprint. */
export function addressFingerprint(address: string): string {
  return `sha256:${createHash("sha256").update(address).digest("hex").slice(0, 16)}`;
}

interface LedgerRow {
  txid: string;
  direction: "in" | "out";
  amount_zat: number;
  fee_zat: number;
  memo: string | null;
  created_at: string;
}

/** Records an incoming payment in the mock ledger (used by /api/dev/mock-donate and the demo seed). */
export function mockReceive(db: DB, amountZat: number, opts: { memo?: string; at?: Date } = {}): { txid: string } {
  const txid = randomBytes(32).toString("hex");
  db.prepare(
    `INSERT INTO mock_ledger (txid, direction, amount_zat, fee_zat, to_address, memo, created_at)
     VALUES (?, 'in', ?, 0, NULL, ?, ?)`,
  ).run(txid, amountZat, opts.memo ?? null, (opts.at ?? new Date()).toISOString());
  return { txid };
}

/** ZcashAdapter backed by the `mock_ledger` table. No chain, no network. */
export class MockAdapter implements ZcashAdapter {
  private readonly syncDelayMs: number;
  private readonly now: () => Date;

  constructor(
    private readonly db: DB,
    readonly network: Network,
    opts: { syncDelayMs?: number; now?: () => Date } = {},
  ) {
    this.syncDelayMs = opts.syncDelayMs ?? 300;
    this.now = opts.now ?? (() => new Date());
  }

  async init(): Promise<void> {}

  async sync(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, this.syncDelayMs));
  }

  async getReceiveAddress(): Promise<string> {
    const p = PREFIXES[this.network].address;
    return p + fakeBech32(`address:${this.network}`, 96);
  }

  async getUfvk(): Promise<string> {
    const p = PREFIXES[this.network].ufvk;
    return p + fakeBech32(`ufvk:${this.network}`, 240);
  }

  async getBalance(): Promise<WalletBalance> {
    const spendable = this.spendable();
    return { spendableZat: spendable, pendingZat: 0, totalZat: spendable };
  }

  async listTransactions(): Promise<WalletTx[]> {
    const rows = this.db
      .prepare(`SELECT txid, direction, amount_zat, fee_zat, memo, created_at FROM mock_ledger ORDER BY id`)
      .all() as LedgerRow[];
    return rows.map((r) => ({
      txid: r.txid,
      direction: r.direction,
      amountZat: r.amount_zat,
      feeZat: r.fee_zat || undefined,
      memo: r.memo ?? undefined,
      timestamp: r.created_at,
    }));
  }

  async validateAddress(address: string): Promise<boolean> {
    return address.length >= 30 && PREFIXES[this.network].valid.some((p) => address.startsWith(p));
  }

  async send(toAddress: string, amountZat: number, memo?: string): Promise<{ txid: string }> {
    if (!(await this.validateAddress(toAddress))) throw new ZcashError("invalid_address");
    if (this.spendable() < amountZat + MOCK_FEE_ZAT) throw new ZcashError("insufficient_funds");
    const txid = randomBytes(32).toString("hex");
    this.db
      .prepare(
        `INSERT INTO mock_ledger (txid, direction, amount_zat, fee_zat, to_address, memo, created_at)
         VALUES (?, 'out', ?, ?, ?, ?, ?)`,
      )
      .run(txid, amountZat, MOCK_FEE_ZAT, addressFingerprint(toAddress), memo ?? null, this.now().toISOString());
    return { txid };
  }

  private spendable(): number {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN direction = 'in' THEN amount_zat ELSE -(amount_zat + fee_zat) END), 0) AS v
         FROM mock_ledger`,
      )
      .get() as { v: number };
    return row.v;
  }
}
