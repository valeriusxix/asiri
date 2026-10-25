import * as z from "zod";

export interface PriceQuote {
  zecNgn: number;
  zecUsd: number;
  source: "coingecko" | "fixed";
  updatedAt: string;
}

export type Fetcher = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  json(): Promise<unknown>;
}>;

export interface PriceServiceOptions {
  source: "coingecko" | "fixed";
  fixedZecNgn: number;
  fixedZecUsd: number;
  fetcher?: Fetcher;
  now?: () => Date;
  ttlMs?: number;
  /** After a failed fetch, serve the fixed rate for this long before retrying. */
  failureTtlMs?: number;
  timeoutMs?: number;
}

export const COINGECKO_URL = "https://api.coingecko.com/api/v3/simple/price?ids=zcash&vs_currencies=ngn,usd";

const CoinGeckoResponse = z.object({ zcash: z.object({ ngn: z.number().positive(), usd: z.number().positive() }) });

/** ZEC price in NGN/USD. CoinGecko with a 5-minute cache; falls back to the fixed env rates on any failure. */
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
    if (this.opts.source === "fixed") return this.fixed();
    const nowMs = this.now().getTime();
    if (this.cached && this.cached.expiresAt > nowMs) return this.cached.quote;
    this.inflight ??= this.refresh().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private fixed(): PriceQuote {
    return { zecNgn: this.opts.fixedZecNgn, zecUsd: this.opts.fixedZecUsd, source: "fixed", updatedAt: this.now().toISOString() };
  }

  private async refresh(): Promise<PriceQuote> {
    const nowMs = this.now().getTime();
    try {
      const res = await this.fetcher(COINGECKO_URL, {
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 3000),
        headers: { accept: "application/json" },
      });
      if (!res.ok) throw new Error("price fetch failed");
      const data = CoinGeckoResponse.parse(await res.json());
      const quote: PriceQuote = {
        zecNgn: data.zcash.ngn,
        zecUsd: data.zcash.usd,
        source: "coingecko",
        updatedAt: this.now().toISOString(),
      };
      this.cached = { quote, expiresAt: nowMs + (this.opts.ttlMs ?? 5 * 60_000) };
      return quote;
    } catch {
      const quote = this.fixed();
      this.cached = { quote, expiresAt: nowMs + (this.opts.failureTtlMs ?? 60_000) };
      return quote;
    }
  }
}
