import { existsSync } from "node:fs";
import path from "node:path";
import cookieSession from "cookie-session";
import express, { type ErrorRequestHandler, type RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import type { DB } from "./db/db.js";
import { ROOT_DIR, type Env } from "./env.js";
import { Jobs } from "./jobs.js";
import { HttpError } from "./lib/http.js";
import { createLogger, type Logger } from "./lib/logger.js";
import { adminRoutes } from "./routes/admin.js";
import { SESSION_MAX_AGE_MS, authRoutes } from "./routes/auth.js";
import { claimRoutes } from "./routes/claims.js";
import { devRoutes } from "./routes/dev.js";
import { publicRoutes } from "./routes/public.js";
import type { AppContext } from "./services/context.js";
import { fixedRates, PriceService, type Fetcher } from "./services/price.js";
import { createReportWriter } from "./services/reportWriter.js";
import type { ReportWriter } from "./services/reports.js";
import { guardAdapter, ZcashError, type ZcashAdapter } from "./zcash/adapter.js";
import { cacheAdapter } from "./zcash/cache.js";

export interface RateLimits {
  /** Requests per minute per IP. */
  claims: number;
  login: number;
  global: number;
}

export interface AppDeps {
  db: DB;
  adapter: ZcashAdapter;
  env: Env;
  logger?: Logger;
  now?: () => Date;
  /** Injected fetcher for the price service (tests never hit the network). */
  fetcher?: Fetcher;
  price?: PriceService;
  reportWriter?: ReportWriter;
  rateLimits?: Partial<RateLimits>;
  /** Directory of the built web app; served when it exists. */
  webDistDir?: string;
}

export interface AppServices {
  ctx: AppContext;
  jobs: Jobs;
}

/** Express app factory. Tests inject an in-memory DB and a fresh MockAdapter. */
export function createApp(deps: AppDeps): express.Express {
  const { env } = deps;
  const logger = deps.logger ?? createLogger(env.NODE_ENV === "test" ? "silent" : "info");
  const now = deps.now ?? (() => new Date());
  const guarded = guardAdapter(deps.adapter);
  const ctx: AppContext = {
    db: deps.db,
    // zingo-cli calls are slow processes behind one mutex; cache what never (or rarely) changes.
    adapter: env.ZCASH_MODE === "zingo" ? cacheAdapter(guarded) : guarded,
    env,
    logger,
    now,
    price:
      deps.price ??
      new PriceService({
        source: env.PRICE_SOURCE,
        fixed: fixedRates(env),
        fetcher: deps.fetcher,
        now,
      }),
  };
  const jobs = new Jobs(ctx);
  const limits: RateLimits = { claims: 10, login: 5, global: 120, ...deps.rateLimits };

  const app = express();
  app.locals.services = { ctx, jobs } satisfies AppServices;
  app.disable("x-powered-by");
  if (env.NODE_ENV === "production") app.set("trust proxy", 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          "default-src": ["'self'"],
          "img-src": ["'self'", "data:"],
          "connect-src": ["'self'"],
          "style-src": ["'self'", "'unsafe-inline'"],
          "upgrade-insecure-requests": null,
        },
      },
    }),
  );
  app.use(requestLogger(logger));

  const api = express.Router();
  api.use(limiter(limits.global, (req) => req.path.startsWith("/claims/")));
  api.use(express.json({ limit: "32kb" }));
  api.use(
    cookieSession({
      name: "asiri_session",
      keys: [env.SESSION_SECRET],
      httpOnly: true,
      sameSite: "lax",
      secure: env.NODE_ENV === "production",
      maxAge: SESSION_MAX_AGE_MS,
    }),
  );
  api.use("/", publicRoutes(ctx));
  api.use("/claims", claimRoutes(ctx, limiter(limits.claims)));
  api.use("/auth", authRoutes(ctx, limiter(limits.login)));
  api.use("/admin", adminRoutes(ctx, jobs, deps.reportWriter ?? createReportWriter(env, logger)));
  if (env.ZCASH_MODE === "mock") api.use("/dev", devRoutes(ctx));
  api.use((_req, res) => {
    res.status(404).json({ error: "not_found" });
  });
  app.use("/api", api);

  serveWeb(app, deps.webDistDir ?? path.join(ROOT_DIR, "apps/web/dist"));

  app.use(errorHandler(logger));
  return app;
}

export function getServices(app: express.Express): AppServices {
  return app.locals.services as AppServices;
}

function limiter(perMinute: number, skip?: (req: express.Request) => boolean): RequestHandler {
  return rateLimit({
    windowMs: 60_000,
    limit: perMinute,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "rate_limited", message: "Too many requests. Please wait a minute and try again." },
    ...(skip ? { skip } : {}),
  });
}

/** Logs method, path, status and duration only. Never bodies, query strings or headers. */
function requestLogger(logger: Logger): RequestHandler {
  return (req, res, next) => {
    const start = process.hrtime.bigint();
    res.on("finish", () => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      const path = req.originalUrl.split("?")[0];
      logger.info({ method: req.method, path, status: res.statusCode, ms: Math.round(ms) }, "request");
    });
    next();
  };
}

/** Single origin in production: the API serves the built SPA, with index.html as the fallback. */
function serveWeb(app: express.Express, distDir: string): void {
  const indexHtml = path.join(distDir, "index.html");
  if (!existsSync(indexHtml)) return;
  app.use("/assets", express.static(path.join(distDir, "assets"), { immutable: true, maxAge: "1y", fallthrough: false }));
  app.use(express.static(distDir, { index: false, maxAge: "1h" }));
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(indexHtml);
  });
}

function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err: unknown, _req, res, _next) => {
    if (res.headersSent) return;
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.code, ...err.extra });
      return;
    }
    if (err instanceof ZcashError) {
      logger.warn({ code: err.code }, "wallet error");
      res.status(err.code === "invalid_address" ? 400 : 503).json({ error: err.code, message: err.message });
      return;
    }
    const e = err as { status?: number; statusCode?: number; type?: string; message?: string; name?: string };
    const status = e?.status ?? e?.statusCode ?? 500;
    if (e?.type === "entity.parse.failed") {
      res.status(400).json({ error: "validation_error", message: "Body must be valid JSON" });
      return;
    }
    if (e?.type === "entity.too.large") {
      res.status(413).json({ error: "payload_too_large" });
      return;
    }
    if (status >= 500) logger.error({ err: { name: e?.name, message: e?.message } }, "unhandled error");
    res.status(status).json({ error: status >= 500 ? "internal_error" : "bad_request" });
  };
}
