// Mirrors apps/api/src/lib/currency.ts and lib/bankDetails.ts. Keep in sync by hand: there is deliberately no shared
// package between web and api (Agent.md Section 5). ZEC settles; fiat is only for choosing and showing amounts.

export const CURRENCY_CODES = ["NGN", "USD", "GBP", "CAD"] as const;
export type CurrencyCode = (typeof CURRENCY_CODES)[number];

export interface Currency {
  code: CurrencyCode;
  symbol: string;
  locale: string;
  minorUnits: number;
  showZeroMinor: boolean;
  payout: { min: number; max: number };
  donation: { min: number; max: number };
  /** Quick-pick payout amounts on the organizer's form, in major units. */
  presets: number[];
}

export const CURRENCIES: Record<CurrencyCode, Currency> = {
  NGN: { code: "NGN", symbol: "₦", locale: "en-NG", minorUnits: 2, showZeroMinor: false, payout: { min: 500, max: 5_000_000 }, donation: { min: 100, max: 10_000_000 }, presets: [10_000, 25_000, 50_000, 100_000] },
  USD: { code: "USD", symbol: "$", locale: "en-US", minorUnits: 2, showZeroMinor: true, payout: { min: 1, max: 5_000 }, donation: { min: 1, max: 10_000 }, presets: [25, 50, 100, 250] },
  GBP: { code: "GBP", symbol: "£", locale: "en-GB", minorUnits: 2, showZeroMinor: true, payout: { min: 1, max: 5_000 }, donation: { min: 1, max: 10_000 }, presets: [20, 50, 100, 200] },
  CAD: { code: "CAD", symbol: "CA$", locale: "en-CA", minorUnits: 2, showZeroMinor: true, payout: { min: 1, max: 5_000 }, donation: { min: 1, max: 10_000 }, presets: [25, 50, 100, 250] },
};

export const isCurrencyCode = (v: unknown): v is CurrencyCode => typeof v === "string" && (CURRENCY_CODES as readonly string[]).includes(v);

const factor = (c: Currency) => 10 ** c.minorUnits;

/** "19.99" or "1,250" as typed, to minor units; null when it is not a number or has too many decimals. */
export function parseAmount(input: string, code: CurrencyCode): number | null {
  const c = CURRENCIES[code];
  const cleaned = input.replace(/[\s,]/g, "").replace(c.symbol, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const scaled = Number(cleaned) * factor(c);
  const minor = Math.round(scaled);
  return Math.abs(scaled - minor) < 1e-6 ? minor : null;
}

/** "₦50,000", "$1,250.00", "£19.99", "CA$1,250.00": Intl.NumberFormat with the currency's locale and code. */
export function formatMoney(minor: number, code: CurrencyCode): string {
  const c = CURRENCIES[code];
  const digits = minor % factor(c) === 0 && !c.showZeroMinor ? 0 : c.minorUnits;
  return new Intl.NumberFormat(c.locale, { style: "currency", currency: c.code, minimumFractionDigits: digits, maximumFractionDigits: digits })
    .formatToParts(minor / factor(c))
    .map((p) => (p.type === "currency" ? c.symbol : p.value))
    .join("");
}

/** Approximate minor units for an amount held in zat. Currencies that drop ".00" round to whole units. */
export function zatToFiatMinor(zat: number, rateZecFiat: number, code: CurrencyCode): number {
  const c = CURRENCIES[code];
  const minor = Math.round((zat / 100_000_000) * rateZecFiat * factor(c));
  return c.showZeroMinor ? minor : Math.round(minor / factor(c)) * factor(c);
}

export const fiatMinorToZat = (minor: number, rateZecFiat: number, code: CurrencyCode) =>
  Math.round((minor / factor(CURRENCIES[code]) / rateZecFiat) * 100_000_000);

export const formatZatAs = (zat: number, rateZecFiat: number, code: CurrencyCode) => formatMoney(zatToFiatMinor(zat, rateZecFiat, code), code);

/** Chart axis labels: "$1.2K", "₦850K", "£40". */
export function compactMoney(major: number, code: CurrencyCode): string {
  const c = CURRENCIES[code];
  return new Intl.NumberFormat(c.locale, { style: "currency", currency: c.code, notation: "compact", maximumFractionDigits: 1 })
    .formatToParts(major)
    .map((p) => (p.type === "currency" ? c.symbol : p.value))
    .join("");
}

/** Minor units within this currency's limits for a payout or donation. */
export function withinLimits(minor: number, code: CurrencyCode, kind: "payout" | "donation"): boolean {
  const c = CURRENCIES[code];
  return minor >= c[kind].min * factor(c) && minor <= c[kind].max * factor(c);
}

/** "$1.00 to $5,000.00" */
export const limitsText = (code: CurrencyCode, kind: "payout" | "donation") => {
  const c = CURRENCIES[code];
  return `${formatMoney(c[kind].min * factor(c), code)} to ${formatMoney(c[kind].max * factor(c), code)}`;
};

// --- Demo cash-out details (mirrors api lib/bankDetails.ts) ---

export type BankField = "accountNumber" | "routingNumber" | "sortCode" | "institutionNumber" | "transitNumber";

/** Fields each currency asks for, in order, with the digit counts the API checks (after removing spaces and dashes). */
export const BANK_FIELDS: Record<CurrencyCode, { field: BankField; min: number; max: number }[]> = {
  NGN: [{ field: "accountNumber", min: 10, max: 10 }],
  USD: [
    { field: "routingNumber", min: 9, max: 9 },
    { field: "accountNumber", min: 4, max: 17 },
  ],
  GBP: [
    { field: "sortCode", min: 6, max: 6 },
    { field: "accountNumber", min: 8, max: 8 },
  ],
  CAD: [
    { field: "institutionNumber", min: 3, max: 3 },
    { field: "transitNumber", min: 5, max: 5 },
    { field: "accountNumber", min: 7, max: 12 },
  ],
};

export function bankFieldValid(value: string, spec: { min: number; max: number }): boolean {
  const digits = value.replace(/[\s-]/g, "");
  return /^\d+$/.test(digits) && digits.length >= spec.min && digits.length <= spec.max;
}

/** A ZEC rate as minor units of that currency, for showing "1 ZEC = $1,203.37". */
export const toMinorRate = (rate: number, code: CurrencyCode) => Math.round(rate * factor(CURRENCIES[code]));
