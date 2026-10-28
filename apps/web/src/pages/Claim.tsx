import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useParams } from "react-router";
import { ApiError, api } from "../api";
import { Logo, NetworkPill } from "../components/Layout";
import { PinInput } from "../components/PinInput";
import { Alert, Button, CopyBox, DemoBadge, Field, Icon, Spinner, inputClass } from "../components/ui";
import { claim as t, claimAdvanced as adv } from "../copy";
import { rememberClaimed, tabStorage, wasClaimedHere } from "../claimMemory";
import { formatDateFriendly } from "../format";
import { useHealth } from "../hooks";
import { BANK_FIELDS, bankFieldValid, type BankField } from "../currency";
import type { CashoutDetails, ClaimRedeem, ClaimUnlock } from "../types";

type Terminal = "claimed" | "expired" | "cancelled" | "locked" | "pending_funds" | "network_error" | "busy";

type State =
  | { kind: "loading" }
  | { kind: "not_found"; incomplete: boolean }
  | { kind: "pin" }
  | { kind: "reveal" }
  | { kind: "cashout" }
  | { kind: "wallet" }
  | { kind: "keep" }
  | { kind: "done"; result: ClaimRedeem }
  | { kind: "claimed_here" }
  | { kind: "terminal"; status: Terminal };

/**
 * Recipient claim page (Agent.md 11.2 / 11.3). The secret lives only in the URL fragment and in memory;
 * it is sent in a POST body when the recipient acts, and removed from the address bar when done.
 */
export function Claim() {
  const { id = "" } = useParams();
  const health = useHealth();
  const secretRef = useRef(typeof window !== "undefined" ? window.location.hash.slice(1) : "");
  const [state, setState] = useState<State>({ kind: "loading" });
  const [fundName, setFundName] = useState("");
  const [unlocked, setUnlocked] = useState<ClaimUnlock | null>(null);
  const [pinMessage, setPinMessage] = useState<string | null>(null);
  const opened = useRef(false);

  const open = useCallback(async () => {
    const secret = secretRef.current;
    if (!secret) {
      // A reload after "Done" has no secret any more: say it was received, not that the link is broken (audit L2).
      setState(wasClaimedHere(tabStorage(), id) ? { kind: "claimed_here" } : { kind: "not_found", incomplete: true });
      return;
    }
    setState({ kind: "loading" });
    try {
      const res = await api.claims.open(id, secret);
      setFundName(res.fundName);
      setState(res.status === "available" ? { kind: "pin" } : { kind: "terminal", status: res.status });
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setState({ kind: "not_found", incomplete: false });
      else setState({ kind: "terminal", status: "network_error" });
    }
  }, [id]);

  useEffect(() => {
    if (opened.current) return; // StrictMode runs effects twice in development
    opened.current = true;
    void open();
  }, [open]);

  const finish = (result: ClaimRedeem) => {
    setState({ kind: "done", result });
    rememberClaimed(tabStorage(), id);
    secretRef.current = "";
    history.replaceState(null, "", `/c/${id}`);
  };

  /** Shared handling for redeem failures. Returns an inline message, or null when the state changed. */
  const redeemError = (err: unknown): string | null => {
    if (!(err instanceof ApiError)) return t.sendFailed;
    switch (err.code) {
      case "claim_session_expired":
        setUnlocked(null);
        setPinMessage(t.pinAgain);
        setState({ kind: "pin" });
        return null;
      case "funds_pending":
      case "insufficient_funds":
      case "insufficient_funds_for_fee":
        setState({ kind: "terminal", status: "pending_funds" });
        return null;
      case "already_processing":
        setState({ kind: "terminal", status: "busy" });
        return null;
      case "claimed":
      case "expired":
      case "cancelled":
      case "locked":
        setState({ kind: "terminal", status: err.code });
        return null;
      case "network_error":
        return t.network;
      case "rate_limited":
        return t.slowDown;
      default:
        return t.sendFailed;
    }
  };

  const network = health?.network ?? "testnet";

  return (
    <div className="flex min-h-dvh flex-col bg-[#fbfaf7] text-ink">
      <header className="mx-auto flex h-14 w-full max-w-[640px] items-center gap-2 px-4">
        <Logo />
        <NetworkPill />
      </header>
      <main className="mx-auto w-full max-w-[640px] flex-1 px-4 pb-12 pt-2">
        {state.kind === "loading" && (
          <Centered>
            <Spinner className="size-8 text-ink/60" />
            <p className="mt-4 text-lg text-black/60">{t.loading}</p>
          </Centered>
        )}

        {state.kind === "claimed_here" && (
          <Message icon="check" tone="success" title={t.claimedHereTitle}>
            {t.claimedHere}
          </Message>
        )}

        {state.kind === "not_found" && (
          <Message icon="alert" tone="neutral" title={state.incomplete ? t.incompleteTitle : t.notFoundTitle}>
            {state.incomplete ? t.incompleteLink : t.notFound}
          </Message>
        )}

        {state.kind === "pin" && (
          <PinStep
            fundName={fundName}
            initialMessage={pinMessage}
            onUnlock={async (pin) => {
              try {
                const res = await api.claims.unlock(id, secretRef.current, pin);
                setUnlocked(res);
                setPinMessage(null);
                setState({ kind: "reveal" });
                return null;
              } catch (err) {
                if (!(err instanceof ApiError)) return t.sendFailed;
                if (err.code === "wrong_pin") return t.wrongPin(Number(err.body.attemptsLeft ?? 0));
                if (err.code === "locked") setState({ kind: "terminal", status: "locked" });
                else if (["claimed", "expired", "cancelled"].includes(err.code)) setState({ kind: "terminal", status: err.code as Terminal });
                else if (err.code === "already_processing") setState({ kind: "terminal", status: "busy" });
                else if (err.status === 404) setState({ kind: "not_found", incomplete: false });
                else if (err.code === "rate_limited") return t.slowDown;
                else if (err.code === "network_error") return t.network;
                else return t.sendFailed;
                return null;
              }
            }}
          />
        )}

        {state.kind === "reveal" && unlocked && (
          <div>
            <AmountHero unlocked={unlocked} fundName={fundName} />
            <h2 className="mb-3 mt-8 text-lg font-bold">{t.chooseHow}</h2>
            <div className="space-y-3">
              {health?.demoMode !== false && (
                <OptionCard icon="bank" title={t.cashoutTitle} body={t.cashoutBody} badge={<DemoBadge />} onClick={() => setState({ kind: "cashout" })} />
              )}
              <OptionCard icon="clock" title={t.keepTitle} body={t.keepBody} onClick={() => setState({ kind: "keep" })} />
              <details className="group rounded-2xl bg-white ring-1 ring-black/[0.08]">
                <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 text-[15px] font-semibold text-black/70 [&::-webkit-details-marker]:hidden">
                  <Icon name="wallet" className="size-5 text-black/50" />
                  <span className="flex-1">{adv.toggle}</span>
                  <span className="text-black/40 transition-transform group-open:rotate-90">
                    <Icon name="arrow" className="size-4" />
                  </span>
                </summary>
                <div className="border-t border-black/[0.06] px-4 pb-4 pt-3">
                  <p className="text-[15px] text-black/70">{adv.intro}</p>
                  <p className="mt-1 text-sm text-black/50">{adv.amount(unlocked.amountZecDisplay)}</p>
                  <Button variant="secondary" className="mt-3" onClick={() => setState({ kind: "wallet" })}>
                    {adv.send}
                  </Button>
                </div>
              </details>
            </div>
            <p className="mt-8 text-center text-sm text-black/50">
              <Icon name="shield" className="mr-1.5 inline size-4 align-[-3px]" />
              {t.privacy}
            </p>
          </div>
        )}

        {state.kind === "cashout" && unlocked && (
          <CashoutStep
            unlocked={unlocked}
            onBack={() => setState({ kind: "reveal" })}
            onSubmit={async (details) => {
              try {
                finish(await api.claims.redeemCashout(id, unlocked.claimToken, details));
                return null;
              } catch (err) {
                return redeemError(err);
              }
            }}
          />
        )}

        {state.kind === "wallet" && unlocked && (
          <WalletStep
            unlocked={unlocked}
            testnet={network === "testnet"}
            onBack={() => setState({ kind: "reveal" })}
            onSubmit={async (address) => {
              try {
                finish(await api.claims.redeemToAddress(id, unlocked.claimToken, address));
                return null;
              } catch (err) {
                if (err instanceof ApiError && (err.code === "invalid_address" || err.code === "validation_error")) return adv.invalid;
                return redeemError(err);
              }
            }}
          />
        )}

        {state.kind === "keep" && unlocked && (
          <Message icon="clock" tone="neutral" title={t.keepDoneTitle}>
            <p>{t.keepDone(formatDateFriendly(unlocked.expiresAt))}</p>
            <Button variant="secondary" size="lg" block className="mt-6" onClick={() => setState({ kind: "reveal" })}>
              {t.chooseAgain}
            </Button>
          </Message>
        )}

        {state.kind === "done" && (
          <Message icon="check" tone="success" title={t.doneTitle}>
            <DoneDetails result={state.result} />
          </Message>
        )}

        {state.kind === "terminal" && <TerminalMessage status={state.status} onRetry={open} />}
      </main>
    </div>
  );
}

/**
 * What the done screen says under "Done. Take care." A bank cash-out is always a demo: even when
 * OFFRAMP_ZCASH_ADDRESS sends real funds on chain, no bank transfer reaches the recipient (audit L3).
 */
export function DoneDetails({ result }: { result: ClaimRedeem }) {
  if (result.method === "zcash_address") {
    return (
      <>
        <p>{adv.doneWallet}</p>
        {result.txid && <CopyBox className="mt-5 text-left" label={adv.txid} value={result.txid} />}
      </>
    );
  }
  return (
    <>
      <p>{t.doneBank}</p>
      <DemoBadge className="mt-3" />
    </>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex min-h-[50dvh] flex-col items-center justify-center text-center">{children}</div>;
}

function Message({ icon, tone, title, children }: { icon: "check" | "alert" | "clock" | "lock"; tone: "success" | "neutral" | "warning"; title: string; children: ReactNode }) {
  const tones = { success: "bg-ok text-white", neutral: "bg-black/[0.06] text-black/70", warning: "bg-amber-100 text-amber-800" };
  return (
    <div className="flex min-h-[55dvh] flex-col items-center justify-center text-center">
      <div className={`flex size-16 items-center justify-center rounded-full ${tones[tone]}`}>
        <Icon name={icon} className="size-8" />
      </div>
      <h1 className="mt-5 text-[1.75rem] font-bold leading-tight">{title}</h1>
      <div className="mt-3 w-full max-w-sm text-lg leading-relaxed text-black/65">{children}</div>
    </div>
  );
}

function TerminalMessage({ status, onRetry }: { status: Terminal; onRetry: () => void }) {
  switch (status) {
    case "claimed":
      return <Message icon="check" tone="neutral" title={t.claimedTitle}>{t.claimed}</Message>;
    case "expired":
      return <Message icon="clock" tone="neutral" title={t.expiredTitle}>{t.expired}</Message>;
    case "cancelled":
      return <Message icon="alert" tone="neutral" title={t.cancelledTitle}>{t.cancelled}</Message>;
    case "locked":
      return <Message icon="lock" tone="warning" title={t.lockedTitle}>{t.locked}</Message>;
    case "busy":
      return <Message icon="clock" tone="neutral" title={t.pendingTitle}>{t.busy}</Message>;
    case "pending_funds":
    case "network_error":
      return (
        <Message icon={status === "pending_funds" ? "clock" : "alert"} tone="warning" title={status === "pending_funds" ? t.pendingTitle : t.networkTitle}>
          <p>{status === "pending_funds" ? t.pending : t.network}</p>
          <Button size="lg" block className="mt-6" onClick={onRetry}>
            {t.tryAgain}
          </Button>
        </Message>
      );
  }
}

function PinStep({ fundName, initialMessage, onUnlock }: { fundName: string; initialMessage: string | null; onUnlock: (pin: string) => Promise<string | null> }) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(initialMessage);
  const [invalid, setInvalid] = useState(false);

  const submit = async (value = pin) => {
    if (value.length !== 6 || busy) return;
    setBusy(true);
    setInvalid(false);
    const error = await onUnlock(value);
    setBusy(false);
    if (error) {
      setMessage(error);
      setInvalid(true);
      setPin("");
    }
  };

  return (
    <form
      className="pt-6"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="mx-auto mb-6 flex size-14 items-center justify-center rounded-2xl bg-gold/20 text-gold-dark">
        <Icon name="lock" className="size-7" />
      </div>
      <h1 className="text-center text-[1.75rem] font-bold leading-tight">{t.receivedFrom(fundName)}</h1>
      <p className="mx-auto mt-3 max-w-sm text-center text-lg text-black/65">{t.enterPin}</p>
      <div className="mt-8">
        <PinInput
          value={pin}
          label={t.pinLabel}
          invalid={invalid}
          disabled={busy}
          onChange={(v) => {
            setPin(v);
            if (invalid) setInvalid(false);
          }}
          onComplete={(v) => void submit(v)}
        />
      </div>
      <div className="mx-auto mt-5 max-w-[22rem] space-y-4">
        {message && <Alert tone={invalid ? "error" : "info"}>{message}</Alert>}
        <Button type="submit" size="lg" variant="dark" block disabled={pin.length !== 6 || busy}>
          {busy ? (
            <>
              <Spinner /> {t.checking}
            </>
          ) : (
            t.continue
          )}
        </Button>
        <p className="text-center text-sm text-black/50">{t.pinHelp}</p>
      </div>
    </form>
  );
}

function AmountHero({ unlocked, fundName }: { unlocked: ClaimUnlock; fundName: string }) {
  return (
    <div className="rounded-3xl bg-ink px-5 py-8 text-center text-white">
      <p className="text-[2.5rem] font-extrabold leading-none tracking-tight sm:text-5xl">
        <span className="text-gold">{unlocked.amountDisplay}</span> {t.isYours}
      </p>
      <p className="mt-3 text-lg text-white/75">{t.from(fundName)}</p>
      <p className="mx-auto mt-5 max-w-xs rounded-2xl bg-white/10 px-3.5 py-1.5 text-[15px] text-white/80">
        <Icon name="clock" className="mr-1.5 inline size-4 align-[-3px]" />
        {t.worksUntil(formatDateFriendly(unlocked.expiresAt))}
      </p>
    </div>
  );
}

function OptionCard({ icon, title, body, badge, onClick }: { icon: "bank" | "clock"; title: string; body: string; badge?: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-4 rounded-2xl bg-white p-4 text-left ring-1 ring-black/[0.08] transition hover:ring-ink/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink active:scale-[0.99]"
    >
      <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-gold/20 text-gold-dark">
        <Icon name={icon} className="size-6" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2 text-lg font-bold text-ink">
          {title} {badge}
        </span>
        <span className="mt-0.5 block text-[15px] text-black/60">{body}</span>
      </span>
      <Icon name="arrow" className="size-5 shrink-0 text-black/35" />
    </button>
  );
}

function StepHeader({ title, amount, onBack, badge }: { title: string; amount: string; onBack: () => void; badge?: ReactNode }) {
  return (
    <div className="mb-6">
      <button type="button" onClick={onBack} className="-ml-2 mb-3 inline-flex min-h-10 items-center gap-1 rounded-lg px-2 text-[15px] font-semibold text-black/60 hover:text-ink">
        <Icon name="arrow" className="size-4 rotate-180" />
        {t.back}
      </button>
      <h1 className="flex flex-wrap items-center gap-2 text-[1.75rem] font-bold leading-tight">
        {title} {badge}
      </h1>
      <p className="mt-1 text-lg text-black/60">{amount}</p>
    </div>
  );
}

/**
 * Demo cash-out form for the payout's currency: a free-text bank name, then the details that currency's banks use
 * (BANK_FIELDS). They are checked here and by the API, then discarded.
 */
export function CashoutStep({ unlocked, onBack, onSubmit }: { unlocked: ClaimUnlock; onBack: () => void; onSubmit: (details: CashoutDetails) => Promise<string | null> }) {
  const fields = BANK_FIELDS[unlocked.currency];
  const [bank, setBank] = useState("");
  const [values, setValues] = useState<Partial<Record<BankField, string>>>({});
  const [errors, setErrors] = useState<Partial<Record<BankField | "bank" | "form", string>>>({});
  const [busy, setBusy] = useState(false);

  return (
    <form
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        const next: typeof errors = {};
        if (bank.trim().length < 2) next.bank = t.bankRequired;
        for (const f of fields) {
          if (!bankFieldValid(values[f.field] ?? "", f)) next[f.field] = t.fieldInvalid(t.bankFields[f.field], t.digits(f.min, f.max));
        }
        setErrors(next);
        if (Object.keys(next).length) return;
        setBusy(true);
        const details: CashoutDetails = { bankName: bank.trim(), accountNumber: "" };
        for (const f of fields) details[f.field] = (values[f.field] ?? "").replace(/[\s-]/g, "");
        const error = await onSubmit(details);
        setBusy(false);
        if (error) setErrors({ form: error });
      }}
    >
      <StepHeader title={t.cashoutTitle} amount={unlocked.amountDisplay} onBack={onBack} badge={<DemoBadge />} />
      <div className="space-y-5">
        <Field label={t.bankLabel} htmlFor="bank" error={errors.bank}>
          <input
            id="bank"
            value={bank}
            onChange={(e) => setBank(e.target.value.slice(0, 80))}
            autoComplete="off"
            placeholder={t.bankPlaceholder}
            className={inputClass}
            aria-invalid={!!errors.bank || undefined}
          />
        </Field>
        {fields.map((f) => (
          <Field key={f.field} label={t.bankFields[f.field]} htmlFor={f.field} help={t.digits(f.min, f.max)} error={errors[f.field]}>
            <input
              id={f.field}
              value={values[f.field] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [f.field]: e.target.value.replace(/[^\d\s-]/g, "").slice(0, f.max + 4) }))}
              inputMode="numeric"
              autoComplete="off"
              className={`${inputClass} text-lg tracking-widest tabular-nums`}
              aria-invalid={!!errors[f.field] || undefined}
            />
          </Field>
        ))}
        {errors.form && <Alert>{errors.form}</Alert>}
        <Button type="submit" size="lg" block disabled={busy}>
          {busy ? (
            <>
              <Spinner /> {t.sending}
            </>
          ) : (
            t.sendToBank
          )}
        </Button>
        <div className="rounded-xl bg-amber-50 p-3.5 text-[15px] text-amber-950 ring-1 ring-inset ring-amber-200">
          <p className="font-semibold">{t.demoNote}</p>
          <p className="mt-1 text-amber-900/80">{t.notKept}</p>
        </div>
      </div>
    </form>
  );
}

function WalletStep({ unlocked, testnet, onBack, onSubmit }: { unlocked: ClaimUnlock; testnet: boolean; onBack: () => void; onSubmit: (address: string) => Promise<string | null> }) {
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <form
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        // Pasted addresses often carry spaces or line breaks; no Zcash address contains any.
        const value = address.replace(/\s+/g, "");
        if (value.length < 30) {
          setError(adv.invalid);
          return;
        }
        setBusy(true);
        setError(await onSubmit(value));
        setBusy(false);
      }}
    >
      <StepHeader title={adv.title} amount={`${unlocked.amountDisplay} · ${unlocked.amountZecDisplay}`} onBack={onBack} />
      <div className="space-y-5">
        <Field label={adv.addressLabel} htmlFor="zaddr" help={testnet ? adv.testnetHint : undefined} error={error}>
          <textarea
            id="zaddr"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            rows={3}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            placeholder={testnet ? "utest1…" : "u1…"}
            className={`${inputClass} py-3 font-mono text-sm`}
            aria-invalid={!!error || undefined}
          />
        </Field>
        <Button type="submit" size="lg" variant="dark" block disabled={busy || !address.trim()}>
          {busy ? (
            <>
              <Spinner /> {t.sending}
            </>
          ) : (
            adv.send
          )}
        </Button>
      </div>
    </form>
  );
}
