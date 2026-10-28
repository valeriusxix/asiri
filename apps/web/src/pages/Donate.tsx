import { useState } from "react";
import { ApiError, api } from "../api";
import { PageTitle, PublicLayout } from "../components/Layout";
import { QR } from "../components/QR";
import { Alert, Button, ButtonLink, Card, CopyBox, DemoBadge, Field, Icon, Spinner, buttonClass, inputClass } from "../components/ui";
import { common, donate as t } from "../copy";
import { formatNgn } from "../format";
import { useAsync } from "../hooks";
import type { Fund } from "../types";

type Tab = "zcash" | "demo";

export default function Donate() {
  const fund = useAsync(() => api.fund());
  const [tab, setTab] = useState<Tab>("zcash");
  const demoMode = fund.data?.demoMode ?? false;

  return (
    <PublicLayout>
      <PageTitle title={t.title} sub={fund.data ? t.sub(fund.data.name) : undefined} />

      {fund.loading && !fund.data && (
        <div className="flex justify-center py-16 text-black/50">
          <Spinner className="size-7" />
        </div>
      )}
      {fund.error != null && (
        <div className="space-y-3">
          <Alert>{common.offline}</Alert>
          <Button variant="secondary" onClick={fund.reload}>
            {common.retry}
          </Button>
        </div>
      )}

      {fund.data && (
        <>
          {demoMode && (
            <div role="tablist" className="mb-5 grid grid-cols-2 gap-1 rounded-2xl bg-black/[0.05] p-1">
              {(["zcash", "demo"] as Tab[]).map((k) => (
                <button
                  key={k}
                  role="tab"
                  aria-selected={tab === k}
                  onClick={() => setTab(k)}
                  className={`min-h-11 rounded-xl px-3 text-[15px] font-semibold transition ${tab === k ? "bg-white text-ink shadow-sm" : "text-black/55 hover:text-ink"}`}
                >
                  {k === "zcash" ? t.tabZcash : t.tabDemo}
                </button>
              ))}
            </div>
          )}

          {tab === "zcash" && <ZcashCard fund={fund.data} />}

          {tab === "demo" && demoMode && <DemoDonation />}
        </>
      )}
    </PublicLayout>
  );
}

/** In mock mode the address is a placeholder that no wallet can pay, so it is labelled Demo (audit H2). */
export function ZcashCard({ fund }: { fund: Fund }) {
  const mock = fund.mode === "mock";
  return (
    <Card className="text-center">
      {mock && (
        <div className="mb-4 flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-left text-sm text-amber-950 ring-1 ring-inset ring-amber-200">
          <DemoBadge className="mt-0.5 shrink-0" />
          <p>{t.mockNote}</p>
        </div>
      )}
      <p className="text-sm font-semibold text-black/60">{t.scan}</p>
      <div className="mt-4 flex justify-center">
        <QR value={fund.paymentUri} title={t.scan} />
      </div>
      <p className="mx-auto mt-5 max-w-sm text-[15px] font-medium text-ink">
        <Icon name="shield" className="mr-1.5 inline size-5 align-[-4px] text-ok" />
        {t.privateLine}
      </p>
      <CopyBox className="mt-5 text-left" label={t.addressLabel} value={fund.receiveAddress} />
      <a href={fund.paymentUri} className={buttonClass("dark", "lg", "mt-4 w-full")}>
        {t.openWallet}
      </a>
      {fund.network === "testnet" && !mock && <p className="mt-3 text-sm text-black/50">{t.testnetNote}</p>}
    </Card>
  );
}

function DemoDonation() {
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<number | null>(null);

  if (done !== null) {
    return (
      <Card className="text-center">
        <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-ok text-white">
          <Icon name="check" className="size-7" />
        </div>
        <h2 className="mt-4 flex items-center justify-center gap-2 text-2xl font-bold">
          {t.thanksTitle} <DemoBadge />
        </h2>
        <p className="mx-auto mt-2 max-w-sm text-[15px] text-black/65">{t.thanksBody(formatNgn(done))}</p>
        <div className="mt-6 flex flex-col gap-2">
          <ButtonLink to="/transparency" variant="dark" block>
            {t.seeTransparency}
          </ButtonLink>
          <Button
            variant="ghost"
            block
            onClick={() => {
              setDone(null);
              setAmount("");
            }}
          >
            {t.another}
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <form
        noValidate
        className="space-y-5"
        onSubmit={async (e) => {
          e.preventDefault();
          const value = Number(amount.replace(/[,\s₦]/g, ""));
          if (!Number.isInteger(value) || value < 100 || value > 10_000_000) {
            setError(t.amountInvalid);
            return;
          }
          setBusy(true);
          setError(null);
          try {
            await api.simulateDonation(value);
            setDone(value);
          } catch (err) {
            setError(err instanceof ApiError && err.code === "network_error" ? common.offline : common.error);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="flex items-start gap-2">
          <DemoBadge className="mt-0.5" />
          <p className="text-[15px] text-black/65">{t.demoIntro}</p>
        </div>
        <Field label={t.amountLabel} htmlFor="amount" help={t.amountHelp} error={error}>
          <input
            id="amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="numeric"
            placeholder="10000"
            className={`${inputClass} text-lg tabular-nums`}
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          {[5_000, 20_000, 100_000].map((v) => (
            <button key={v} type="button" onClick={() => setAmount(String(v))} className={buttonClass("secondary", "sm")}>
              {formatNgn(v)}
            </button>
          ))}
        </div>
        <Button type="submit" size="lg" block disabled={busy}>
          {busy ? (
            <>
              <Spinner /> {t.donating}
            </>
          ) : (
            t.donateDemo
          )}
        </Button>
      </form>
    </Card>
  );
}
