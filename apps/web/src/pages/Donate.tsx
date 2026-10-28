import { useState } from "react";
import { ApiError, api } from "../api";
import { PageTitle, PublicLayout } from "../components/Layout";
import { QR } from "../components/QR";
import { Alert, Button, ButtonLink, Card, CopyBox, DemoBadge, Field, Icon, Spinner, buttonClass, inputClass } from "../components/ui";
import { common, donate as t } from "../copy";
import { CURRENCIES, CURRENCY_CODES, formatMoney, limitsText, parseAmount, withinLimits, type CurrencyCode } from "../currency";
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
        <div className="flex justify-center py-16 text-subtle">
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
            <div role="tablist" className="mb-5 grid grid-cols-2 gap-1 rounded-2xl bg-surface-muted p-1">
              {(["zcash", "demo"] as Tab[]).map((k) => (
                <button
                  key={k}
                  role="tab"
                  aria-selected={tab === k}
                  onClick={() => setTab(k)}
                  className={`min-h-11 rounded-xl px-3 text-[15px] font-semibold transition ${tab === k ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg"}`}
                >
                  {k === "zcash" ? t.tabZcash : t.tabDemo}
                </button>
              ))}
            </div>
          )}

          {tab === "zcash" && <ZcashCard fund={fund.data} />}

          {tab === "demo" && demoMode && <DemoDonation fundCurrency={fund.data.fundCurrency} />}
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
        <div className="mb-4 flex items-start gap-2 rounded-xl bg-warning-tint p-3 text-left text-sm text-warning-text ring-1 ring-inset ring-warning-border">
          <DemoBadge className="mt-0.5 shrink-0" />
          <p>{t.mockNote}</p>
        </div>
      )}
      <p className="text-sm font-semibold text-muted">{t.scan}</p>
      <div className="mt-4 flex justify-center">
        <QR value={fund.paymentUri} title={t.scan} />
      </div>
      <p className="mx-auto mt-5 max-w-sm text-[15px] font-medium text-fg">
        <Icon name="shield" className="mr-1.5 inline size-5 align-[-4px] text-success" />
        {t.privateLine}
      </p>
      <CopyBox className="mt-5 text-left" label={t.addressLabel} value={fund.receiveAddress} />
      <a href={fund.paymentUri} className={buttonClass("dark", "lg", "mt-4 w-full")}>
        {t.openWallet}
      </a>
      {fund.network === "testnet" && !mock && <p className="mt-3 text-sm text-subtle">{t.testnetNote}</p>}
    </Card>
  );
}

/** Simulated card or bank donation, in any supported currency (default: the fund's). Labelled Demo throughout. */
function DemoDonation({ fundCurrency }: { fundCurrency: CurrencyCode }) {
  const [currency, setCurrency] = useState<CurrencyCode>(fundCurrency);
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ minor: number; currency: CurrencyCode } | null>(null);
  const range = limitsText(currency, "donation");

  if (done !== null) {
    return (
      <Card className="text-center">
        <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-success text-white">
          <Icon name="check" className="size-7" />
        </div>
        <h2 className="mt-4 flex items-center justify-center gap-2 text-2xl font-bold">
          {t.thanksTitle} <DemoBadge />
        </h2>
        <p className="mx-auto mt-2 max-w-sm text-[15px] text-muted">{t.thanksBody(formatMoney(done.minor, done.currency))}</p>
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
          const minor = parseAmount(amount, currency);
          if (minor === null || !withinLimits(minor, currency, "donation")) {
            setError(t.amountInvalid(range));
            return;
          }
          setBusy(true);
          setError(null);
          try {
            await api.simulateDonation(minor / 100, currency);
            setDone({ minor, currency });
          } catch (err) {
            setError(err instanceof ApiError && err.code === "network_error" ? common.offline : common.error);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="flex items-start gap-2">
          <DemoBadge className="mt-0.5" />
          <p className="text-[15px] text-muted">{t.demoIntro}</p>
        </div>
        <Field label={t.currencyLabel} htmlFor="currency">
          <select
            id="currency"
            value={currency}
            onChange={(e) => {
              setCurrency(e.target.value as CurrencyCode);
              setError(null);
            }}
            className={inputClass}
          >
            {CURRENCY_CODES.map((c) => (
              <option key={c} value={c}>
                {c} ({CURRENCIES[c].symbol})
              </option>
            ))}
          </select>
        </Field>
        <Field label={`${t.amountLabel} (${CURRENCIES[currency].symbol})`} htmlFor="amount" help={t.amountHelp(range)} error={error}>
          <input
            id="amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder={String(CURRENCIES[currency].presets[1])}
            className={`${inputClass} text-lg tabular-nums`}
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          {CURRENCIES[currency].presets.slice(0, 3).map((v) => (
            <button key={v} type="button" onClick={() => setAmount(String(v))} className={buttonClass("secondary", "sm")}>
              {formatMoney(v * 100, currency)}
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
