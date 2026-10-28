import { Router } from "express";
import * as z from "zod";
import { CURRENCY_CODES, checkAmount } from "../lib/currency.js";
import { HttpError, parseBody } from "../lib/http.js";
import type { AppContext } from "../services/context.js";
import { simulateDonation } from "../services/donations.js";
import { getTransparency } from "../services/transparency.js";
import { buildPaymentUri } from "../zcash/zip321.js";

const SimulateBody = z.object({ amount: z.number().positive(), currency: z.enum(CURRENCY_CODES).optional() });

export function publicRoutes(ctx: AppContext): Router {
  const { env } = ctx;
  const r = Router();

  r.get("/health", (_req, res) => {
    res.json({ ok: true, mode: env.ZCASH_MODE, network: env.ZCASH_NETWORK, demoMode: env.DEMO_MODE });
  });

  r.get("/fund", async (_req, res) => {
    const receiveAddress = await ctx.adapter.getReceiveAddress();
    res.json({
      name: env.FUND_NAME,
      description: env.FUND_DESCRIPTION,
      network: env.ZCASH_NETWORK,
      receiveAddress,
      ufvk: await ctx.adapter.getUfvk(),
      paymentUri: buildPaymentUri({ address: receiveAddress, message: `Donation to ${env.FUND_NAME}` }),
      demoMode: env.DEMO_MODE,
      mode: env.ZCASH_MODE,
      fundCurrency: env.FUND_CURRENCY,
    });
  });

  r.get("/price", async (_req, res) => {
    res.json({ ...(await ctx.price.get()), fundCurrency: env.FUND_CURRENCY });
  });

  r.get("/transparency", async (_req, res) => {
    res.json(await getTransparency(ctx));
  });

  r.post("/donations/simulate", async (req, res) => {
    if (!env.DEMO_MODE) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const body = parseBody(SimulateBody, req.body);
    const currency = body.currency ?? env.FUND_CURRENCY;
    const checked = checkAmount(body.amount, currency, "donation");
    if ("error" in checked) throw new HttpError(400, "validation_error", { details: { formErrors: [], fieldErrors: { amount: [checked.error] } } });
    res.json(await simulateDonation(ctx, checked.minor, currency));
  });

  return r;
}
