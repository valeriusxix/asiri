import { useState } from "react";
import { ApiError, api } from "../api";
import { AdminLayout } from "../components/AdminLayout";
import { Alert, Button, Card, Spinner, inputClass } from "../components/ui";
import { admin as t, common } from "../copy";
import { formatDate, formatDateTime } from "../format";
import { useAsync } from "../hooks";
import type { Report } from "../types";

export default function Reports() {
  const reports = useAsync(() => api.admin.reports());
  const [days, setDays] = useState("7");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      reports.reload();
    } catch (err) {
      setError(err instanceof ApiError && err.code === "network_error" ? common.offline : common.error);
    } finally {
      setBusy(null);
    }
  };

  return (
    <AdminLayout>
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t.reports}</h1>
          <p className="mt-1 max-w-2xl text-muted">{t.reportsSub}</p>
        </div>

        <Card className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="period" className="mb-1.5 block text-sm font-semibold">
              {t.period}
            </label>
            <select id="period" value={days} onChange={(e) => setDays(e.target.value)} className={`${inputClass} min-w-44`}>
              {[7, 14, 30, 90].map((d) => (
                <option key={d} value={d}>
                  {t.days(d)}
                </option>
              ))}
            </select>
          </div>
          <Button onClick={() => run("generate", () => api.admin.generateReport(Number(days)))} disabled={busy !== null}>
            {busy === "generate" ? (
              <>
                <Spinner className="size-4" /> {t.generating}
              </>
            ) : (
              t.generate
            )}
          </Button>
        </Card>

        {error && <Alert>{error}</Alert>}
        {reports.data?.length === 0 && <p className="text-muted">{t.noReports}</p>}
        {reports.data?.map((r) => (
          <ReportCard key={r.id} r={r} busy={busy === r.id} onPublish={() => run(r.id, () => api.admin.publishReport(r.id))} />
        ))}
      </div>
    </AdminLayout>
  );
}

function ReportCard({ r, busy, onPublish }: { r: Report; busy: boolean; onPublish: () => void }) {
  return (
    <Card as="article">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto font-bold">
          {t.reportPeriod(formatDate(r.periodStart), formatDate(r.periodEnd))}
        </h2>
        <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs font-semibold text-muted">{r.generator === "claude" ? t.byClaude : t.byTemplate}</span>
        {r.published ? (
          <span className="rounded-full bg-success-tint px-2 py-0.5 text-xs font-semibold text-success-text ring-1 ring-inset ring-success-border">
            {t.published} {r.publishedAt && formatDateTime(r.publishedAt)}
          </span>
        ) : (
          <>
            <span className="rounded-full bg-warning-tint px-2 py-0.5 text-xs font-semibold text-warning-text ring-1 ring-inset ring-warning-border">{t.draft}</span>
            <Button size="sm" onClick={onPublish} disabled={busy}>
              {busy ? <Spinner className="size-4" /> : t.publish}
            </Button>
          </>
        )}
      </div>
      <p className="mt-3 whitespace-pre-line leading-relaxed text-fg/85">{r.body}</p>
      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 rounded-xl bg-surface-muted p-3 text-sm sm:grid-cols-4">
        <Stat label={t.reportStats.donations} value={`${r.stats.donationsReceived} (${r.stats.donationsCount})`} />
        <Stat label={t.reportStats.paidOut} value={`${r.stats.paidOut} (${r.stats.paymentsCount})`} />
        <Stat label={t.reportStats.waiting} value={r.stats.waitingToBeClaimed} />
        <Stat label={t.reportStats.demoDonations} value={r.stats.simulatedDonations} />
      </dl>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-subtle">{label}</dt>
      <dd className="font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
