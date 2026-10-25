import { Router } from "express";
import * as z from "zod";
import type { Jobs } from "../jobs.js";
import { HttpError, parseBody } from "../lib/http.js";
import type { AppContext } from "../services/context.js";
import { listDonations } from "../services/donations.js";
import {
  CATEGORIES,
  adminUnlockPayout,
  cancelPayout,
  createPayout,
  getBalances,
  listPayouts,
  statusCounts,
} from "../services/payouts.js";
import { generateReport, listReports, publishReport, type ReportWriter } from "../services/reports.js";
import { requireAdmin } from "./auth.js";

// Phone numbers (11 digits in Nigeria) and NUBAN account numbers (10) are recipient identity.
const LONG_DIGIT_RUN = /\d(?:[\s-]?\d){9,}/;

const CreatePayoutBody = z.object({
  amountNgn: z.int().min(500).max(5_000_000),
  category: z.enum(CATEGORIES),
  internalNote: z
    .string()
    .trim()
    .max(200)
    .refine((s) => !LONG_DIGIT_RUN.test(s), "Do not write phone or account numbers in the note")
    .optional(),
  expiresInDays: z.int().min(1).max(30).optional(),
});

const GenerateReportBody = z.object({ periodDays: z.int().min(1).max(90) });

export function adminRoutes(ctx: AppContext, jobs: Jobs, reportWriter: ReportWriter): Router {
  const r = Router();
  r.use(requireAdmin(ctx));

  const overview = async () => {
    const balances = await getBalances(ctx);
    const quote = await ctx.price.get();
    return {
      ...balances,
      lastSyncAt: jobs.lastSyncAt,
      lastSyncError: jobs.lastSyncError,
      counts: statusCounts(ctx.db),
      zecNgn: quote.zecNgn,
      mode: ctx.env.ZCASH_MODE,
      network: ctx.env.ZCASH_NETWORK,
    };
  };

  r.get("/overview", async (_req, res) => {
    res.json(await overview());
  });

  r.post("/sync", async (_req, res) => {
    await jobs.runOnce();
    res.json(await overview());
  });

  r.get("/donations", async (_req, res) => {
    const quote = await ctx.price.get();
    res.json(listDonations(ctx.db, quote.zecNgn));
  });

  r.get("/payouts", (_req, res) => {
    res.json(listPayouts(ctx.db));
  });

  r.post("/payouts", async (req, res) => {
    const body = parseBody(CreatePayoutBody, req.body);
    res.status(201).json(await createPayout(ctx, body));
  });

  r.post("/payouts/:id/cancel", (req, res) => {
    res.json(cancelPayout(ctx, idParam(req.params.id)));
  });

  r.post("/payouts/:id/unlock", (req, res) => {
    res.json(adminUnlockPayout(ctx, idParam(req.params.id)));
  });

  r.get("/reports", (_req, res) => {
    res.json(listReports(ctx.db));
  });

  r.post("/reports/generate", async (req, res) => {
    const body = parseBody(GenerateReportBody, req.body);
    res.status(201).json(await generateReport(ctx, body.periodDays, reportWriter));
  });

  r.post("/reports/:id/publish", (req, res) => {
    res.json(publishReport(ctx, idParam(req.params.id)));
  });

  return r;
}

function idParam(raw: string | string[] | undefined): string {
  if (typeof raw !== "string" || raw.length > 64) throw new HttpError(404, "not_found");
  return raw;
}
