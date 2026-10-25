import { createApp, getServices } from "./app.js";
import { openDb } from "./db/db.js";
import { loadDotenvFile, parseEnv, type Env } from "./env.js";
import { createLogger } from "./lib/logger.js";
import type { ZcashAdapter } from "./zcash/adapter.js";
import { MockAdapter } from "./zcash/mock.js";

loadDotenvFile();

let env: Env;
try {
  env = parseEnv(process.env);
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}

const logger = createLogger();
const db = openDb(env.DATABASE_PATH);

async function createAdapter(): Promise<ZcashAdapter> {
  if (env.ZCASH_MODE === "mock") return new MockAdapter(db, env.ZCASH_NETWORK);
  const { ZingoAdapter } = await import("./zcash/zingo.js");
  return new ZingoAdapter({
    cliPath: env.ZINGO_CLI_PATH,
    dataDir: env.TREASURY_DATA_DIR,
    server: env.LIGHTWALLETD_URL!,
    network: env.ZCASH_NETWORK,
    logger,
  });
}

async function main(): Promise<void> {
  const app = createApp({ db, adapter: await createAdapter(), env, logger });
  const { ctx, jobs } = getServices(app);
  await ctx.adapter.init();
  jobs.start(env.SYNC_INTERVAL_SECONDS);

  const server = app.listen(env.PORT, (error?: Error) => {
    if (error) {
      logger.error({ err: { message: error.message } }, "server failed to start");
      process.exit(1);
    }
    logger.info({ port: env.PORT, mode: env.ZCASH_MODE, network: env.ZCASH_NETWORK }, `${env.APP_NAME} API listening`);
  });

  const shutdown = () => {
    jobs.stop();
    server.close(() => {
      db.close();
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err: unknown) => {
  logger.error({ err: { message: (err as Error)?.message } }, "boot failed");
  process.exit(1);
});
