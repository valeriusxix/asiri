import { execFile } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { Logger } from "../lib/logger.js";
import { ZcashError, type Network, type WalletBalance, type WalletTx, type ZcashAdapter } from "./adapter.js";
import { isValidForNetwork, parseHeight, parseReceiveAddress, parseUfvk, parseWalletBalance } from "./zingoParse.js";

// Command names, flags and output formats come from the real zingo-cli 0.4.0 (zingolib_v7.0.0):
// see docs/ZINGO_NOTES.md and the captured fixtures in src/test/fixtures/zingo.

export interface CliResult {
  stdout: string;
  stderr: string;
  code: number;
}

/** Runs zingo-cli once with an argument array. Never a shell string; never logs arguments. */
export type CliRunner = (args: string[], opts: { timeoutMs: number }) => Promise<CliResult>;

export function execFileRunner(cliPath: string): CliRunner {
  return (args, { timeoutMs }) =>
    new Promise((resolve, reject) => {
      execFile(
        cliPath,
        args,
        { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, windowsHide: true, killSignal: "SIGKILL" },
        (err, stdout, stderr) => {
          const e = err as (NodeJS.ErrnoException & { killed?: boolean; code?: number | string }) | null;
          if (e?.code === "ENOENT") return reject(new ZcashError("unavailable", "zingo-cli was not found. Check ZINGO_CLI_PATH."));
          if (e?.killed) return reject(new ZcashError("timeout"));
          resolve({ stdout, stderr, code: e ? (typeof e.code === "number" ? e.code : 1) : 0 });
        },
      );
    });
}

export interface ZingoAdapterOptions {
  cliPath: string;
  dataDir: string;
  server: string;
  network: Network;
  logger: Logger;
  runner?: CliRunner;
}

const WALLET_FILE = "zingo-wallet.dat";
const LOCAL_TIMEOUT_MS = 2 * 60_000;
const SYNC_TIMEOUT_MS = 10 * 60_000;

export class ZingoAdapter implements ZcashAdapter {
  readonly network: Network;
  private readonly run: CliRunner;
  private readonly dataDir: string;

  constructor(private readonly opts: ZingoAdapterOptions) {
    this.network = opts.network;
    this.dataDir = path.resolve(opts.dataDir);
    this.run = opts.runner ?? execFileRunner(opts.cliPath);
  }

  private base(): string[] {
    return ["--chain", this.network === "testnet" ? "testnet" : "mainnet", "--data-dir", this.dataDir];
  }

  /** A local command: deliberately offline, nothing touches the network. */
  private async local(command: string[]): Promise<string> {
    const r = await this.run([...this.base(), "--offline", ...command], { timeoutMs: LOCAL_TIMEOUT_MS });
    if (r.code !== 0) throw new ZcashError("unavailable", "The wallet command failed.");
    return r.stdout;
  }

  /** An online command. Pinning `--server` is zingo-cli's consent to go online; sends route over the Nym mixnet. */
  private online(command: string[], timeoutMs: number): Promise<CliResult> {
    return this.run([...this.base(), "--server", this.opts.server, ...command], { timeoutMs });
  }

  async init(): Promise<void> {
    mkdirSync(this.dataDir, { recursive: true });
    if (existsSync(path.join(this.dataDir, WALLET_FILE))) return;
    // Creating the wallet online dates its birthday at the chain tip, so the first sync is short. Creating it with
    // --waitsync also stores shutdown_on_completion in the wallet file, which later --waitsync syncs need in order to
    // return (docs/ZINGO_NOTES.md).
    await this.sync();
    this.opts.logger.info(
      `Treasury wallet created. Back up the seed with: ${this.opts.cliPath} --chain ${this.network} --offline --data-dir "${this.dataDir}" recovery_info`,
    );
  }

  /** `--waitsync height`: blocks until the startup sync reaches the chain tip, then prints { "height": n }. */
  async sync(): Promise<void> {
    const r = await this.online(["--waitsync", "height"], SYNC_TIMEOUT_MS);
    if (r.code !== 0) throw new ZcashError("unavailable", "Wallet sync failed.");
    parseHeight(r.stdout);
  }

  async getReceiveAddress(): Promise<string> {
    return parseReceiveAddress(await this.local(["addresses"]));
  }

  async getUfvk(): Promise<string> {
    return parseUfvk(await this.local(["export_ufvk"])).ufvk;
  }

  async getBalance(): Promise<WalletBalance> {
    const balance = await this.local(["balance"]);
    const spendable = await this.local(["spendable_balance"]);
    return parseWalletBalance(balance, spendable);
  }

  async listTransactions(): Promise<WalletTx[]> {
    throw new ZcashError("unavailable", "listTransactions is not wired yet");
  }

  async validateAddress(address: string): Promise<boolean> {
    return isValidForNetwork(await this.local(["parse_address", address]), this.network);
  }

  async send(_toAddress: string, _amountZat: number, _memo?: string): Promise<{ txid: string }> {
    throw new ZcashError("unavailable", "send is not wired yet");
  }
}
