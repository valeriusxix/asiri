import { Router, type Request, type RequestHandler } from "express";
import * as z from "zod";
import { safeEqualString } from "../lib/crypto.js";
import { HttpError, parseBody } from "../lib/http.js";
import type { AppContext } from "../services/context.js";

export const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;

const LoginBody = z.object({ email: z.string().trim().max(320), password: z.string().max(500) });

/** The signed cookie carries the email and issue time; the issue time is checked server-side too. */
export function sessionEmail(req: Request, ctx: AppContext): string | null {
  const s = req.session;
  if (!s || typeof s.email !== "string" || typeof s.iat !== "number") return null;
  if (ctx.now().getTime() - s.iat > SESSION_MAX_AGE_MS) return null;
  return s.email === ctx.env.ADMIN_EMAIL ? s.email : null;
}

export function requireAdmin(ctx: AppContext): RequestHandler {
  return (req, _res, next) => {
    if (!sessionEmail(req, ctx)) throw new HttpError(401, "unauthorized");
    next();
  };
}

export function authRoutes(ctx: AppContext, loginLimiter: RequestHandler): Router {
  const { env } = ctx;
  const r = Router();

  r.post("/login", loginLimiter, (req, res) => {
    const body = parseBody(LoginBody, req.body);
    // Both comparisons always run (no short-circuit) and are constant-time on sha256 digests.
    const emailOk = safeEqualString(body.email.toLowerCase(), env.ADMIN_EMAIL.toLowerCase());
    const passwordOk = safeEqualString(body.password, env.ADMIN_PASSWORD);
    if (!(emailOk && passwordOk)) throw new HttpError(401, "invalid_credentials");
    req.session!.email = env.ADMIN_EMAIL;
    req.session!.iat = ctx.now().getTime();
    res.json({ email: env.ADMIN_EMAIL });
  });

  r.post("/logout", (req, res) => {
    req.session = null;
    res.json({ ok: true });
  });

  r.get("/me", (req, res) => {
    const email = sessionEmail(req, ctx);
    if (!email) throw new HttpError(401, "unauthorized");
    res.json({ email });
  });

  return r;
}
