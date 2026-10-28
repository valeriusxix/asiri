import { Router } from "express";
import * as z from "zod";
import { audit } from "../db/db.js";
import { parseBody } from "../lib/http.js";
import type { AppContext } from "../services/context.js";
import { mockReceive } from "../zcash/mock.js";
import { requireAdmin } from "./auth.js";

/** 100 ZEC per call: plenty for a demo, and the totals stay far below Number.MAX_SAFE_INTEGER. */
export const MOCK_DONATE_MAX_ZAT = 10_000_000_000;

const MockDonateBody = z.object({
  amountZat: z.int().min(1).max(MOCK_DONATE_MAX_ZAT),
  memo: z.string().max(512).optional(),
});

/**
 * Mounted only when ZCASH_MODE=mock; otherwise these paths fall through to the API 404.
 * Organizer session required (audit H3): the demo is served on a LAN, and anyone who could reach it would
 * otherwise be able to inflate the public totals and write memos into the organizer's donation list.
 */
export function devRoutes(ctx: AppContext): Router {
  const r = Router();
  r.use(requireAdmin(ctx));

  r.post("/mock-donate", (req, res) => {
    const body = parseBody(MockDonateBody, req.body);
    const { txid } = mockReceive(ctx.db, body.amountZat, { memo: body.memo, at: ctx.now() });
    audit(ctx.db, "dev.mock_donate", { amountZat: body.amountZat }, ctx.now());
    res.status(201).json({ txid, amountZat: body.amountZat });
  });

  return r;
}
