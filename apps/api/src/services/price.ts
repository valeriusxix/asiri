import * as z from "zod";
import { CURRENCY_CODES, type CurrencyCode } from "../lib/currency.js";

export type PriceSource = "coingecko" | "fixed";

export interface PriceQuote {
  /** ZEC price in each supported currency. */
  rates: Record<CurrencyCode, number>;
  /** Where each rate came from: a currency missing from the live answer falls back to its fixed rate on its own. */
  sources: Record<CurrencyCode, PriceSource>;
  updatedAt: string;
}

export type Fetcher = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  json(): Promise<unknown>;
}>;

export interface PriceServiceOptions {
  source: PriceSource;
  fixed: Record<CurrencyCode, number>;
  fetcher?: Fetcher;
  now?: () => Date;
  ttlMs?: number;
  /** After a failed fetch, serve the fixed rates for this long before retrying. */
  failureTtlMs?: number;
  timeoutMs?: number;
}

export const COINGECKO_URL = `https://api.coingecko.com/api/v3/simple/price?ids=zcash&vs_currencies=${CURRENCY_CODES.map((c) => c.toLowerCase()).join(",")}`;

// Each currency is optional, so one missing or junk field falls back alone instead of failing the whole quote.
const positive = z.number().positive().optional().catch(undefined);
const CoinGeckoResponse = z.object({ zcash: z.object(Object.fromEntries(CURRENCY_CODES.map((c) => [c.toLowerCase(), positive]))) });

/** ZEC prices in every supported currency. CoinGecko with a 5-minute cache; falls back per currency to the fixed env rates. */
export class PriceService {
  private cached: { quote: PriceQuote; expiresAt: number } | null = null;
  private inflight: Promise<PriceQuote> | null = null;
  private readonly fetcher: Fetcher;
  private readonly now: () => Date;

  constructor(private readonly opts: PriceServiceOptions) {
    this.fetcher = opts.fetcher ?? ((url, init) => fetch(url, init));
    this.now = opts.now ?? (() => new Date());
  }

  async get(): Promise<PriceQuote> {
    if (this.opts.source === "fixed") return this.quote({});
    const nowMs = this.now().getTime();
    if (this.cached && this.cached.expiresAt > nowMs) return this.cached.quote;
    this.inflight ??= this.refresh().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  /** A quote from the live rates that are present, with the fixed rate for every other currency. */
  private quote(live: Partial<Record<CurrencyCode, number>>): PriceQuote {
    const rates = {} as Record<CurrencyCode, number>;
    const sources = {} as Record<CurrencyCode, PriceSource>;
    for (const c of CURRENCY_CODES) {
      const v = live[c];
      rates[c] = v ?? this.opts.fixed[c];
      sources[c] = v ? "coingecko" : "fixed";
    }
    return { rates, sources, updatedAt: this.now().toISOString() };
  }

  private async refresh(): Promise<PriceQuote> {
    const nowMs = this.now().getTime();
    try {
      const res = await this.fetcher(COINGECKO_URL, {
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 3000),
        headers: { accept: "application/json" },
      });
      if (!res.ok) throw new Error("price fetch failed");
      const data = CoinGeckoResponse.parse(await res.json()).zcash as Record<string, number | undefined>;
      const live = Object.fromEntries(CURRENCY_CODES.map((c) => [c, data[c.toLowerCase()]])) as Partial<Record<CurrencyCode, number>>;
      const quote = this.quote(live);
      const anyLive = CURRENCY_CODES.some((c) => quote.sources[c] === "coingecko");
      this.cached = { quote, expiresAt: nowMs + (anyLive ? (this.opts.ttlMs ?? 5 * 60_000) : (this.opts.failureTtlMs ?? 60_000)) };
      return quote;
    } catch {
      const quote = this.quote({});
      this.cached = { quote, expiresAt: nowMs + (this.opts.failureTtlMs ?? 60_000) };
      return quote;
    }
  }
}

/** The fixed rates from env, keyed by currency. */
export function fixedRates(env: { FIXED_ZEC_NGN: number; FIXED_ZEC_USD: number; FIXED_ZEC_GBP: number; FIXED_ZEC_CAD: number }): Record<CurrencyCode, number> {
  return { NGN: env.FIXED_ZEC_NGN, USD: env.FIXED_ZEC_USD, GBP: env.FIXED_ZEC_GBP, CAD: env.FIXED_ZEC_CAD };
}
