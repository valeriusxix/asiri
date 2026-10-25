import { Router, type RequestHandler } from "express";
import * as z from "zod";
import { HttpError, parseBody } from "../lib/http.js";
import type { AppContext } from "../services/context.js";
import { openClaim, redeemClaim, unlockClaim } from "../services/payouts.js";

// Bodies on these routes carry secrets, PINs, claim tokens, addresses and bank details.
// They are never logged (the request logger records method, path, status and duration only).

const PAYOUT_ID = /^[A-Za-z0-9]{10}$/;
const secret = z.string().min(16).max(128);
const claimToken = z.string().min(16).max(128);

const OpenBody = z.object({ secret });
const UnlockBody = z.object({ secret, pin: z.string().regex(/^\d{6}$/, "PIN must be 6 digits") });
const RedeemBody = z.discriminatedUnion("method", [
  z.object({ claimToken, method: z.literal("zcash_address"), zcashAddress: z.string().trim().min(10).max(1000) }),
  z.object({
    claimToken,
    method: z.literal("cashout_demo"),
    bankName: z.string().trim().min(2).max(80),
    accountNumber: z.string().regex(/^\d{10}$/, "Account number must be 10 digits (NUBAN)"),
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
    // bankName / accountNumber are validated above and then dropped: never stored, logged or forwarded.
    const input =
      body.method === "zcash_address"
        ? { claimToken: body.claimToken, method: body.method, zcashAddress: body.zcashAddress }
        : { claimToken: body.claimToken, method: body.method };
    res.json(await redeemClaim(ctx, id, input));
  });

  return r;
}
