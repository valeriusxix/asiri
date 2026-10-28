// Mirrors the API response shapes in Agent.md Section 8 (plus the additive fields in docs/DECISIONS.md D-017).
// Keep in sync by hand: there is deliberately no shared package between web and api.

import type { CurrencyCode } from "./currency";

export type Network = "testnet" | "mainnet";
export type Category = "medical" | "legal" | "food" | "transport" | "shelter" | "other";
export type PayoutStatus = "active" | "claiming" | "claimed" | "expired" | "cancelled" | "locked";
export type ClaimMethod = "zcash_address" | "cashout_demo";
export type PublicClaimStatus = "available" | "claimed" | "expired" | "cancelled" | "locked";

export const CATEGORIES: Category[] = ["medical", "legal", "food", "transport", "shelter", "other"];

export interface Health {
  ok: true;
  mode: "mock" | "zingo";
  network: Network;
  demoMode: boolean;
}

export interface Fund {
  name: string;
  description: string;
  network: Network;
  receiveAddress: string;
  ufvk: string;
  paymentUri: string;
  demoMode: boolean;
  mode: "mock" | "zingo";
  fundCurrency: CurrencyCode;
}

export interface Price {
  /** ZEC price in each supported currency, and where each came from. */
  rates: Record<CurrencyCode, number>;
  sources: Record<CurrencyCode, "coingecko" | "fixed">;
  fundCurrency: CurrencyCode;
  updatedAt: string;
}

export interface ReportStats {
  fundName: string;
  periodStart: string;
  periodEnd: string;
  periodLabel: string;
  /** Absent on reports written before audit M2. */
  periodDays?: number;
  currency: CurrencyCode;
  currencyName: string;
  currencySymbol: string;
  rateZecFiat: number;
  donationsReceived: string;
  donationsCount: number;
  simulatedDonations: string;
  paidOut: string;
  paymentsCount: number;
  /** Absent on reports written before audit M1. */
  demoCashouts?: string;
  demoCashoutsCount?: number;
  waitingToBeClaimed: string;
  byCategory: { category: string; payments: number; amount: string }[];
}

export interface Transparency {
  fundName: string;
  network: Network;
  mode: "mock" | "zingo";
  fundCurrency: CurrencyCode;
  totals: {
    receivedZat: number;
    simulatedZat: number;
    paidOutZat: number;
    outstandingZat: number;
    payoutsCount: number;
    /** Part of paidOutZat / payoutsCount: demo cash-outs, where no money moved. */
    demoCashoutZat: number;
    demoCashoutCount: number;
  };
  byCategory: { category: string; count: number; amountZat: number }[];
  weekly: { weekStart: string; receivedZat: number; paidOutZat: number }[];
  latestReport: { body: string; periodStart: string; periodEnd: string; publishedAt: string; stats?: ReportStats } | null;
  ufvk: string;
  verifyHint: string;
  updatedAt: string;
}

export interface ClaimOpen {
  status: PublicClaimStatus;
  fundName: string;
}

export interface ClaimUnlock {
  amountZat: number;
  amountZecDisplay: string;
  /** The payout's own currency; the recipient never chooses one. */
  currency: CurrencyCode;
  amountDisplay: string;
  expiresAt: string;
  claimToken: string;
}

/** Demo cash-out details for the payout's currency: checked, then discarded by the API. */
export interface CashoutDetails {
  bankName: string;
  accountNumber: string;
  routingNumber?: string;
  sortCode?: string;
  institutionNumber?: string;
  transitNumber?: string;
}

export interface ClaimRedeem {
  status: "claimed";
  method: ClaimMethod;
  txid?: string;
  demo: boolean;
}

export interface Overview {
  spendableZat: number;
  pendingZat: number;
  reservedZat: number;
  settledOffchainZat: number;
  availableZat: number;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  counts: { active: number; claimed: number; expired: number; cancelled: number; locked: number };
  fundCurrency: CurrencyCode;
  rates: Record<CurrencyCode, number>;
  mode: "mock" | "zingo";
  network: Network;
}

export interface AdminPayout {
  id: string;
  amountZat: number;
  feeBufferZat: number;
  currency: CurrencyCode;
  amountFiatMinor: number;
  rateZecFiat: number;
  amountDisplay: string;
  amountZecDisplay: string;
  category: Category;
  internalNote: string | null;
  status: PayoutStatus;
  pinAttempts: number;
  claimMethod: ClaimMethod | null;
  claimTxid: string | null;
  createdAt: string;
  expiresAt: string;
  claimedAt: string | null;
}

export interface CreatedPayout {
  payout: AdminPayout;
  link: string;
  pin: string;
  whatsappUrl: string;
  smsUrl: string;
}

export interface AdminDonation {
  id: string;
  source: "zcash" | "simulated";
  txid: string | null;
  amountZat: number;
  amountZecDisplay: string;
  /** Approximate, in the fund currency at today's rate. */
  amountDisplay: string;
  memo: string | null;
  observedAt: string;
}

export interface Report {
  id: string;
  periodStart: string;
  periodEnd: string;
  stats: ReportStats;
  body: string;
  generator: "claude" | "template";
  published: boolean;
  createdAt: string;
  publishedAt: string | null;
}
