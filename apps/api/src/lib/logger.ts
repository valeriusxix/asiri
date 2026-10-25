import { pino, type Logger } from "pino";

/** Section 13.2: these paths are never written to logs. */
export const REDACT_PATHS = [
  "req.body",
  "req.headers.cookie",
  "*.secret",
  "*.pin",
  "*.claimToken",
  "*.password",
  "*.zcashAddress",
  "*.accountNumber",
  "*.seed",
];

export type { Logger };

export function createLogger(level: string = process.env.LOG_LEVEL ?? "info"): Logger {
  return pino({
    level,
    base: undefined,
    redact: { paths: REDACT_PATHS, censor: "[redacted]" },
  });
}
