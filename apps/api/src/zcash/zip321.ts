import { zatToZecString } from "../lib/money.js";

export const MAX_MEMO_BYTES = 512;

export interface PaymentRequest {
  address: string;
  amountZat?: number;
  memo?: string;
  message?: string;
}

/**
 * ZIP-321 single-payment URI:
 * zcash:<address>?amount=<decimal ZEC>&memo=<base64url(UTF-8 memo), no padding>&message=<url-encoded>
 */
export function buildPaymentUri(req: PaymentRequest): string {
  const params: string[] = [];
  if (req.amountZat !== undefined) {
    if (!Number.isSafeInteger(req.amountZat) || req.amountZat <= 0) throw new RangeError("amountZat must be a positive integer");
    params.push(`amount=${zatToZecString(req.amountZat)}`);
  }
  if (req.memo !== undefined) {
    const bytes = Buffer.from(req.memo, "utf8");
    if (bytes.length > MAX_MEMO_BYTES) throw new RangeError(`memo must be at most ${MAX_MEMO_BYTES} bytes`);
    params.push(`memo=${bytes.toString("base64url")}`);
  }
  if (req.message !== undefined) params.push(`message=${encodeURIComponent(req.message)}`);
  return `zcash:${req.address}${params.length ? `?${params.join("&")}` : ""}`;
}
