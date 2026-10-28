import type { CurrencyCode } from "./currency";
import type {
  AdminDonation,
  AdminPayout,
  Category,
  ClaimOpen,
  ClaimRedeem,
  CashoutDetails,
  ClaimUnlock,
  CreatedPayout,
  Fund,
  Health,
  Overview,
  Price,
  Report,
  Transparency,
} from "./types";

/** Error from the API: `code` is the `error` field of the JSON body ("network_error" when offline). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly body: Record<string, unknown>,
  ) {
    super(code);
  }
}

async function request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: "include",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "network_error", {});
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiError(res.status, typeof data.error === "string" ? data.error : "error", data);
  return data as T;
}

const get = <T>(path: string) => request<T>("GET", path);
const post = <T>(path: string, body: unknown = {}) => request<T>("POST", path, body);

export const api = {
  health: () => get<Health>("/health"),
  fund: () => get<Fund>("/fund"),
  price: () => get<Price>("/price"),
  transparency: () => get<Transparency>("/transparency"),
  simulateDonation: (amount: number, currency: CurrencyCode) => post<{ donationId: string; amountZat: number }>("/donations/simulate", { amount, currency }),

  claims: {
    open: (id: string, secret: string) => post<ClaimOpen>(`/claims/${id}/open`, { secret }),
    unlock: (id: string, secret: string, pin: string) => post<ClaimUnlock>(`/claims/${id}/unlock`, { secret, pin }),
    redeemToAddress: (id: string, claimToken: string, zcashAddress: string) =>
      post<ClaimRedeem>(`/claims/${id}/redeem`, { claimToken, method: "zcash_address", zcashAddress }),
    redeemCashout: (id: string, claimToken: string, details: CashoutDetails) =>
      post<ClaimRedeem>(`/claims/${id}/redeem`, { claimToken, method: "cashout_demo", ...details }),
  },

  auth: {
    login: (email: string, password: string) => post<{ email: string }>("/auth/login", { email, password }),
    logout: () => post<{ ok: true }>("/auth/logout"),
    me: () => get<{ email: string }>("/auth/me"),
  },

  admin: {
    overview: () => get<Overview>("/admin/overview"),
    sync: () => post<Overview>("/admin/sync"),
    donations: () => get<AdminDonation[]>("/admin/donations"),
    payouts: () => get<AdminPayout[]>("/admin/payouts"),
    createPayout: (body: { amount: number; currency: CurrencyCode; category: Category; internalNote?: string; expiresInDays?: number }) =>
      post<CreatedPayout>("/admin/payouts", body),
    cancelPayout: (id: string) => post<AdminPayout>(`/admin/payouts/${id}/cancel`),
    unlockPayout: (id: string) => post<AdminPayout>(`/admin/payouts/${id}/unlock`),
    reports: () => get<Report[]>("/admin/reports"),
    generateReport: (periodDays: number) => post<Report>("/admin/reports/generate", { periodDays }),
    publishReport: (id: string) => post<Report>(`/admin/reports/${id}/publish`),
  },

  dev: {
    mockDonate: (amountZat: number, memo?: string) => post<{ txid: string; amountZat: number }>("/dev/mock-donate", { amountZat, memo }),
  },
};
