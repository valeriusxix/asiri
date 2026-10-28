import { CURRENCY_CODES, type CurrencyCode } from "../currency";

/** A small NGN / USD / GBP / CAD toggle. Figures it controls are converted on the client and labelled approximate. */
export function CurrencySwitcher({ value, onChange, label, dark }: { value: CurrencyCode; onChange: (c: CurrencyCode) => void; label: string; dark?: boolean }) {
  return (
    <div role="radiogroup" aria-label={label} className={`inline-flex rounded-xl p-0.5 ${dark ? "bg-white/10" : "bg-black/[0.05]"}`}>
      {CURRENCY_CODES.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          onClick={() => onChange(c)}
          className={`min-h-9 min-w-12 rounded-[10px] px-2.5 text-xs font-bold tracking-wide transition ${
            value === c ? (dark ? "bg-white text-ink" : "bg-white text-ink shadow-sm") : dark ? "text-white/70 hover:text-white" : "text-black/55 hover:text-ink"
          }`}
        >
          {c}
        </button>
      ))}
    </div>
  );
}
