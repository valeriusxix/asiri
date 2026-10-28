import { lazy, Suspense, type ReactNode } from "react";
import { api } from "../api";
import { PageTitle, PublicLayout } from "../components/Layout";
import { Alert, Button, Card, CopyBox, DemoBadge, Icon, Spinner } from "../components/ui";
import { categoryLabels, common, transparencyCopy as t } from "../copy";
import { formatDate, formatNgn, formatZec, timeAgo, zatToNgn } from "../format";
import { useAsync } from "../hooks";
import type { Transparency as TransparencyData } from "../types";

// Start downloading the chart (recharts is the biggest chunk) as soon as this page's module loads,
// in parallel with the data fetch, instead of waiting until the data arrives.
const chartModule = import("../components/WeeklyChart");
const WeeklyChart = lazy(() => chartModule);

function ChartPlaceholder() {
  return (
    <div className="h-[18.5rem]">
      <h2 className="text-lg font-bold">{t.chartTitle}</h2>
      <div className="mt-6 flex h-52 items-center justify-center text-black/30">
        <Spinner className="size-6" />
      </div>
    </div>
  );
}

export default function Transparency() {
  const { data, error, loading, reload } = useAsync(() => api.transparency());

  return (
    <PublicLayout>
      <PageTitle title={t.title} sub={data ? t.sub(data.fundName) : undefined} />

      {loading && !data && (
        <div className="flex justify-center py-16 text-black/50">
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

      {data && <TransparencyBody data={data} />}
    </PublicLayout>
  );
}

/** The page body for one `/api/transparency` response. In mock mode every figure is a placeholder and says so (audit H2). */
export function TransparencyBody({ data }: { data: TransparencyData }) {
  const mock = data.mode === "mock";
  return (
    <div className="space-y-5">
      {mock && (
        <div className="flex items-start gap-2 rounded-2xl bg-amber-50 px-4 py-3 text-[15px] text-amber-950 ring-1 ring-inset ring-amber-200">
          <DemoBadge className="mt-0.5 shrink-0" />
          <p>{t.mockBanner}</p>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Stat label={t.raised} ngn={zatToNgn(data.totals.receivedZat, data.currency.zecNgn)} zat={data.totals.receivedZat} big badge={mock} />
        <Stat label={t.paidOut} ngn={zatToNgn(data.totals.paidOutZat, data.currency.zecNgn)} zat={data.totals.paidOutZat} big />
        <Stat label={t.waiting} ngn={zatToNgn(data.totals.outstandingZat, data.currency.zecNgn)} zat={data.totals.outstandingZat} />
        <Card className="p-4!">
          <p className="text-sm font-medium text-black/55">{t.helped}</p>
          <p className="mt-1 text-2xl font-bold tabular-nums tracking-tight">{data.totals.payoutsCount.toLocaleString("en-US")}</p>
        </Card>
      </div>

      {data.totals.simulatedZat > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl bg-amber-50/70 px-4 py-3 ring-1 ring-inset ring-amber-200">
          <DemoBadge />
          <span className="text-[15px] text-black/70">{t.simulated}</span>
          <span className="ml-auto text-[15px] font-semibold tabular-nums">{formatNgn(zatToNgn(data.totals.simulatedZat, data.currency.zecNgn))}</span>
          <span className="w-full text-xs text-black/50">{t.simulatedNote}</span>
        </div>
      )}

      {data.totals.demoCashoutCount > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl bg-amber-50/70 px-4 py-3 ring-1 ring-inset ring-amber-200">
          <DemoBadge />
          <span className="text-[15px] text-black/70">{t.demoCashouts}</span>
          <span className="ml-auto text-[15px] font-semibold tabular-nums">{formatNgn(zatToNgn(data.totals.demoCashoutZat, data.currency.zecNgn))}</span>
          <span className="w-full text-xs text-black/50">{t.demoCashoutsNote(data.totals.demoCashoutCount)}</span>
        </div>
      )}

      <Card>
        <Suspense fallback={<ChartPlaceholder />}>
          <WeeklyChart weekly={data.weekly} zecNgn={data.currency.zecNgn} />
        </Suspense>
      </Card>

      <Card>
        <h2 className="mb-3 text-lg font-bold">{t.categoryTitle}</h2>
        {data.byCategory.length === 0 ? (
          <p className="text-[15px] text-black/55">{t.noPayments}</p>
        ) : (
          <table className="w-full text-left text-[15px]">
            <thead className="text-sm text-black/55">
              <tr>
                <th className="pb-2 font-medium">{t.category}</th>
                <th className="pb-2 text-right font-medium">{t.payments}</th>
                <th className="pb-2 text-right font-medium">{t.amount}</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {data.byCategory.map((c) => (
                <tr key={c.category} className="border-t border-black/[0.06]">
                  <td className="py-2.5 font-medium">{categoryLabels[c.category] ?? c.category}</td>
                  <td className="py-2.5 text-right">{c.count}</td>
                  <td className="py-2.5 text-right">{formatNgn(zatToNgn(c.amountZat, data.currency.zecNgn))}</td>
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
            <p className="mt-0.5 text-sm text-black/50">
              {t.reportPeriod(formatDate(data.latestReport.periodStart), formatDate(data.latestReport.periodEnd))}
            </p>
            <p className="mt-3 whitespace-pre-line text-[16px] leading-relaxed text-black/80">{data.latestReport.body}</p>
            {data.latestReport.stats && (
              <dl className="mt-4 grid grid-cols-3 gap-2 rounded-xl bg-black/[0.03] p-3 text-center">
                <MiniStat label={t.periodRaised} value={data.latestReport.stats.donationsReceived} />
                <MiniStat label={t.periodPaidOut} value={data.latestReport.stats.paidOut} />
                <MiniStat label={t.periodPayments} value={String(data.latestReport.stats.paymentsCount)} />
              </dl>
            )}
          </>
        ) : (
          <p className="mt-2 text-[15px] text-black/55">{t.noReport}</p>
        )}
      </Card>

      <Card className="bg-ink! text-white ring-0!">
        <h2 className="flex items-center gap-2 text-lg font-bold">
          <Icon name="shield" className="size-5 text-gold" />
          {t.verifyTitle}
          {mock && <DemoBadge />}
        </h2>
        <p className="mt-2 text-[15px] leading-relaxed text-white/75">{data.verifyHint}</p>
        {mock && <p className="mt-2 text-[15px] leading-relaxed text-gold">{t.mockUfvk}</p>}
        <div className="mt-4 rounded-xl bg-white p-1 text-ink">
          <CopyBox label={undefined} value={data.ufvk} />
        </div>
        <p className="mt-2 text-xs text-white/50">{t.ufvkLabel}</p>
      </Card>

      <p className="text-center text-xs text-black/45">
        {t.rateNote(formatNgn(data.currency.zecNgn), data.currency.source)} {t.updated(timeAgo(data.updatedAt))}
      </p>
    </div>
  );
}

function Stat({ label, ngn, zat, big, badge }: { label: string; ngn: number; zat: number; big?: boolean; badge?: boolean }): ReactNode {
  return (
    <Card className="p-4!">
      <p className="flex items-center gap-1.5 text-sm font-medium text-black/55">
        {label}
        {badge && <DemoBadge />}
      </p>
      <p className={`mt-1 font-bold tabular-nums tracking-tight ${big ? "text-[1.6rem] leading-tight" : "text-2xl"}`}>{formatNgn(ngn)}</p>
      <p className="mt-0.5 text-xs tabular-nums text-black/45">{formatZec(zat)}</p>
    </Card>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-black/50">{label}</dt>
      <dd className="mt-0.5 text-sm font-bold tabular-nums">{value}</dd>
    </div>
  );
}
