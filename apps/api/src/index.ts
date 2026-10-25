import { createApp } from "./app.js";
import { loadDotenvFile, parseEnv, type Env } from "./env.js";
import { createLogger } from "./lib/logger.js";

loadDotenvFile();

let env: Env;
try {
  env = parseEnv(process.env);
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}

const logger = createLogger();
const app = createApp({ env, logger });

app.listen(env.PORT, (error?: Error) => {
  if (error) {
    logger.error({ err: { message: error.message } }, "server failed to start");
    process.exit(1);
  }
  logger.info({ port: env.PORT, mode: env.ZCASH_MODE, network: env.ZCASH_NETWORK }, `${env.APP_NAME} API listening`);
});
