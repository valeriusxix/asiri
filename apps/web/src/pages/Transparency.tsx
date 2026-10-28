import { lazy, Suspense, type ReactNode } from "react";
import { api } from "../api";
import { CurrencySwitcher } from "../components/CurrencySwitcher";
import { PageTitle, PublicLayout } from "../components/Layout";
import { Alert, Button, Card, CopyBox, DemoBadge, Icon, Spinner } from "../components/ui";
import { categoryLabels, common, transparencyCopy as t } from "../copy";
import { formatMoney, formatZatAs, toMinorRate, type CurrencyCode } from "../currency";
import { formatDate, formatZec, timeAgo } from "../format";
import { useAsync, useDisplayCurrency } from "../hooks";
import type { Price, Transparency as TransparencyData } from "../types";

// Start downloading the chart (recharts is the biggest chunk) as soon as this page's module loads,
// in parallel with the data fetch, instead of waiting until the data arrives.
const chartModule = import("../components/WeeklyChart");
const WeeklyChart = lazy(() => chartModule);

function ChartPlaceholder() {
  return (
    <div className="h-[18.5rem]">
      <h2 className="text-lg font-bold">{t.chartTitle}</h2>
      <div className="mt-6 flex h-52 items-center justify-center text-subtle">
        <Spinner className="size-6" />
      </div>
    </div>
  );
}

export default function Transparency() {
  const { data, error, loading, reload } = useAsync(() => Promise.all([api.transparency(), api.price()]));
  const [currency, setCurrency] = useDisplayCurrency(data?.[0].fundCurrency);

  return (
    <PublicLayout>
      <PageTitle title={t.title} sub={data ? t.sub(data[0].fundName) : undefined} />

      {loading && !data && (
        <div className="flex justify-center py-16 text-subtle">
          <Spinner className="size-7" />
        </div>
      )}
      {error != null && !data && (
        <div className="space-y-3">
          <Alert>{common.offline}</Alert>
          <Button variant="secondary" onClick={reload}>
            {common.retry}
          </Button>
        </div>
      )}

      {data && currency && <TransparencyBody data={data[0]} price={data[1]} currency={currency} onCurrency={setCurrency} />}
    </PublicLayout>
  );
}

/**
 * The page body for one `/api/transparency` response. Totals are canonical in ZEC; fiat figures are converted here at
 * today's rate for the chosen currency, and labelled approximate. In mock mode every figure is a placeholder and says
 * so (audit H2).
 */
export function TransparencyBody({
  data,
  price,
  currency,
  onCurrency = () => {},
}: {
  data: TransparencyData;
  price: Price;
  currency: CurrencyCode;
  onCurrency?: (c: CurrencyCode) => void;
}) {
  const mock = data.mode === "mock";
  const rate = price.rates[currency];
  const fiat = (zat: number) => formatZatAs(zat, rate, currency);
  return (
    <div className="space-y-5">
      {mock && (
        <div className="flex items-start gap-2 rounded-2xl bg-warning-tint px-4 py-3 text-[15px] text-warning-text ring-1 ring-inset ring-warning-border">
          <DemoBadge className="mt-0.5 shrink-0" />
          <p>{t.mockBanner}</p>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">
          {t.switcherLabel} <span className="font-semibold text-fg">{currency}</span> · {t.approxShort}
        </p>
        <CurrencySwitcher value={currency} onChange={onCurrency} label={t.switcherLabel} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Stat label={t.raised} value={fiat(data.totals.receivedZat)} zat={data.totals.receivedZat} big badge={mock} />
        <Stat label={t.paidOut} value={fiat(data.totals.paidOutZat)} zat={data.totals.paidOutZat} big />
        <Stat label={t.waiting} value={fiat(data.totals.outstandingZat)} zat={data.totals.outstandingZat} />
        <Card className="p-4!">
          <p className="text-sm font-medium text-muted">{t.helped}</p>
          <p className="mt-1 text-2xl font-bold tabular-nums tracking-tight">{data.totals.payoutsCount.toLocaleString("en-US")}</p>
        </Card>
      </div>

      {data.totals.simulatedZat > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl bg-warning-tint px-4 py-3 ring-1 ring-inset ring-warning-border">
          <DemoBadge />
          <span className="text-[15px] text-fg/80">{t.simulated}</span>
          <span className="ml-auto text-[15px] font-semibold tabular-nums">{fiat(data.totals.simulatedZat)}</span>
          <span className="w-full text-xs text-subtle">{t.simulatedNote}</span>
        </div>
      )}

      {data.totals.demoCashoutCount > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl bg-warning-tint px-4 py-3 ring-1 ring-inset ring-warning-border">
          <DemoBadge />
          <span className="text-[15px] text-fg/80">{t.demoCashouts}</span>
          <span className="ml-auto text-[15px] font-semibold tabular-nums">{fiat(data.totals.demoCashoutZat)}</span>
          <span className="w-full text-xs text-subtle">{t.demoCashoutsNote(data.totals.demoCashoutCount)}</span>
        </div>
      )}

      <Card>
        <Suspense fallback={<ChartPlaceholder />}>
          <WeeklyChart weekly={data.weekly} rate={rate} currency={currency} />
        </Suspense>
      </Card>

      <Card>
        <h2 className="mb-3 text-lg font-bold">{t.categoryTitle}</h2>
        {data.byCategory.length === 0 ? (
          <p className="text-[15px] text-muted">{t.noPayments}</p>
        ) : (
          <table className="w-full text-left text-[15px]">
            <thead className="text-sm text-muted">
              <tr>
                <th className="pb-2 font-medium">{t.category}</th>
                <th className="pb-2 text-right font-medium">{t.payments}</th>
                <th className="pb-2 text-right font-medium">{t.amount}</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {data.byCategory.map((c) => (
                <tr key={c.category} className="border-t border-border">
                  <td className="py-2.5 font-medium">{categoryLabels[c.category] ?? c.category}</td>
                  <td className="py-2.5 text-right">{c.count}</td>
                  <td className="py-2.5 text-right">{fiat(c.amountZat)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card>
        <h2 className="text-lg font-bold">{t.reportTitle}</h2>
        {data.latestReport ? (
          <>
            <p className="mt-0.5 text-sm text-subtle">
              {t.reportPeriod(formatDate(data.latestReport.periodStart), formatDate(data.latestReport.periodEnd))}
            </p>
            <p className="mt-3 whitespace-pre-line text-[16px] leading-relaxed text-fg/85">{data.latestReport.body}</p>
            {data.latestReport.stats && (
              <dl className="mt-4 grid grid-cols-3 gap-2 rounded-xl bg-surface-muted p-3 text-center">
                <MiniStat label={t.periodRaised} value={data.latestReport.stats.donationsReceived} />
                <MiniStat label={t.periodPaidOut} value={data.latestReport.stats.paidOut} />
                <MiniStat label={t.periodPayments} value={String(data.latestReport.stats.paymentsCount)} />
              </dl>
            )}
          </>
        ) : (
          <p className="mt-2 text-[15px] text-muted">{t.noReport}</p>
        )}
      </Card>

      <Card className="bg-brand-ink! text-white ring-0!">
        <h2 className="flex items-center gap-2 text-lg font-bold">
          <Icon name="shield" className="size-5 text-brand-secondary" />
          {t.verifyTitle}
          {mock && <DemoBadge />}
        </h2>
        <p className="mt-2 text-[15px] leading-relaxed text-white/75">{data.verifyHint}</p>
        {mock && <p className="mt-2 text-[15px] leading-relaxed text-brand-secondary">{t.mockUfvk}</p>}
        <div className="mt-4 rounded-xl bg-surface p-1 text-fg">
          <CopyBox label={undefined} value={data.ufvk} />
        </div>
        <p className="mt-2 text-xs text-white/50">{t.ufvkLabel}</p>
      </Card>

      <p className="text-center text-xs text-subtle">
        {t.approxNote(currency, formatMoney(toMinorRate(rate, currency), currency), price.sources[currency])} {t.updated(timeAgo(data.updatedAt))}
      </p>
    </div>
  );
}

function Stat({ label, value, zat, big, badge }: { label: string; value: string; zat: number; big?: boolean; badge?: boolean }): ReactNode {
  return (
    <Card className="p-4!">
      <p className="flex items-center gap-1.5 text-sm font-medium text-muted">
        {label}
        {badge && <DemoBadge />}
      </p>
      <p className={`mt-1 break-words font-bold tabular-nums tracking-tight ${big ? "text-[1.6rem] leading-tight" : "text-2xl"}`}>{value}</p>
      <p className="mt-0.5 text-xs tabular-nums text-subtle">{formatZec(zat)}</p>
    </Card>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-subtle">{label}</dt>
      <dd className="mt-0.5 text-sm font-bold tabular-nums">{value}</dd>
    </div>
  );
}
