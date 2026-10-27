import type { DB } from "../db/db.js";
import type { AppContext } from "./context.js";
import type { Network } from "../zcash/adapter.js";

export const VERIFY_HINT =
  "This is the fund's viewing key. Import it into a Zcash wallet that supports viewing keys to see every incoming and outgoing payment amount. It cannot spend money and it does not reveal who anyone is.";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface CategoryTotal {
  category: string;
  count: number;
  amountZat: number;
}

export interface WeekTotal {
  weekStart: string;
  receivedZat: number;
  paidOutZat: number;
}

export interface Transparency {
  fundName: string;
  network: Network;
  /** "mock": the totals and the viewing key are placeholders, and the web app labels them Demo (audit H2). */
  mode: "mock" | "zingo";
  currency: { zecNgn: number; source: string };
  totals: {
    receivedZat: number;
    simulatedZat: number;
    paidOutZat: number;
    outstandingZat: number;
    payoutsCount: number;
  };
  byCategory: CategoryTotal[];
  weekly: WeekTotal[];
  /** `stats` lets the public card show the exact numbers beside the text (Agent.md Section 12). */
  latestReport: { body: string; periodStart: string; periodEnd: string; publishedAt: string; stats: unknown } | null;
  ufvk: string;
  verifyHint: string;
  updatedAt: string;
}

/** Monday 00:00 UTC of the week containing `d` (D-012). */
export function weekStartUtc(d: Date): Date {
  const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  return new Date(day.getTime() - ((day.getUTCDay() + 6) % 7) * DAY_MS);
}

const sum = (db: DB, sql: string, ...params: unknown[]): number => (db.prepare(sql).get(...params) as { v: number }).v;

/** Aggregates over a time window (ISO strings, start inclusive, end exclusive). Used by reports too. */
export function periodTotals(db: DB, startIso: string, endIso: string) {
  return {
    receivedZat: sum(
      db,
      `SELECT COALESCE(SUM(amount_zat),0) v FROM donations WHERE source='zcash' AND observed_at >= ? AND observed_at < ?`,
      startIso,
      endIso,
    ),
    donationsCount: sum(
      db,
      `SELECT COUNT(*) v FROM donations WHERE source='zcash' AND observed_at >= ? AND observed_at < ?`,
      startIso,
      endIso,
    ),
    simulatedZat: sum(
      db,
      `SELECT COALESCE(SUM(amount_zat),0) v FROM donations WHERE source='simulated' AND observed_at >= ? AND observed_at < ?`,
      startIso,
      endIso,
    ),
    paidOutZat: sum(
      db,
      `SELECT COALESCE(SUM(amount_zat),0) v FROM payouts WHERE status='claimed' AND claimed_at >= ? AND claimed_at < ?`,
      startIso,
      endIso,
    ),
    payoutsCount: sum(db, `SELECT COUNT(*) v FROM payouts WHERE status='claimed' AND claimed_at >= ? AND claimed_at < ?`, startIso, endIso),
    byCategory: categoryTotals(db, startIso, endIso),
  };
}

/** Money waiting in open links (amount only, without the fee buffer). */
export function outstandingZat(db: DB): number {
  return sum(db, `SELECT COALESCE(SUM(amount_zat),0) v FROM payouts WHERE status IN ('active','claiming','locked')`);
}

function categoryTotals(db: DB, startIso: string, endIso: string): CategoryTotal[] {
  return db
    .prepare(
      `SELECT category, COUNT(*) AS count, COALESCE(SUM(amount_zat),0) AS amountZat FROM payouts
       WHERE status='claimed' AND claimed_at >= ? AND claimed_at < ?
       GROUP BY category ORDER BY amountZat DESC, category`,
    )
    .all(startIso, endIso) as CategoryTotal[];
}

export function latestPublishedReport(db: DB): Transparency["latestReport"] {
  const row = db
    .prepare(
      `SELECT body, period_start, period_end, published_at, stats_json FROM reports WHERE published = 1
       ORDER BY published_at DESC, created_at DESC LIMIT 1`,
    )
    .get() as { body: string; period_start: string; period_end: string; published_at: string; stats_json: string } | undefined;
  return row
    ? {
        body: row.body,
        periodStart: row.period_start,
        periodEnd: row.period_end,
        publishedAt: row.published_at,
        stats: JSON.parse(row.stats_json) as unknown,
      }
    : null;
}

export async function getTransparency(ctx: AppContext): Promise<Transparency> {
  const { db, env } = ctx;
  const now = ctx.now();
  const quote = await ctx.price.get();
  const all = periodTotals(db, "0000", "9999");

  const firstWeek = new Date(weekStartUtc(now).getTime() - 7 * 7 * DAY_MS);
  const weekly: WeekTotal[] = [];
  for (let i = 0; i < 8; i++) {
    const start = new Date(firstWeek.getTime() + i * 7 * DAY_MS);
    const end = new Date(start.getTime() + 7 * DAY_MS);
    const t = periodTotals(db, start.toISOString(), end.toISOString());
    weekly.push({ weekStart: start.toISOString().slice(0, 10), receivedZat: t.receivedZat, paidOutZat: t.paidOutZat });
  }

  return {
    fundName: env.FUND_NAME,
    network: env.ZCASH_NETWORK,
    mode: env.ZCASH_MODE,
    currency: { zecNgn: quote.zecNgn, source: quote.source },
    totals: {
      receivedZat: all.receivedZat,
      simulatedZat: all.simulatedZat,
      paidOutZat: all.paidOutZat,
      outstandingZat: outstandingZat(db),
      payoutsCount: all.payoutsCount,
    },
    byCategory: all.byCategory,
    weekly,
    latestReport: latestPublishedReport(db),
    ufvk: await ctx.adapter.getUfvk(),
    verifyHint: VERIFY_HINT,
    updatedAt: now.toISOString(),
  };
}
