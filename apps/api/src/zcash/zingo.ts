import type { Logger } from "../lib/logger.js";
import { ZcashError, type Network, type WalletBalance, type WalletTx, type ZcashAdapter } from "./adapter.js";

export interface ZingoAdapterOptions {
  cliPath: string;
  dataDir: string;
  server: string;
  network: Network;
  logger: Logger;
}

/**
 * Placeholder until M3. The real implementation is written only after running zingo-cli's help
 * commands and capturing real outputs (Agent.md Section 9.4). Until then every call fails safely.
 */
export class ZingoAdapter implements ZcashAdapter {
  readonly network: Network;

  constructor(opts: ZingoAdapterOptions) {
    this.network = opts.network;
  }

  private fail(): never {
    throw new ZcashError("unavailable", "ZingoAdapter is not implemented yet. Use ZCASH_MODE=mock.");
  }

  async init(): Promise<void> {
    this.fail();
  }
  async sync(): Promise<void> {
    this.fail();
  }
  async getReceiveAddress(): Promise<string> {
    this.fail();
  }
  async getUfvk(): Promise<string> {
    this.fail();
  }
  async getBalance(): Promise<WalletBalance> {
    this.fail();
  }
  async listTransactions(): Promise<WalletTx[]> {
    this.fail();
  }
  async validateAddress(_address: string): Promise<boolean> {
    this.fail();
  }
  async send(_toAddress: string, _amountZat: number, _memo?: string): Promise<{ txid: string }> {
    this.fail();
  }
}
