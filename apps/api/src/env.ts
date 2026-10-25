import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import * as z from "zod";

/** Repo root. env.ts sits at apps/api/{src,dist}/env.(ts|js), so the root is three levels up. */
export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/** Empty strings in .env (e.g. `LIGHTWALLETD_URL=`) mean "not set". */
const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const optionalString = z.preprocess(blankToUndefined, z.string().trim().optional());
const optionalUrl = z.preprocess(blankToUndefined, z.url().optional());
const int = (min: number, max: number, def: number) => z.coerce.number().int().min(min).max(max).default(def);
const bool = (def: boolean) => z.preprocess(blankToUndefined, z.stringbool().default(def));

/** Resolve a relative path against the repo root (see docs/DECISIONS.md D-008). */
const rootPath = (def: string) =>
  z
    .string()
    .default(def)
    .transform((p) => (p === ":memory:" || path.isAbsolute(p) ? p : path.resolve(ROOT_DIR, p)));

export const EnvSchema = z
  .object({
    APP_NAME: z.string().default("Asiri"),
    FUND_NAME: z.string().min(1).default("Lagos Community Relief Fund"),
    FUND_DESCRIPTION: z.string().default("Private, fast support for medical, legal and emergency needs."),
    PORT: int(1, 65535, 8787),
    PUBLIC_WEB_URL: z.url().default("http://localhost:5173").transform((u) => u.replace(/\/+$/, "")),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    DEMO_MODE: bool(false),

    ADMIN_EMAIL: z.email(),
    ADMIN_PASSWORD: z.string().min(1),
    SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),

    DATABASE_PATH: rootPath("./data/asiri.db"),

    ZCASH_MODE: z.enum(["mock", "zingo"]).default("mock"),
    ZCASH_NETWORK: z.enum(["testnet", "mainnet"]).default("testnet"),
    LIGHTWALLETD_URL: optionalUrl,
    ZINGO_CLI_PATH: z.string().min(1).default("zingo-cli"),
    TREASURY_DATA_DIR: rootPath("./data/treasury"),
    FEE_BUFFER_ZAT: int(0, 100_000_000, 20_000),
    OFFRAMP_ZCASH_ADDRESS: optionalString,
    SYNC_INTERVAL_SECONDS: int(5, 86_400, 60),

    CLAIM_LINK_TTL_DAYS: int(1, 365, 14),
    PIN_MAX_ATTEMPTS: int(1, 50, 5),
    CLAIM_TOKEN_TTL_MINUTES: int(1, 24 * 60, 15),

    PRICE_SOURCE: z.enum(["coingecko", "fixed"]).default("coingecko"),
    FIXED_ZEC_NGN: z.coerce.number().positive().default(60_000),
    FIXED_ZEC_USD: z.coerce.number().positive().default(40),

    ANTHROPIC_API_KEY: optionalString,
    ANTHROPIC_MODEL: z.string().min(1).default("claude-sonnet-5-5"),
    ANTHROPIC_BASE_URL: optionalUrl,
  })
  .superRefine((env, ctx) => {
    if (env.ZCASH_MODE === "zingo" && !env.LIGHTWALLETD_URL) {
      ctx.addIssue({ code: "custom", path: ["LIGHTWALLETD_URL"], message: "LIGHTWALLETD_URL is required when ZCASH_MODE=zingo" });
    }
    if (env.NODE_ENV === "production" && env.ADMIN_PASSWORD === "change-me-now") {
      ctx.addIssue({ code: "custom", path: ["ADMIN_PASSWORD"], message: "ADMIN_PASSWORD must be changed from the default in production" });
    }
  });

export type Env = z.output<typeof EnvSchema>;

/** Parse and validate env. Throws an Error listing every problem (never echoing values). */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join("\n")}\nCopy .env.example to .env and fix the values above.`);
  }
  return result.data;
}

/** Load `.env` from the repo root (falls back to the cwd). Existing process env wins. */
export function loadDotenvFile(): void {
  const candidates = [path.join(ROOT_DIR, ".env"), path.join(process.cwd(), ".env")];
  const file = candidates.find((p) => existsSync(p));
  if (file) loadDotenv({ path: file, quiet: true });
}
