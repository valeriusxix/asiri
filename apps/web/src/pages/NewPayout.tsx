import { useState } from "react";
import { Link } from "react-router";
import { ApiError, api } from "../api";
import { AdminLayout } from "../components/AdminLayout";
import { Alert, Button, ButtonLink, Card, CopyButton, Field, Icon, Spinner, buttonClass, inputClass } from "../components/ui";
import { admin as t, categoryLabels, common } from "../copy";
import { CURRENCIES, CURRENCY_CODES, fiatMinorToZat, formatMoney, limitsText, parseAmount, withinLimits, type CurrencyCode } from "../currency";
import { formatZec } from "../format";
import { useAsync } from "../hooks";
import { CATEGORIES, type Category, type CreatedPayout } from "../types";

export default function NewPayout() {
  const [created, setCreated] = useState<CreatedPayout | null>(null);
  return <AdminLayout>{created ? <Created result={created} onAnother={() => setCreated(null)} /> : <PayoutForm onCreated={setCreated} />}</AdminLayout>;
}

function PayoutForm({ onCreated }: { onCreated: (c: CreatedPayout) => void }) {
  const price = useAsync(() => api.price());
  const [picked, setPicked] = useState<CurrencyCode | null>(null);
  // The fund currency is the default until the organizer picks another one.
  const currency = picked ?? price.data?.fundCurrency ?? "USD";
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<Category>("medical");
  const [note, setNote] = useState("");
  const [days, setDays] = useState("14");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const minor = parseAmount(amount, currency);
  const valid = minor !== null && withinLimits(minor, currency, "payout");
  const range = t.amountRange(limitsText(currency, "payout"));

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="mb-5 text-2xl font-bold tracking-tight">{t.newPayout}</h1>
      <Card>
        <form
          noValidate
          className="space-y-5"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!valid) {
              setError(range);
              return;
            }
            setBusy(true);
            setError(null);
            try {
              onCreated(
                await api.admin.createPayout({
                  amount: minor! / 100,
                  currency,
                  category,
                  internalNote: note.trim() || undefined,
                  expiresInDays: Number(days),
                }),
              );
            } catch (err) {
              if (err instanceof ApiError && err.code === "insufficient_funds") {
                setError(t.insufficient(formatZec(Number(err.body.availableZat ?? 0))));
              } else if (err instanceof ApiError && err.code === "validation_error") {
                const fields = (err.body.details as { fieldErrors?: Record<string, string[]> } | undefined)?.fieldErrors ?? {};
                setError(Object.values(fields).flat()[0] ?? common.error);
              } else {
                setError(err instanceof ApiError && err.code === "network_error" ? common.offline : common.error);
              }
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label={t.currency} htmlFor="currency">
            <select
              id="currency"
              value={currency}
              onChange={(e) => {
                setPicked(e.target.value as CurrencyCode);
                setAmount("");
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
          <Field
            label={`${t.amount} (${CURRENCIES[currency].symbol})`}
            htmlFor="amount"
            help={valid && price.data ? t.amountHelp(formatZec(fiatMinorToZat(minor!, price.data.rates[currency], currency), 8)) : range}
          >
            <input
              id="amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              placeholder={String(CURRENCIES[currency].presets[2])}
              autoFocus
              className={`${inputClass} text-xl font-semibold tabular-nums`}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            {CURRENCIES[currency].presets.map((v) => (
              <button key={v} type="button" className={buttonClass("secondary", "sm")} onClick={() => setAmount(String(v))}>
                {formatMoney(v * 100, currency)}
              </button>
            ))}
          </div>
          <Field label={t.category} htmlFor="category">
            <div id="category" role="radiogroup" className="grid grid-cols-3 gap-2">
              {CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={category === c}
                  onClick={() => setCategory(c)}
                  className={`min-h-11 rounded-xl px-2 text-sm font-semibold ring-1 ring-inset transition ${
                    category === c ? "bg-ink text-white ring-ink" : "bg-white text-ink ring-black/15 hover:bg-black/[0.03]"
                  }`}
                >
                  {categoryLabels[c]}
                </button>
              ))}
            </div>
          </Field>
          <Field label={t.note} htmlFor="note" help={<span className="font-medium text-amber-800">{t.noteHint}</span>}>
            <input id="note" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} className={inputClass} autoComplete="off" />
          </Field>
          <Field label={t.expiry} htmlFor="days">
            <select id="days" value={days} onChange={(e) => setDays(e.target.value)} className={inputClass}>
              {[1, 3, 7, 14, 30].map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </Field>
          {error && <Alert>{error}</Alert>}
          <Button type="submit" size="lg" block disabled={busy}>
            {busy ? (
              <>
                <Spinner /> {t.creating}
              </>
            ) : (
              t.create
            )}
          </Button>
        </form>
      </Card>
    </div>
  );
}

function Created({ result, onAnother }: { result: CreatedPayout; onAnother: () => void }) {
  const path = new URL(result.link).pathname + new URL(result.link).hash;
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-full bg-ok text-white">
          <Icon name="check" className="size-6" />
        </span>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t.createdTitle}</h1>
          <p className="text-black/60">
            {result.payout.amountDisplay} · {categoryLabels[result.payout.category]} · {result.payout.amountZecDisplay}
          </p>
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-xl bg-red-50 p-3.5 font-semibold text-bad ring-1 ring-inset ring-red-200">
        <Icon name="alert" className="mt-0.5 size-5 shrink-0" />
        {t.onlyOnce}
      </div>

      <Card>
        <p className="text-sm font-semibold text-black/55">{t.linkLabel}</p>
        <p className="mt-1.5 break-all font-mono text-[15px] leading-relaxed text-ink">{result.link}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <CopyButton text={result.link} />
          <a href={result.whatsappUrl} target="_blank" rel="noopener noreferrer" className={buttonClass("success", "sm")}>
            {t.whatsapp}
          </a>
          <a href={result.smsUrl} className={buttonClass("secondary", "sm")}>
            {t.sms}
          </a>
        </div>
      </Card>

      <Card>
        <p className="text-sm font-semibold text-black/55">{t.pinLabel}</p>
        <p className="mt-1 font-mono text-5xl font-bold tracking-[0.2em] text-ink tabular-nums">{result.pin}</p>
        <p className="mt-3 text-[15px] text-black/70">{t.pinInstruction}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <CopyButton text={result.pin} />
          <a href={`sms:?body=${encodeURIComponent(t.pinSms(result.pin))}`} className={buttonClass("secondary", "sm")}>
            {t.smsPin}
          </a>
        </div>
      </Card>

      <div className="flex flex-col gap-2 pt-2 sm:flex-row">
        <Link to={path} target="_blank" className={buttonClass("dark", "md", "flex-1")}>
          {t.openLink}
        </Link>
        <Button variant="secondary" className="flex-1" onClick={onAnother}>
          {t.another}
        </Button>
        <ButtonLink to="/admin" variant="ghost">
          {t.done}
        </ButtonLink>
      </div>
    </div>
  );
}
