import { useState } from "react";
import { ApiError, api } from "../api";
import { AdminLayout } from "../components/AdminLayout";
import { Alert, Button, ButtonLink, Card, DemoBadge, Spinner } from "../components/ui";
import { admin as t, categoryLabels, common } from "../copy";
import { formatDate, formatDateTime, formatNgn, formatZec, timeAgo, zatToNgn } from "../format";
import { useAsync } from "../hooks";
import type { AdminPayout, Overview, PayoutStatus } from "../types";

const STATUS_STYLES: Record<PayoutStatus, string> = {
  active: "bg-sky-50 text-sky-800 ring-sky-200",
  claiming: "bg-violet-50 text-violet-800 ring-violet-200",
  claimed: "bg-green-50 text-green-800 ring-green-200",
  expired: "bg-black/[0.04] text-black/55 ring-black/10",
  cancelled: "bg-black/[0.04] text-black/55 ring-black/10",
  locked: "bg-red-50 text-red-800 ring-red-200",
};

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
      <div className="flex flex-wrap items-end gap-3">
        <h1 className="mr-auto text-2xl font-bold tracking-tight">{t.dashboard}</h1>
        <Button variant="secondary" onClick={sync} disabled={syncing}>
          {syncing ? (
            <>
              <Spinner className="size-4" /> {t.syncing}
            </>
          ) : (
            t.syncNow
          )}
        </Button>
        <ButtonLink to="/admin/payouts/new">{t.newPayout}</ButtonLink>
      </div>

      {overview.error != null && <Alert>{common.offline}</Alert>}
      {o && <Balances o={o} />}
      {o && (
        <p className="-mt-3 text-sm text-black/55">
          {o.lastSyncAt ? t.lastSync(timeAgo(o.lastSyncAt)) : t.neverSynced}
          {o.lastSyncError && (
            <span className="ml-2 font-medium text-bad">
              {t.syncError}: {o.lastSyncError}
            </span>
          )}
        </p>
      )}
      {o?.mode === "mock" && <MockFunding onDone={sync} />}
      {actionError && <Alert>{actionError}</Alert>}

      <Card className="overflow-hidden p-0!">
        <h2 className="px-5 pb-2 pt-4 text-lg font-bold">
          {t.payouts}
          {o && (
            <span className="ml-2 text-sm font-medium text-black/50">
              {t.countsLine(o.counts)}
            </span>
          )}
        </h2>
        {payouts.data && payouts.data.length === 0 && <p className="px-5 pb-5 text-[15px] text-black/55">{t.noPayouts}</p>}
        {payouts.data && payouts.data.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-black/[0.02] text-black/55">
                <tr>
                  <th className="px-5 py-2 font-medium">{t.cols.id}</th>
                  <th className="px-3 py-2 font-medium">{t.cols.amount}</th>
                  <th className="px-3 py-2 font-medium">{t.category}</th>
                  <th className="px-3 py-2 font-medium">{t.cols.status}</th>
                  <th className="px-3 py-2 font-medium">{t.cols.created}</th>
                  <th className="px-3 py-2 font-medium">{t.cols.expiresClaimed}</th>
                  <th className="px-5 py-2" />
                </tr>
              </thead>
              <tbody>
                {payouts.data.map((p) => (
                  <PayoutRow
                    key={p.id}
                    p={p}
                    onCancel={() => confirm(t.confirmCancel) && act(() => api.admin.cancelPayout(p.id))}
                    onUnlock={() => act(() => api.admin.unlockPayout(p.id))}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="overflow-hidden p-0!">
        <h2 className="px-5 pb-2 pt-4 text-lg font-bold">{t.donations}</h2>
        {donations.data && donations.data.length === 0 && <p className="px-5 pb-5 text-[15px] text-black/55">{t.noDonations}</p>}
        {donations.data && donations.data.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-black/[0.02] text-black/55">
                <tr>
                  <th className="px-5 py-2 font-medium">{t.cols.when}</th>
                  <th className="px-3 py-2 font-medium">{t.cols.source}</th>
                  <th className="px-3 py-2 font-medium">{t.cols.amount}</th>
                  <th className="px-3 py-2 font-medium">{t.cols.memo}</th>
                  <th className="px-5 py-2 font-medium">{t.cols.txid}</th>
                </tr>
              </thead>
              <tbody>
                {donations.data.map((d) => (
                  <tr key={d.id} className="border-t border-black/[0.06]">
                    <td className="whitespace-nowrap px-5 py-2.5">{formatDateTime(d.observedAt)}</td>
                    <td className="px-3 py-2.5">{d.source === "simulated" ? <DemoBadge /> : t.sourceZcash}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">
                      <span className="font-semibold">{d.amountNgnDisplay}</span> <span className="text-black/45">{d.amountZecDisplay}</span>
                    </td>
                    <td className="max-w-[16rem] truncate px-3 py-2.5 text-black/70">{d.memo ?? "-"}</td>
                    <td className="px-5 py-2.5 font-mono text-xs text-black/50">{d.txid ? `${d.txid.slice(0, 10)}…` : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function Balances({ o }: { o: Overview }) {
  const ngn = (zat: number) => formatNgn(zatToNgn(zat, o.zecNgn));
  const items: { label: string; zat: number; strong?: boolean; hidden?: boolean }[] = [
    { label: t.spendable, zat: o.spendableZat },
    { label: t.reserved, zat: o.reservedZat },
    { label: t.settled, zat: o.settledOffchainZat, hidden: o.settledOffchainZat === 0 },
    { label: t.pending, zat: o.pendingZat, hidden: o.pendingZat === 0 },
    { label: t.available, zat: o.availableZat, strong: true },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {items
        .filter((i) => !i.hidden)
        .map((i) => (
          <div key={i.label} className={`rounded-2xl p-4 ring-1 ${i.strong ? "bg-ink text-white ring-ink" : "bg-white ring-black/[0.06]"}`}>
            <p className={`text-sm font-medium ${i.strong ? "text-gold" : "text-black/55"}`}>{i.label}</p>
            <p className="mt-1 text-xl font-bold tabular-nums tracking-tight">{formatZec(i.zat)}</p>
            <p className={`text-sm tabular-nums ${i.strong ? "text-white/60" : "text-black/45"}`}>{ngn(i.zat)}</p>
          </div>
        ))}
    </div>
  );
}

function PayoutRow({ p, onCancel, onUnlock }: { p: AdminPayout; onCancel: () => void; onUnlock: () => void }) {
  return (
    <tr className="border-t border-black/[0.06] align-top">
      <td className="px-5 py-2.5 font-mono text-xs text-black/60">{p.id}</td>
      <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">
        <span className="font-semibold">{p.amountNgnDisplay}</span>
        <div className="text-xs text-black/45">{p.amountZecDisplay}</div>
      </td>
      <td className="px-3 py-2.5">
        {categoryLabels[p.category]}
        {p.internalNote && (
          <div className="max-w-[14rem] truncate text-xs text-black/45" title={p.internalNote}>
            {p.internalNote}
          </div>
        )}
      </td>
      <td className="px-3 py-2.5">
        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${STATUS_STYLES[p.status]}`}>{t.statusLabels[p.status]}</span>
        {p.claimMethod && <div className="mt-1 text-xs text-black/50">{t.methodLabels[p.claimMethod]}</div>}
        {p.status === "active" && p.pinAttempts > 0 && <div className="mt-1 text-xs text-bad">{t.wrongPins(p.pinAttempts)}</div>}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-black/60">{formatDateTime(p.createdAt)}</td>
      <td className="whitespace-nowrap px-3 py-2.5 text-black/60">
        {p.claimedAt ? formatDateTime(p.claimedAt) : formatDate(p.expiresAt)}
        {p.claimTxid && <div className="font-mono text-xs text-black/45">{p.claimTxid.slice(0, 10)}…</div>}
      </td>
      <td className="whitespace-nowrap px-5 py-2 text-right">
        {p.status === "locked" && (
          <Button size="sm" variant="secondary" className="mr-2" onClick={onUnlock}>
            {t.unlock}
          </Button>
        )}
        {(p.status === "active" || p.status === "locked") && (
          <Button size="sm" variant="danger" onClick={onCancel}>
            {t.cancel}
          </Button>
        )}
      </td>
    </tr>
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
    <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-amber-50/70 px-4 py-3 ring-1 ring-inset ring-amber-200">
      <DemoBadge />
      <div className="mr-auto">
        <p className="text-sm font-semibold">{t.mockTitle}</p>
        <p className="text-sm text-black/60">{t.mockBody}</p>
      </div>
      {[0.1, 0.5].map((z) => (
        <Button key={z} size="sm" variant="secondary" disabled={busy} onClick={() => add(z)}>
          {t.mockAdd(z)}
        </Button>
      ))}
    </div>
  );
}
