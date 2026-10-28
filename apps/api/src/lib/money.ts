// Money is always integer zatoshis (1 ZEC = 100,000,000 zat). Floats appear only for exchange rates.

export const ZAT_PER_ZEC = 100_000_000;

/** Exact decimal ZEC string from zat, no trailing zeros: 83333333 -> "0.83333333", 100000000 -> "1". */
export function zatToZecString(zat: number): string {
  if (!Number.isSafeInteger(zat) || zat < 0) throw new RangeError("zat must be a non-negative safe integer");
  const whole = Math.floor(zat / ZAT_PER_ZEC);
  const frac = (zat % ZAT_PER_ZEC).toString().padStart(8, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

/** Display string such as "0.8333 ZEC" (rounded down to `decimals`). */
export function formatZec(zat: number, decimals = 4): string {
  const factor = 10 ** (8 - decimals);
  const truncated = Math.floor(zat / factor) * factor;
  const [whole, frac = ""] = zatToZecString(truncated).split(".");
  const shown = frac.padEnd(Math.min(decimals, 2), "0");
  return `${Number(whole).toLocaleString("en-US")}${shown ? `.${shown}` : ""} ZEC`;
}

// Fiat amounts (any supported currency) live in lib/currency.ts.
