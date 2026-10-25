import type { DB } from "../db/db.js";
import type { Env } from "../env.js";
import type { Logger } from "../lib/logger.js";
import type { ZcashAdapter } from "../zcash/adapter.js";
import type { PriceService } from "./price.js";

/** Everything a service needs. `adapter` is already guarded (mutex + timeouts). */
export interface AppContext {
  db: DB;
  adapter: ZcashAdapter;
  env: Env;
  price: PriceService;
  logger: Logger;
  /** Injected clock so tests can move time (Agent.md Section 15). */
  now: () => Date;
}
