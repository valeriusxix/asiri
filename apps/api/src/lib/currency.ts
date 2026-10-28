// Supported fiat currencies, defined once (mirrored by hand in apps/web/src/currency.ts).
// ZEC is the settlement currency and every stored amount is integer zatoshis. Fiat is only for choosing and showing
// amounts. To add a currency: add its code and entry here, a FIXED_ZEC_<CODE> env var, and the same entry on the web.

export const CURRENCY_CODES = ["NGN", "USD", "GBP", "CAD"] as const;
export type CurrencyCode = (typeof CURRENCY_CODES)[number];

export interface Currency {
  code: CurrencyCode;
  /** English name, used in the AI report prompt: "Show amounts in US dollars using $ …". */
  name: string;
  /**
   * Symbol shown everywhere. Intl gives "$" for CAD in en-CA, which would read the same as USD on a page that mixes
   * currencies, so the formatter swaps in this symbol (D-038).
   */
  symbol: string;
  /** BCP 47 locale for grouping, decimals and symbol position. */
  locale: string;
  /** Digits after the decimal point. All four have 2; amounts are handled as integer minor units. */
  minorUnits: number;
  /** Whole amounts drop ".00" ("₦50,000"); the others keep it ("$50.00"). */
  showZeroMinor: boolean;
  /** Payout limits in major units (Agent.md Section 8.4). */
  payout: { min: number; max: number };
  /** Simulated card or bank donation limits in major units. */
  donation: { min: number; max: number };
}

export const CURRENCIES: Record<CurrencyCode, Currency> = {
  NGN: { code: "NGN", name: "Nigerian naira", symbol: "₦", locale: "en-NG", minorUnits: 2, showZeroMinor: false, payout: { min: 500, max: 5_000_000 }, donation: { min: 100, max: 10_000_000 } },
  USD: { code: "USD", name: "US dollars", symbol: "$", locale: "en-US", minorUnits: 2, showZeroMinor: true, payout: { min: 1, max: 5_000 }, donation: { min: 1, max: 10_000 } },
  GBP: { code: "GBP", name: "British pounds", symbol: "£", locale: "en-GB", minorUnits: 2, showZeroMinor: true, payout: { min: 1, max: 5_000 }, donation: { min: 1, max: 10_000 } },
  CAD: { code: "CAD", name: "Canadian dollars", symbol: "CA$", locale: "en-CA", minorUnits: 2, showZeroMinor: true, payout: { min: 1, max: 5_000 }, donation: { min: 1, max: 10_000 } },
};

export const isCurrencyCode = (v: unknown): v is CurrencyCode => typeof v === "string" && (CURRENCY_CODES as readonly string[]).includes(v);

const factor = (c: Currency) => 10 ** c.minorUnits;

/**
 * A user-entered major amount ("19.99", 50000) as integer minor units, or null when it has more decimals than the
 * currency allows. Tolerates binary float noise (19.99 * 100 = 1998.9999999999998).
 */
export function toMinor(amount: number, code: CurrencyCode): number | null {
  if (!Number.isFinite(amount)) return null;
  const scaled = amount * factor(CURRENCIES[code]);
  const minor = Math.round(scaled);
  return Math.abs(scaled - minor) < 1e-6 ? minor : null;
}

/** "₦50,000", "$1,250.00", "£19.99", "CA$1,250.00". Intl.NumberFormat with the currency's locale and code. */
export function formatMoney(minor: number, code: CurrencyCode): string {
  const c = CURRENCIES[code];
  const whole = minor % factor(c) === 0;
  const digits = whole && !c.showZeroMinor ? 0 : c.minorUnits;
  const parts = new Intl.NumberFormat(c.locale, {
    style: "currency",
    currency: c.code,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).formatToParts(minor / factor(c));
  return parts.map((p) => (p.type === "currency" ? c.symbol : p.value)).join("");
}

/**
 * Approximate fiat from zat at a rate (ZEC price in that currency), as minor units. Currencies that drop ".00" are
 * rounded to whole units, so approximations read "₦2,473,440" rather than "₦2,473,440.37".
 */
export function zatToFiatMinor(zat: number, rateZecFiat: number, code: CurrencyCode): number {
  const c = CURRENCIES[code];
  const minor = Math.round((zat / 100_000_000) * rateZecFiat * factor(c));
  return c.showZeroMinor ? minor : Math.round(minor / factor(c)) * factor(c);
}

/** Fiat minor units to zat at a rate. Rounded to the nearest zatoshi. */
export function fiatMinorToZat(minor: number, rateZecFiat: number, code: CurrencyCode): number {
  return Math.round((minor / factor(CURRENCIES[code]) / rateZecFiat) * 100_000_000);
}

/** Approximate fiat display for an amount held in zat: "about $1,443.53" without the "about". */
export const formatZatAs = (zat: number, rateZecFiat: number, code: CurrencyCode) => formatMoney(zatToFiatMinor(zat, rateZecFiat, code), code);

/**
 * Checks a major amount against a currency's limits ("payout" or "donation"). Returns minor units, or a message
 * that names the range in that currency ("Amount must be between $1.00 and $5,000.00").
 */
export function checkAmount(amount: number, code: CurrencyCode, kind: "payout" | "donation"): { minor: number } | { error: string } {
  const c = CURRENCIES[code];
  const { min, max } = c[kind];
  const minor = toMinor(amount, code);
  if (minor === null) return { error: `Use at most ${c.minorUnits} decimal places` };
  const f = factor(c);
  if (minor < min * f || minor > max * f) return { error: `Amount must be between ${formatMoney(min * f, code)} and ${formatMoney(max * f, code)}` };
  return { minor };
}
