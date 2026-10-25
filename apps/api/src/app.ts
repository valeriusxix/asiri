import { existsSync } from "node:fs";
import path from "node:path";
import express, { type ErrorRequestHandler, type RequestHandler } from "express";
import helmet from "helmet";
import { ROOT_DIR, type Env } from "./env.js";
import { createLogger, type Logger } from "./lib/logger.js";

export interface AppDeps {
  env: Env;
  logger?: Logger;
  /** Directory of the built web app; served when it exists. */
  webDistDir?: string;
}

export function createApp(deps: AppDeps): express.Express {
  const { env } = deps;
  const logger = deps.logger ?? createLogger(env.NODE_ENV === "test" ? "silent" : "info");
  const app = express();

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
  app.use(express.json({ limit: "32kb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, mode: env.ZCASH_MODE, network: env.ZCASH_NETWORK });
  });

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "not_found" });
  });

  serveWeb(app, deps.webDistDir ?? path.join(ROOT_DIR, "apps/web/dist"));

  app.use(errorHandler(logger));
  return app;
}

/** Logs method, path, status and duration only. Never bodies, query strings or headers. */
function requestLogger(logger: Logger): RequestHandler {
  return (req, res, next) => {
    const start = process.hrtime.bigint();
    res.on("finish", () => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      logger.info({ method: req.method, path: req.path, status: res.statusCode, ms: Math.round(ms) }, "request");
    });
    next();
  };
}

/** Single origin in production: the API serves the built SPA, with index.html as the fallback. */
function serveWeb(app: express.Express, distDir: string): void {
  const indexHtml = path.join(distDir, "index.html");
  if (!existsSync(indexHtml)) return;
  app.use(
    "/assets",
    express.static(path.join(distDir, "assets"), { immutable: true, maxAge: "1y", fallthrough: false }),
  );
  app.use(express.static(distDir, { index: false, maxAge: "1h" }));
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(indexHtml);
  });
}

function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err, _req, res, _next) => {
    const status = typeof err?.status === "number" ? err.status : typeof err?.statusCode === "number" ? err.statusCode : 500;
    if (status >= 500) logger.error({ err: { message: err?.message, name: err?.name } }, "unhandled error");
    if (res.headersSent) return;
    if (status === 400 && err?.type === "entity.parse.failed") {
      res.status(400).json({ error: "validation_error", message: "Body must be valid JSON" });
      return;
    }
    res.status(status).json({ error: status >= 500 ? "internal_error" : "bad_request" });
  };
}
