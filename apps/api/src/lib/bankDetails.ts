// Demo cash-out details, checked against the payout currency's usual account format, then discarded: never stored,
// logged or forwarded (Agent.md 8.2). Mirrored on the claim page in apps/web/src/currency.ts.
import type { CurrencyCode } from "./currency.js";

export interface BankDetails {
  bankName: string;
  accountNumber: string;
  routingNumber?: string;
  sortCode?: string;
  institutionNumber?: string;
  transitNumber?: string;
}

type Field = Exclude<keyof BankDetails, "bankName">;

/** Per currency: each required field and its pattern (checked after removing spaces and dashes). */
export const BANK_FORMATS: Record<CurrencyCode, { field: Field; pattern: RegExp; message: string }[]> = {
  NGN: [{ field: "accountNumber", pattern: /^\d{10}$/, message: "Account number must be 10 digits" }],
  USD: [
    { field: "routingNumber", pattern: /^\d{9}$/, message: "Routing number must be 9 digits" },
    { field: "accountNumber", pattern: /^\d{4,17}$/, message: "Account number must be 4 to 17 digits" },
  ],
  GBP: [
    { field: "sortCode", pattern: /^\d{6}$/, message: "Sort code must be 6 digits" },
    { field: "accountNumber", pattern: /^\d{8}$/, message: "Account number must be 8 digits" },
  ],
  CAD: [
    { field: "institutionNumber", pattern: /^\d{3}$/, message: "Institution number must be 3 digits" },
    { field: "transitNumber", pattern: /^\d{5}$/, message: "Transit number must be 5 digits" },
    { field: "accountNumber", pattern: /^\d{7,12}$/, message: "Account number must be 7 to 12 digits" },
  ],
};

/** Field errors for these details in this currency, or null when they look right. Never echoes the values. */
export function bankDetailsErrors(currency: CurrencyCode, details: BankDetails): Record<string, string[]> | null {
  const errors: Record<string, string[]> = {};
  if (details.bankName.trim().length < 2) errors.bankName = ["Enter the bank name"];
  for (const { field, pattern, message } of BANK_FORMATS[currency]) {
    if (!pattern.test((details[field] ?? "").replace(/[\s-]/g, ""))) errors[field] = [message];
  }
  return Object.keys(errors).length ? errors : null;
}
