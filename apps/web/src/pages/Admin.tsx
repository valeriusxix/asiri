import { useState, type ReactNode } from "react";
import { ApiError, api } from "../api";
import { AdminLayout } from "../components/AdminLayout";
import { Alert, Button, ButtonLink, Card, DemoBadge, Icon, Spinner } from "../components/ui";
import { admin as t, categoryLabels, common } from "../copy";
import { CurrencySwitcher } from "../components/CurrencySwitcher";
import { formatZatAs } from "../currency";
import { formatDate, formatDateTime, formatZec, timeAgo } from "../format";
import { useAsync, useDisplayCurrency } from "../hooks";
import type { AdminDonation, AdminPayout, Overview, PayoutStatus } from "../types";

/** Status colours stay apart from the brand violet: blue open, amber in progress, green done, red locked. */
const STATUS_STYLES: Record<PayoutStatus, { badge: string; dot: string }> = {
  active: { badge: "bg-info-tint text-info-text ring-info-border", dot: "bg-info-text" },
  claiming: { badge: "bg-warning-tint text-warning-text ring-warning-border", dot: "bg-warning" },
  claimed: { badge: "bg-success-tint text-success-text ring-success-border", dot: "bg-success" },
  expired: { badge: "bg-surface-muted text-muted ring-border-strong", dot: "bg-subtle" },
  cancelled: { badge: "bg-surface text-muted ring-border-strong", dot: "bg-border-strong" },
  locked: { badge: "bg-error-tint text-error ring-error-border", dot: "bg-error" },
};

const COUNTED: (keyof Overview["counts"])[] = ["active", "claimed", "expired", "cancelled", "locked"];

export default function Admin() {
  return (
    <AdminLayout>
      <Dashboard />
    </AdminLayout>
  );
}

function Dashboard() {
  const overview = useAsync(() => api.admin.overview());
  const payouts = useAsync(() => api.admin.payouts());
  const donations = useAsync(() => api.admin.donations());
  const [syncing, setSyncing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const reloadAll = () => {
    overview.reload();
    payouts.reload();
    donations.reload();
  };

  const sync = async () => {
    setSyncing(true);
    try {
      await api.admin.sync();
    } finally {
      setSyncing(false);
      reloadAll();
    }
  };

  const act = async (fn: () => Promise<unknown>) => {
    setActionError(null);
    try {
      await fn();
    } catch (err) {
      setActionError(err instanceof ApiError ? `${common.error} (${err.code})` : common.error);
    }
    reloadAll();
  };

  const o = overview.data;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-bold tracking-tight text-fg sm:text-[1.75rem]">{t.dashboard}</h1>
        <ButtonLink to="/admin/payouts/new">{t.newPayout}</ButtonLink>
      </div>

      {overview.error != null && <Alert>{common.offline}</Alert>}
      {o && <Balances o={o} />}

      {o && (
        <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
          <StatusCounts counts={o.counts} />
          <Card className="flex flex-wrap items-center gap-3 p-4! lg:min-w-[22rem]">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-primary-tint text-brand-primary-strong">
              <Icon name="clock" />
            </span>
            <div className="mr-auto min-w-0">
              <p className="text-sm font-medium text-muted">{t.syncTitle}</p>
              <p className="font-semibold text-fg">{o.lastSyncAt ? t.lastSync(timeAgo(o.lastSyncAt)) : t.neverSynced}</p>
              {o.lastSyncError && (
                <p className="text-sm font-medium text-error">
                  {t.syncError}: {o.lastSyncError}
                </p>
              )}
            </div>
            <Button variant="secondary" size="sm" onClick={sync} disabled={syncing}>
              {syncing ? (
                <>
                  <Spinner className="size-4" /> {t.syncing}
                </>
              ) : (
                t.syncNow
              )}
            </Button>
          </Card>
        </div>
      )}

      {o?.mode === "mock" && <MockFunding onDone={sync} />}
      {actionError && <Alert>{actionError}</Alert>}

      <Card className="overflow-hidden p-0!">
        <SectionHeading title={t.payouts} />
        {payouts.data && payouts.data.length === 0 && <p className="px-5 pb-5 text-[15px] text-muted">{t.noPayouts}</p>}
        {payouts.data && payouts.data.length > 0 && (
          <>
            {/* Phones and small tablets: one card per payout. */}
            <ul className="divide-y divide-border border-t border-border md:hidden">
              {payouts.data.map((p) => (
                <PayoutCard key={p.id} p={p} {...actions(p)} />
              ))}
            </ul>
            <table className="hidden w-full text-left text-sm md:table">
              <thead className="border-t border-border bg-surface-muted text-muted">
                <tr>
                  <th className="px-5 py-2.5 font-medium">{t.cols.amount}</th>
                  <th className="px-3 py-2.5 font-medium">{t.category}</th>
                  <th className="px-3 py-2.5 font-medium">{t.cols.status}</th>
                  <th className="px-3 py-2.5 font-medium">{t.cols.created}</th>
                  <th className="px-3 py-2.5 font-medium">{t.cols.expiresClaimed}</th>
                  <th className="px-3 py-2.5 font-medium">{t.cols.id}</th>
                  <th className="px-5 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {payouts.data.map((p) => (
                  <PayoutRow key={p.id} p={p} {...actions(p)} />
                ))}
              </tbody>
            </table>
          </>
        )}
      </Card>

      <Card className="overflow-hidden p-0!">
        <SectionHeading title={t.donations} />
        {donations.data && donations.data.length === 0 && <p className="px-5 pb-5 text-[15px] text-muted">{t.noDonations}</p>}
        {donations.data && donations.data.length > 0 && (
          <>
            <ul className="divide-y divide-border border-t border-border md:hidden">
              {donations.data.map((d) => (
                <DonationCard key={d.id} d={d} />
              ))}
            </ul>
            <table className="hidden w-full text-left text-sm md:table">
              <thead className="border-t border-border bg-surface-muted text-muted">
                <tr>
                  <th className="px-5 py-2.5 font-medium">{t.cols.when}</th>
                  <th className="px-3 py-2.5 font-medium">{t.cols.source}</th>
                  <th className="px-3 py-2.5 font-medium">{t.cols.amount}</th>
                  <th className="px-3 py-2.5 font-medium">{t.cols.memo}</th>
                  <th className="px-5 py-2.5 font-medium">{t.cols.txid}</th>
                </tr>
              </thead>
              <tbody>
                {donations.data.map((d) => (
                  <tr key={d.id} className="border-t border-border">
                    <td className="whitespace-nowrap px-5 py-3 text-muted">{formatDateTime(d.observedAt)}</td>
                    <td className="px-3 py-3">{d.source === "simulated" ? <DemoBadge /> : t.sourceZcash}</td>
                    <td className="whitespace-nowrap px-3 py-3 tabular-nums">
                      <span className="font-semibold text-fg">{d.amountDisplay}</span> <span className="text-subtle">{d.amountZecDisplay}</span>
                    </td>
                    <td className="max-w-[16rem] truncate px-3 py-3 text-fg/80">{d.memo ?? "-"}</td>
                    <td className="px-5 py-3 font-mono text-xs text-subtle">{d.txid ? `${d.txid.slice(0, 10)}…` : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </Card>
    </div>
  );

  function actions(p: AdminPayout) {
    return {
      onCancel: () => confirm(t.confirmCancel) && act(() => api.admin.cancelPayout(p.id)),
      onUnlock: () => act(() => api.admin.unlockPayout(p.id)),
    };
  }
}

function SectionHeading({ title, extra }: { title: string; extra?: ReactNode }) {
  return (
    <h2 className="flex flex-wrap items-baseline gap-x-2 px-5 pb-3 pt-4 text-lg font-bold text-fg">
      {title}
      {extra && <span className="text-sm font-medium text-muted">{extra}</span>}
    </h2>
  );
}

/** Balances are held in ZEC; fiat beside them is approximate, in the fund currency or the one the organizer picks. */
function Balances({ o }: { o: Overview }) {
  const [chosen, setCurrency] = useDisplayCurrency(o.fundCurrency);
  const currency = chosen ?? o.fundCurrency;
  const fiat = (zat: number) => formatZatAs(zat, o.rates[currency], currency);
  const items: { label: string; zat: number; strong?: boolean; hidden?: boolean }[] = [
    { label: t.spendable, zat: o.spendableZat },
    { label: t.reserved, zat: o.reservedZat },
    { label: t.settled, zat: o.settledOffchainZat, hidden: o.settledOffchainZat === 0 },
    { label: t.pending, zat: o.pendingZat, hidden: o.pendingZat === 0 },
    { label: t.available, zat: o.availableZat, strong: true },
  ];
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        <span className="text-sm text-muted">
          {t.switcherLabel} <span className="font-semibold text-fg">{currency}</span> · {t.approx}
        </span>
        <CurrencySwitcher value={currency} onChange={setCurrency} label={t.switcherLabel} />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {items
          .filter((i) => !i.hidden)
          .map((i) => (
            <div
              key={i.label}
              className={`rounded-2xl p-4 ring-1 sm:p-5 ${
                i.strong ? "col-span-2 bg-brand-ink text-white ring-brand-ink md:col-span-1" : "bg-surface ring-border shadow-xs shadow-brand-ink/5"
              }`}
            >
              <p className={`text-sm font-medium ${i.strong ? "text-brand-secondary" : "text-muted"}`}>{i.label}</p>
              <p className={`mt-1.5 text-xl font-bold tabular-nums tracking-tight sm:text-2xl ${i.strong ? "text-white" : "text-fg"}`}>{formatZec(i.zat)}</p>
              <p className={`mt-0.5 text-sm tabular-nums ${i.strong ? "text-white/70" : "text-subtle"}`}>{fiat(i.zat)}</p>
            </div>
          ))}
      </div>
    </section>
  );
}

function StatusCounts({ counts }: { counts: Overview["counts"] }) {
  return (
    <Card className="p-4!">
      <p className="text-sm font-medium text-muted">{t.statusTitle}</p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {COUNTED.map((k) => (
          <li key={k} className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold ring-1 ring-inset ${STATUS_STYLES[k].badge}`}>
            <span className={`size-2 rounded-full ${STATUS_STYLES[k].dot}`} aria-hidden />
            {t.statusLabels[k]}
            <span className="tabular-nums">{counts[k]}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function StatusBadge({ status }: { status: PayoutStatus }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${STATUS_STYLES[status].badge}`}>
      <span className={`size-1.5 rounded-full ${STATUS_STYLES[status].dot}`} aria-hidden />
      {t.statusLabels[status]}
    </span>
  );
}

function PayoutActions({ p, onCancel, onUnlock }: { p: AdminPayout; onCancel: () => void; onUnlock: () => void }) {
  return (
    <>
      {p.status === "locked" && (
        <Button size="sm" variant="secondary" onClick={onUnlock}>
          {t.unlock}
        </Button>
      )}
      {(p.status === "active" || p.status === "locked") && (
        <Button size="sm" variant="danger" onClick={onCancel}>
          {t.cancel}
        </Button>
      )}
    </>
  );
}

function PayoutRow({ p, onCancel, onUnlock }: { p: AdminPayout; onCancel: () => void; onUnlock: () => void }) {
  return (
    <tr className="border-t border-border align-top hover:bg-surface-muted/60">
      <td className="whitespace-nowrap px-5 py-3 tabular-nums">
        <span className="text-base font-semibold text-fg">{p.amountDisplay}</span>
        <div className="text-xs text-subtle">{p.amountZecDisplay}</div>
      </td>
      <td className="px-3 py-3 text-fg">
        {categoryLabels[p.category]}
        {p.internalNote && (
          <div className="max-w-[14rem] truncate text-xs text-subtle" title={p.internalNote}>
            {p.internalNote}
          </div>
        )}
      </td>
      <td className="px-3 py-3">
        <StatusBadge status={p.status} />
        {p.claimMethod && <div className="mt-1 text-xs text-subtle">{t.methodLabels[p.claimMethod]}</div>}
        {p.status === "active" && p.pinAttempts > 0 && <div className="mt-1 text-xs font-medium text-error">{t.wrongPins(p.pinAttempts)}</div>}
      </td>
      <td className="whitespace-nowrap px-3 py-3 text-muted">{formatDateTime(p.createdAt)}</td>
      <td className="whitespace-nowrap px-3 py-3 text-muted">
        {p.claimedAt ? formatDateTime(p.claimedAt) : formatDate(p.expiresAt)}
        {p.claimTxid && <div className="font-mono text-xs text-subtle">{p.claimTxid.slice(0, 10)}…</div>}
      </td>
      <td className="px-3 py-3 font-mono text-xs text-subtle">{p.id}</td>
      <td className="whitespace-nowrap px-5 py-2.5 text-right">
        <div className="inline-flex gap-2">
          <PayoutActions p={p} onCancel={onCancel} onUnlock={onUnlock} />
        </div>
      </td>
    </tr>
  );
}

function PayoutCard({ p, onCancel, onUnlock }: { p: AdminPayout; onCancel: () => void; onUnlock: () => void }) {
  return (
    <li className="px-5 py-4">
      <div className="flex items-start gap-3">
        <div className="mr-auto min-w-0">
          <p className="text-lg font-bold tabular-nums text-fg">{p.amountDisplay}</p>
          <p className="text-xs tabular-nums text-subtle">{p.amountZecDisplay}</p>
        </div>
        <div className="flex flex-col items-end gap-1 text-right">
          <StatusBadge status={p.status} />
          {p.claimMethod && <span className="text-xs text-subtle">{t.methodLabels[p.claimMethod]}</span>}
          {p.status === "active" && p.pinAttempts > 0 && <span className="text-xs font-medium text-error">{t.wrongPins(p.pinAttempts)}</span>}
        </div>
      </div>
      <p className="mt-2 font-semibold text-fg">{categoryLabels[p.category]}</p>
      {p.internalNote && <p className="truncate text-sm text-subtle">{p.internalNote}</p>}
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <div>
          <dt className="text-subtle">{t.cols.created}</dt>
          <dd className="text-fg/85">{formatDateTime(p.createdAt)}</dd>
        </div>
        <div>
          <dt className="text-subtle">{t.cols.expiresClaimed}</dt>
          <dd className="text-fg/85">{p.claimedAt ? formatDateTime(p.claimedAt) : formatDate(p.expiresAt)}</dd>
        </div>
        <div className="col-span-2">
          <dt className="sr-only">{t.cols.id}</dt>
          <dd className="font-mono text-xs text-subtle">
            {p.id}
            {p.claimTxid && ` · ${p.claimTxid.slice(0, 10)}…`}
          </dd>
        </div>
      </dl>
      {(p.status === "active" || p.status === "locked") && (
        <div className="mt-3 flex gap-2">
          <PayoutActions p={p} onCancel={onCancel} onUnlock={onUnlock} />
        </div>
      )}
    </li>
  );
}

function DonationCard({ d }: { d: AdminDonation }) {
  return (
    <li className="px-5 py-3.5">
      <div className="flex items-start gap-3">
        <div className="mr-auto min-w-0">
          <p className="font-semibold tabular-nums text-fg">{d.amountDisplay}</p>
          <p className="text-xs tabular-nums text-subtle">{d.amountZecDisplay}</p>
        </div>
        {d.source === "simulated" ? <DemoBadge /> : <span className="text-sm font-medium text-muted">{t.sourceZcash}</span>}
      </div>
      <p className="mt-1 text-sm text-muted">{formatDateTime(d.observedAt)}</p>
      {d.memo && <p className="mt-1 break-words text-sm text-fg/80">{d.memo}</p>}
      {d.txid && <p className="mt-1 font-mono text-xs text-subtle">{d.txid.slice(0, 10)}…</p>}
    </li>
  );
}

function MockFunding({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const add = async (zec: number) => {
    setBusy(true);
    try {
      await api.dev.mockDonate(Math.round(zec * 100_000_000));
      onDone();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-warning-tint px-4 py-3 ring-1 ring-inset ring-warning-border">
      <DemoBadge />
      <div className="mr-auto min-w-0">
        <p className="text-sm font-semibold text-fg">{t.mockTitle}</p>
        <p className="text-sm text-muted">{t.mockBody}</p>
      </div>
      <div className="flex gap-2">
        {[0.1, 0.5].map((z) => (
          <Button key={z} size="sm" variant="secondary" disabled={busy} onClick={() => add(z)}>
            {t.mockAdd(z)}
          </Button>
        ))}
      </div>
    </div>
  );
}
