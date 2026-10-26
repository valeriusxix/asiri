import { execFile } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { Logger } from "../lib/logger.js";
import { ZcashError, type Network, type WalletBalance, type WalletTx, type ZcashAdapter } from "./adapter.js";
import {
  classifySendFailure,
  isValidForNetwork,
  parseHeight,
  parseQuicksendTxid,
  parseReceiveAddress,
  parseUfvk,
  parseValueTransfers,
  parseWalletBalance,
  toWalletTxs,
} from "./zingoParse.js";

// Command names, flags and output formats come from the real zingo-cli 0.4.0 (zingolib_v7.0.0):
// see docs/ZINGO_NOTES.md and the captured fixtures in src/test/fixtures/zingo.

export interface CliResult {
  stdout: string;
  stderr: string;
  code: number;
  /** Killed at its timeout. stdout/stderr hold what it printed before that. */
  timedOut?: boolean;
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
          if (e?.killed) return resolve({ stdout, stderr, code: -1, timedOut: true });
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
// Each is a little shorter than guardAdapter's timeout for the same call, so the CLI process is killed before the
// guard releases the wallet mutex and two zingo-cli processes never touch the wallet at once.
const LOCAL_TIMEOUT_MS = 100_000;
// Observed syncs took 22 to 113 s. An online session whose Nym mixnet bootstrap hangs never recovers (seen several
// times on 2026-10-26), so it is killed well before the guard's 10 minutes and the next job tick tries again.
const SYNC_TIMEOUT_MS = 4 * 60_000;
// Observed quicksends took 41 s and 203 s; a failing one with retries took 124 s.
const SEND_TIMEOUT_MS = 5 * 60_000;
// quicksend narrates its progress on stderr ("quicksend: working (12s elapsed)", "quicksend: destination …"), about
// every 10 s once it starts. Killed with none of that, it never reached the send (a hung mixnet bootstrap).
const SEND_STARTED = /^quicksend: /m;

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
    if (r.timedOut) throw new ZcashError("timeout");
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
    if (r.timedOut) throw new ZcashError("timeout");
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
    return toWalletTxs(parseValueTransfers(await this.local(["value_transfers"])));
  }

  async validateAddress(address: string): Promise<boolean> {
    return isValidForNetwork(await this.local(["parse_address", address]), this.network);
  }

  /**
   * `--nosync quicksend <address> <zatoshis> "<memo>"` (send + confirm in one step, transmitted over the mixnet).
   * The jobs loop keeps the wallet synced, so no startup sync here.
   */
  async send(toAddress: string, amountZat: number, memo?: string): Promise<{ txid: string }> {
    const balance = await this.getBalance();
    if (balance.spendableZat < amountZat) {
      throw new ZcashError(balance.totalZat >= amountZat ? "funds_pending" : "insufficient_funds");
    }
    const r = await this.online(["--nosync", "quicksend", toAddress, String(amountZat), ...(memo ? [memo] : [])], SEND_TIMEOUT_MS);
    if (r.timedOut) {
      // Killed after the send started: it may have been transmitted. Killed before: nothing was sent.
      throw new ZcashError(SEND_STARTED.test(r.stderr) ? "send_unconfirmed" : "send_failed");
    }
    if (r.code !== 0) {
      // zingo-cli reports a failure only after checking whether an earlier attempt was delivered, and marks the
      // transaction failed in the wallet, so a non-zero exit means nothing was sent.
      const code = classifySendFailure(r.stderr, amountZat);
      throw new ZcashError(code === "insufficient_funds" && balance.pendingZat > 0 ? "funds_pending" : code);
    }
    const txid = parseQuicksendTxid(r.stdout);
    if (!txid) throw new ZcashError("send_unconfirmed");
    return { txid };
  }
}
