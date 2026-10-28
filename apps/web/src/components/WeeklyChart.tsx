import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import { transparencyCopy as t } from "../copy";
import { compactMoney, formatMoney, zatToFiatMinor, type CurrencyCode } from "../currency";
import { formatWeek, formatZec } from "../format";
import type { Transparency } from "../types";

// Two categorical slots, validated with the dataviz palette checker on the white card surface
// (CVD ΔE 26.6, normal-vision ΔE 29.7, both >= 3:1 contrast).
const RECEIVED = "#b47700";
const PAID = "#2a78d6";

interface Row {
  week: string;
  /** Major units, for bar heights and the axis. */
  received: number;
  paid: number;
  receivedMinor: number;
  paidMinor: number;
  receivedZat: number;
  paidZat: number;
}

/**
 * X-axis labels: every other week, counted back from the latest, so they are evenly spaced and the current week is
 * always labelled. Recharts' "preserveStartEnd" skipped unevenly (7 Sept, 21 Sept, 5 Oct, 26 Oct), audit L10.
 */
export function axisTicks(weeks: string[]): string[] {
  return weeks.filter((_, i) => (weeks.length - 1 - i) % 2 === 0);
}

function ChartTooltip({ active, payload, currency }: TooltipContentProps & { currency: CurrencyCode }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]!.payload as Row;
  return (
    <div className="rounded-xl bg-white px-3 py-2 text-sm shadow-lg ring-1 ring-black/10">
      <p className="font-semibold text-ink">
        {t.week} {row.week}
      </p>
      <p className="mt-1 flex items-center gap-2 text-black/70">
        <span className="size-2.5 rounded-sm" style={{ background: RECEIVED }} />
        {t.chartReceived}: <span className="font-semibold text-ink">{formatMoney(row.receivedMinor, currency)}</span>
        <span className="text-black/45">{formatZec(row.receivedZat)}</span>
      </p>
      <p className="flex items-center gap-2 text-black/70">
        <span className="size-2.5 rounded-sm" style={{ background: PAID }} />
        {t.chartPaid}: <span className="font-semibold text-ink">{formatMoney(row.paidMinor, currency)}</span>
        <span className="text-black/45">{formatZec(row.paidZat)}</span>
      </p>
    </div>
  );
}

/** Received vs paid out per week, with a table view (identity is never color-alone). */
export default function WeeklyChart({ weekly, rate, currency }: { weekly: Transparency["weekly"]; rate: number; currency: CurrencyCode }) {
  const [asTable, setAsTable] = useState(false);
  const rows: Row[] = weekly.map((w) => {
    const receivedMinor = zatToFiatMinor(w.receivedZat, rate, currency);
    const paidMinor = zatToFiatMinor(w.paidOutZat, rate, currency);
    return { week: formatWeek(w.weekStart), received: receivedMinor / 100, paid: paidMinor / 100, receivedMinor, paidMinor, receivedZat: w.receivedZat, paidZat: w.paidOutZat };
  });

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2 className="mr-auto text-lg font-bold">{t.chartTitle}</h2>
        <ul className="flex items-center gap-3 text-sm text-black/70" aria-label="Legend">
          <li className="flex items-center gap-1.5">
            <span className="size-3 rounded-sm" style={{ background: RECEIVED }} /> {t.chartReceived}
          </li>
          <li className="flex items-center gap-1.5">
            <span className="size-3 rounded-sm" style={{ background: PAID }} /> {t.chartPaid}
          </li>
        </ul>
        <button type="button" onClick={() => setAsTable((v) => !v)} className="text-sm font-semibold text-black/60 underline-offset-4 hover:text-ink hover:underline">
          {asTable ? t.showChart : t.showTable}
        </button>
      </div>

      {asTable ? (
        <table className="w-full text-left text-sm">
          <thead className="text-black/55">
            <tr>
              <th className="py-2 font-medium">{t.week}</th>
              <th className="py-2 text-right font-medium">{t.chartReceived}</th>
              <th className="py-2 text-right font-medium">{t.chartPaid}</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {rows.map((r) => (
              <tr key={r.week} className="border-t border-black/[0.06]">
                <td className="py-2">{r.week}</td>
                <td className="py-2 text-right">{formatMoney(r.receivedMinor, currency)}</td>
                <td className="py-2 text-right">{formatMoney(r.paidMinor, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="h-60" role="img" aria-label={`${t.chartTitle}: ${t.chartReceived} / ${t.chartPaid}`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 4, right: 0, bottom: 0, left: 0 }} barGap={2} barCategoryGap="22%">
              <CartesianGrid vertical={false} stroke="#00000012" />
              <XAxis dataKey="week" tickLine={false} axisLine={{ stroke: "#00000026" }} tick={{ fontSize: 11, fill: "#00000099" }} ticks={axisTicks(rows.map((r) => r.week))} interval={0} />
              <YAxis tickFormatter={(v: number) => compactMoney(v, currency)} tickLine={false} axisLine={false} width={48} tick={{ fontSize: 11, fill: "#00000099" }} />
              <Tooltip content={(props) => <ChartTooltip {...props} currency={currency} />} cursor={{ fill: "#0000000a" }} />
              <Bar dataKey="received" name={t.chartReceived} fill={RECEIVED} radius={[4, 4, 0, 0]} maxBarSize={22} />
              <Bar dataKey="paid" name={t.chartPaid} fill={PAID} radius={[4, 4, 0, 0]} maxBarSize={22} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
