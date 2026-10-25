import { Router } from "express";
import * as z from "zod";
import { audit } from "../db/db.js";
import { parseBody } from "../lib/http.js";
import type { AppContext } from "../services/context.js";
import { mockReceive } from "../zcash/mock.js";

const MockDonateBody = z.object({
  amountZat: z.int().min(1).max(2_100_000_000_000_000),
  memo: z.string().max(512).optional(),
});

/** Mounted only when ZCASH_MODE=mock; otherwise these paths fall through to the API 404. */
export function devRoutes(ctx: AppContext): Router {
  const r = Router();

  r.post("/mock-donate", (req, res) => {
    const body = parseBody(MockDonateBody, req.body);
    const { txid } = mockReceive(ctx.db, body.amountZat, { memo: body.memo, at: ctx.now() });
    audit(ctx.db, "dev.mock_donate", { amountZat: body.amountZat }, ctx.now());
    res.status(201).json({ txid, amountZat: body.amountZat });
  });

  return r;
}
