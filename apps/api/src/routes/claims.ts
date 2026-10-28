import { Router, type RequestHandler } from "express";
import * as z from "zod";
import { bankDetailsErrors } from "../lib/bankDetails.js";
import type { CurrencyCode } from "../lib/currency.js";
import { HttpError, parseBody } from "../lib/http.js";
import type { AppContext } from "../services/context.js";
import { openClaim, redeemClaim, unlockClaim } from "../services/payouts.js";

// Bodies on these routes carry secrets, PINs, claim tokens, addresses and bank details.
// They are never logged (the request logger records method, path, status and duration only).

const PAYOUT_ID = /^[A-Za-z0-9]{10}$/;
const secret = z.string().min(16).max(128);
const claimToken = z.string().min(16).max(128);
// Every Zcash address encoding (unified, Sapling, TEX: bech32/bech32m; transparent: base58) is letters and digits only.
// Anything else never reaches zingo-cli, where it would be a command-line argument (audit L8).
const zcashAddress = z.string().trim().min(10).max(1000).regex(/^[A-Za-z0-9]+$/, "Not a Zcash address");

const bankField = z.string().trim().max(40);

const OpenBody = z.object({ secret });
const UnlockBody = z.object({ secret, pin: z.string().regex(/^\d{6}$/, "PIN must be 6 digits") });
const RedeemBody = z.discriminatedUnion("method", [
  z.object({ claimToken, method: z.literal("zcash_address"), zcashAddress }),
  // The fields each currency needs are checked against the payout's currency once the claim token is verified
  // (lib/bankDetails.ts), so a request without the token learns nothing about the payout.
  z.object({
    claimToken,
    method: z.literal("cashout_demo"),
    bankName: z.string().trim().min(2).max(80),
    accountNumber: bankField,
    routingNumber: bankField.optional(),
    sortCode: bankField.optional(),
    institutionNumber: bankField.optional(),
    transitNumber: bankField.optional(),
  }),
]);

function payoutId(raw: string | string[] | undefined): string {
  if (typeof raw !== "string" || !PAYOUT_ID.test(raw)) throw new HttpError(404, "not_found");
  return raw;
}

export function claimRoutes(ctx: AppContext, limiter: RequestHandler): Router {
  const r = Router();
  r.use(limiter);

  r.post("/:id/open", (req, res) => {
    const id = payoutId(req.params.id);
    const body = parseBody(OpenBody, req.body);
    res.json(openClaim(ctx, id, body.secret));
  });

  r.post("/:id/unlock", async (req, res) => {
    const id = payoutId(req.params.id);
    const body = parseBody(UnlockBody, req.body);
    res.json(await unlockClaim(ctx, id, body.secret, body.pin));
  });

  r.post("/:id/redeem", async (req, res) => {
    const id = payoutId(req.params.id);
    const body = parseBody(RedeemBody, req.body);
    // Bank details are only checked (inside this closure) and then dropped: never stored, logged or forwarded.
    const input =
      body.method === "zcash_address"
        ? { claimToken: body.claimToken, method: body.method, zcashAddress: body.zcashAddress }
        : { claimToken: body.claimToken, method: body.method, bankDetailsErrors: (currency: CurrencyCode) => bankDetailsErrors(currency, body) };
    res.json(await redeemClaim(ctx, id, input));
  });

  return r;
}
