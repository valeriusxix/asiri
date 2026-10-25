import { randomUUID } from "node:crypto";
import { audit, type DB } from "../db/db.js";
import { formatNgn, formatZec, ngnToZat, zatToNgn } from "../lib/money.js";
import type { AppContext } from "./context.js";

export interface DonationRow {
  id: string;
  source: "zcash" | "simulated";
  txid: string | null;
  amount_zat: number;
  memo: string | null;
  observed_at: string;
}

/** Imports incoming wallet transactions as `zcash` donations. Idempotent (txid is unique). Returns the count added. */
export async function importFromWallet(ctx: AppContext): Promise<number> {
  const txs = await ctx.adapter.listTransactions();
  const insert = ctx.db.prepare(
    `INSERT OR IGNORE INTO donations (id, source, txid, amount_zat, memo, observed_at) VALUES (?, 'zcash', ?, ?, ?, ?)`,
  );
  const now = ctx.now().toISOString();
  let added = 0;
  ctx.db.transaction(() => {
    for (const tx of txs) {
      if (tx.direction !== "in" || tx.amountZat <= 0) continue;
      added += insert.run(randomUUID(), tx.txid, tx.amountZat, tx.memo ?? null, tx.timestamp ?? now).changes;
    }
  })();
  return added;
}

/** DEMO_MODE card/bank donation: recorded as `simulated`, never counted as raised. */
export async function simulateDonation(ctx: AppContext, amountNgn: number): Promise<{ donationId: string; amountZat: number }> {
  const quote = await ctx.price.get();
  const amountZat = ngnToZat(amountNgn, quote.zecNgn);
  const id = randomUUID();
  const now = ctx.now();
  ctx.db
    .prepare(`INSERT INTO donations (id, source, txid, amount_zat, memo, observed_at) VALUES (?, 'simulated', NULL, ?, NULL, ?)`)
    .run(id, amountZat, now.toISOString());
  audit(ctx.db, "donation.simulated", { id, amountZat }, now);
  return { donationId: id, amountZat };
}

export interface AdminDonation {
  id: string;
  source: "zcash" | "simulated";
  txid: string | null;
  amountZat: number;
  amountZecDisplay: string;
  amountNgnDisplay: string;
  memo: string | null;
  observedAt: string;
}

export function listDonations(db: DB, zecNgn: number): AdminDonation[] {
  const rows = db.prepare(`SELECT * FROM donations ORDER BY observed_at DESC, id`).all() as DonationRow[];
  return rows.map((r) => ({
    id: r.id,
    source: r.source,
    txid: r.txid,
    amountZat: r.amount_zat,
    amountZecDisplay: formatZec(r.amount_zat, 8),
    amountNgnDisplay: formatNgn(zatToNgn(r.amount_zat, zecNgn)),
    memo: r.memo,
    observedAt: r.observed_at,
  }));
}
