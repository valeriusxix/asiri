import { audit } from "./db/db.js";
import { ZcashError } from "./zcash/adapter.js";
import type { AppContext } from "./services/context.js";
import { importFromWallet } from "./services/donations.js";
import { expireDue } from "./services/payouts.js";

/** Sync + expire loop. One run at a time; concurrent callers share the in-flight run. */
export class Jobs {
  lastSyncAt: string | null = null;
  lastSyncError: string | null = null;
  private inflight: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly ctx: AppContext) {}

  runOnce(): Promise<void> {
    this.inflight ??= this.run().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  start(intervalSeconds: number): void {
    void this.runOnce();
    this.timer = setInterval(() => void this.runOnce(), intervalSeconds * 1000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async run(): Promise<void> {
    const { ctx } = this;
    // Expiry is pure DB work, so it runs even when the wallet is unreachable.
    expireDue(ctx);
    try {
      await ctx.adapter.sync();
      const imported = await importFromWallet(ctx);
      this.lastSyncAt = ctx.now().toISOString();
      if (imported > 0) audit(ctx.db, "sync.ok", { imported }, ctx.now());
      if (this.lastSyncError) ctx.logger.info("sync recovered");
      this.lastSyncError = null;
    } catch (err) {
      const message = err instanceof ZcashError ? err.message : "Sync failed.";
      if (message !== this.lastSyncError) {
        audit(ctx.db, "sync.error", { code: err instanceof ZcashError ? err.code : "unknown" }, ctx.now());
        ctx.logger.warn({ code: err instanceof ZcashError ? err.code : "unknown" }, "sync failed");
      }
      this.lastSyncError = message;
    }
  }
}
