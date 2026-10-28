import { randomUUID } from "node:crypto";
import { audit, type DB } from "../db/db.js";
import { HttpError } from "../lib/http.js";
import { CURRENCIES, formatZatAs, type CurrencyCode } from "../lib/currency.js";
import type { AppContext } from "./context.js";
import { outstandingZat, periodTotals } from "./transparency.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Aggregates only: no ids, notes, memos or addresses ever go into a report (Agent.md Section 12). */
export interface ReportStats {
  fundName: string;
  periodStart: string;
  periodEnd: string;
  periodLabel: string;
  /** Lets the text say "the last 30 days" now that every number is checked (audit M2). */
  periodDays: number;
  /** Every amount below is pre-formatted in this currency (the fund currency) at this rate. */
  currency: CurrencyCode;
  currencyName: string;
  currencySymbol: string;
  rateZecFiat: number;
  donationsReceived: string;
  donationsCount: number;
  simulatedDonations: string;
  paidOut: string;
  paymentsCount: number;
  /** Part of paidOut / paymentsCount: demo cash-outs, where no real bank transfer happened (audit M1). */
  demoCashouts: string;
  demoCashoutsCount: number;
  waitingToBeClaimed: string;
  byCategory: { category: string; payments: number; amount: string }[];
}

export interface ReportRow {
  id: string;
  period_start: string;
  period_end: string;
  stats_json: string;
  body: string;
  generator: "claude" | "template";
  published: number;
  created_at: string;
  published_at: string | null;
}

export interface Report {
  id: string;
  periodStart: string;
  periodEnd: string;
  stats: ReportStats;
  body: string;
  generator: "claude" | "template";
  published: boolean;
  createdAt: string;
  publishedAt: string | null;
}

const dateLabel = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export function buildStats(ctx: AppContext, start: Date, end: Date, rateZecFiat: number, currency: CurrencyCode): ReportStats {
  // periodTotals' end is exclusive; +1 ms so events recorded at exactly `end` (now) are included.
  const t = periodTotals(ctx.db, start.toISOString(), new Date(end.getTime() + 1).toISOString());
  const fiat = (zat: number) => formatZatAs(zat, rateZecFiat, currency);
  return {
    fundName: ctx.env.FUND_NAME,
    periodStart: start.toISOString().slice(0, 10),
    periodEnd: end.toISOString().slice(0, 10),
    periodLabel: `${dateLabel(start)} to ${dateLabel(end)}`,
    periodDays: Math.round((end.getTime() - start.getTime()) / DAY_MS),
    currency,
    currencyName: CURRENCIES[currency].name,
    currencySymbol: CURRENCIES[currency].symbol,
    rateZecFiat,
    donationsReceived: fiat(t.receivedZat),
    donationsCount: t.donationsCount,
    simulatedDonations: fiat(t.simulatedZat),
    paidOut: fiat(t.paidOutZat),
    paymentsCount: t.payoutsCount,
    demoCashouts: fiat(t.demoCashoutZat),
    demoCashoutsCount: t.demoCashoutCount,
    waitingToBeClaimed: fiat(outstandingZat(ctx.db)),
    byCategory: t.byCategory.map((c) => ({ category: c.category, payments: c.count, amount: fiat(c.amountZat) })),
  };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Deterministic fallback text built only from the stats. */
export function templateReport(s: ReportStats): string {
  const parts: string[] = [];
  parts.push(`Here is the update from ${s.fundName} for ${s.periodLabel}.`);
  if (s.donationsCount > 0) {
    parts.push(`Thanks to you, the fund received ${s.donationsReceived} in ${plural(s.donationsCount, "donation", "donations")}.`);
  } else {
    parts.push("No new donations arrived in this period.");
  }
  if (s.paymentsCount > 0) {
    const cats = s.byCategory.map((c) => `${c.category} (${plural(c.payments, "payment", "payments")}, ${c.amount})`).join(", ");
    parts.push(
      `We sent ${s.paidOut} in ${plural(s.paymentsCount, "payment", "payments")} to people who needed help: ${cats}.`,
    );
    if (s.demoCashoutsCount > 0) {
      parts.push(
        `This includes ${s.demoCashouts} in ${plural(s.demoCashoutsCount, "demo cash-out", "demo cash-outs")}, where no real bank transfer happened.`,
      );
    }
  } else {
    parts.push("No payments were collected in this period.");
  }
  parts.push(`${s.waitingToBeClaimed} is set aside in payments that are waiting to be collected.`);
  parts.push("To keep everyone safe, we never share who received help.");
  parts.push("You can check every total yourself on our transparency page.");
  return parts.join(" ");
}

export function toReport(r: ReportRow): Report {
  return {
    id: r.id,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    stats: JSON.parse(r.stats_json) as ReportStats,
    body: r.body,
    generator: r.generator,
    published: r.published === 1,
    createdAt: r.created_at,
    publishedAt: r.published_at,
  };
}

/** Writes the text for a report. Replaced by the Claude-backed writer in M4. */
export type ReportWriter = (stats: ReportStats) => Promise<{ body: string; generator: "claude" | "template" }>;

export const templateWriter: ReportWriter = async (stats) => ({ body: templateReport(stats), generator: "template" });

export async function generateReport(ctx: AppContext, periodDays: number, writer: ReportWriter = templateWriter): Promise<Report> {
  const end = ctx.now();
  const start = new Date(end.getTime() - periodDays * DAY_MS);
  const quote = await ctx.price.get();
  const stats = buildStats(ctx, start, end, quote.rates[ctx.env.FUND_CURRENCY], ctx.env.FUND_CURRENCY);
  const { body, generator } = await writer(stats);
  const id = randomUUID();
  ctx.db
    .prepare(
      `INSERT INTO reports (id, period_start, period_end, stats_json, body, generator, published, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
    )
    .run(id, start.toISOString(), end.toISOString(), JSON.stringify(stats), body, generator, end.toISOString());
  audit(ctx.db, "report.generated", { id, generator }, end);
  return toReport(getReportRow(ctx.db, id)!);
}

function getReportRow(db: DB, id: string): ReportRow | undefined {
  return db.prepare(`SELECT * FROM reports WHERE id = ?`).get(id) as ReportRow | undefined;
}

export function publishReport(ctx: AppContext, id: string): Report {
  const now = ctx.now().toISOString();
  ctx.db.prepare(`UPDATE reports SET published = 1, published_at = COALESCE(published_at, ?) WHERE id = ?`).run(now, id);
  const row = getReportRow(ctx.db, id);
  if (!row) throw new HttpError(404, "not_found");
  audit(ctx.db, "report.published", { id }, ctx.now());
  return toReport(row);
}

export function listReports(db: DB): Report[] {
  return (db.prepare(`SELECT * FROM reports ORDER BY created_at DESC`).all() as ReportRow[]).map(toReport);
}
