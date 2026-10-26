import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createLogger } from "../lib/logger.js";
import { guardAdapter, ZcashError } from "../zcash/adapter.js";
import { ZingoAdapter, type CliResult, type CliRunner } from "../zcash/zingo.js";

const fx = (name: string) => readFileSync(new URL(`./fixtures/zingo/${name}`, import.meta.url), "utf8");
const SERVER = "https://testnet.zec.rocks:443";

/** Records every call and answers from a queue of canned results (real captured outputs). */
function fakeRunner(results: CliResult[]): { runner: CliRunner; calls: { args: string[]; timeoutMs: number }[] } {
  const calls: { args: string[]; timeoutMs: number }[] = [];
  const runner: CliRunner = async (args, { timeoutMs }) => {
    calls.push({ args, timeoutMs });
    const next = results.shift();
    if (!next) throw new Error("unexpected zingo-cli call");
    return next;
  };
  return { runner, calls };
}

function adapter(runner: CliRunner, dataDir = mkdtempSync(path.join(tmpdir(), "asiri-zingo-"))) {
  return {
    dataDir,
    zingo: new ZingoAdapter({ cliPath: "zingo-cli", dataDir, server: SERVER, network: "testnet", logger: createLogger("silent"), runner }),
  };
}

describe("ZingoAdapter (fake runner, real outputs)", () => {
  it("creates the treasury online with --waitsync when the data dir has no wallet", async () => {
    const { runner, calls } = fakeRunner([{ stdout: fx("waitsync-height.txt"), stderr: fx("waitsync-height.stderr.txt"), code: 0 }]);
    const { zingo, dataDir } = adapter(runner);
    await zingo.init();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args).toEqual(["--chain", "testnet", "--data-dir", path.resolve(dataDir), "--server", SERVER, "--waitsync", "height"]);
    // Well under guardAdapter's 10 minutes, so a hung session is killed before the guard releases the wallet mutex.
    expect(calls[0]!.timeoutMs).toBe(4 * 60_000);
  });

  it("does nothing on init when the wallet file exists", async () => {
    const { runner, calls } = fakeRunner([]);
    const { zingo, dataDir } = adapter(runner);
    writeFileSync(path.join(dataDir, "zingo-wallet.dat"), "");
    await zingo.init();
    expect(calls).toHaveLength(0);
  });

  it("fails sync with a safe error when zingo-cli exits non-zero", async () => {
    const { runner } = fakeRunner([{ stdout: "", stderr: "Error: server error", code: 1 }]);
    const { zingo } = adapter(runner);
    await expect(zingo.sync()).rejects.toBeInstanceOf(ZcashError);
  });

  const funded = (spendable = fx("funded-spendable_balance.txt")): CliResult[] => [
    { stdout: fx("funded-balance.txt"), stderr: "", code: 0 },
    { stdout: spendable, stderr: "", code: 0 },
  ];
  const RECIPIENT = "utest1" + "q".repeat(100);

  it("sends with --nosync quicksend and returns the txid from the real success output", async () => {
    const { runner, calls } = fakeRunner([
      ...funded(),
      { stdout: fx("quicksend-success.txt"), stderr: fx("quicksend-success.stderr.txt"), code: 0 },
    ]);
    const { zingo, dataDir } = adapter(runner);
    expect(await zingo.send(RECIPIENT, 100_000, "Asiri payout")).toEqual({
      txid: "fbc5cfa19837a5e21615e38509a54e36f1c050cd4d630ae2a94e71c343ae2922",
    });
    expect(calls[2]!.args).toEqual([
      "--chain", "testnet", "--data-dir", path.resolve(dataDir), "--server", SERVER,
      "--nosync", "quicksend", RECIPIENT, "100000", "Asiri payout",
    ]);
    expect(calls[2]!.timeoutMs).toBe(5 * 60_000);
  });

  it("maps a real transmission failure to send_failed and the insufficient-balance error to insufficient_funds", async () => {
    const failed = fakeRunner([...funded(), { stdout: "", stderr: fx("quicksend-transmission-failed.stderr.txt"), code: 1 }]);
    await expect(adapter(failed.runner).zingo.send(RECIPIENT, 100_000)).rejects.toMatchObject({ code: "send_failed" });
    const broke = fakeRunner([...funded(), { stdout: "", stderr: fx("quicksend-insufficient.stderr.txt"), code: 1 }]);
    await expect(adapter(broke.runner).zingo.send(RECIPIENT, 100_000)).rejects.toMatchObject({ code: "insufficient_funds" });
  });

  it("checks the balance first: pending funds and empty wallets never reach quicksend", async () => {
    const pending = fakeRunner(funded('{\n  "spendable_balance": 0\n}'));
    await expect(adapter(pending.runner).zingo.send(RECIPIENT, 100_000)).rejects.toMatchObject({ code: "funds_pending" });
    expect(pending.calls).toHaveLength(2);
    const empty = fakeRunner([
      { stdout: fx("empty-balance.txt"), stderr: "", code: 0 },
      { stdout: fx("empty-spendable_balance.txt"), stderr: "", code: 0 },
    ]);
    await expect(adapter(empty.runner).zingo.send(RECIPIENT, 100_000)).rejects.toMatchObject({ code: "insufficient_funds" });
  });

  it("reports send_unconfirmed when the send is killed after it started or prints no txid, since it may have gone out", async () => {
    // Killed after zingo-cli started narrating the send (real narration lines from the captured runs).
    const started = fakeRunner([
      ...funded(),
      { stdout: "", stderr: "Launching save task...\nquicksend: working (12s elapsed)\n", code: -1, timedOut: true },
    ]);
    await expect(adapter(started.runner).zingo.send(RECIPIENT, 100_000)).rejects.toMatchObject({ code: "send_unconfirmed" });
    const odd = fakeRunner([...funded(), { stdout: "Launching save task...\n", stderr: "", code: 0 }]);
    await expect(adapter(odd.runner).zingo.send(RECIPIENT, 100_000)).rejects.toMatchObject({ code: "send_unconfirmed" });
  });

  it("reports send_failed when the session is killed before the send began (a hung mixnet bootstrap)", async () => {
    const hung = fakeRunner([...funded(), { stdout: "", stderr: "", code: -1, timedOut: true }]);
    await expect(adapter(hung.runner).zingo.send(RECIPIENT, 100_000)).rejects.toMatchObject({ code: "send_failed" });
  });

  it("turns killed syncs and local reads into timeouts", async () => {
    const sync = fakeRunner([{ stdout: "", stderr: fx("waitsync-height.stderr.txt"), code: -1, timedOut: true }]);
    await expect(adapter(sync.runner).zingo.sync()).rejects.toMatchObject({ code: "timeout" });
    expect(sync.calls[0]!.timeoutMs).toBe(4 * 60_000);
    const read = fakeRunner([{ stdout: "", stderr: "", code: -1, timedOut: true }]);
    await expect(adapter(read.runner).zingo.getUfvk()).rejects.toMatchObject({ code: "timeout" });
  });

  it("guardAdapter reports a send that outlives its timeout as unconfirmed, not failed", async () => {
    const { runner } = fakeRunner([]);
    const inner = adapter(runner).zingo;
    inner.send = () => new Promise(() => {});
    const guarded = guardAdapter(inner, { syncMs: 50, sendMs: 20, otherMs: 50 });
    await expect(guarded.send(RECIPIENT, 1)).rejects.toMatchObject({ code: "send_unconfirmed" });
  });

  it("lists transactions from value_transfers, offline", async () => {
    const { runner, calls } = fakeRunner([{ stdout: fx("funded-value_transfers.txt"), stderr: "", code: 0 }]);
    const txs = await adapter(runner).zingo.listTransactions();
    expect(txs).toEqual([expect.objectContaining({ direction: "in", amountZat: 100_000_000, blockHeight: 4_545_263 })]);
    expect(calls[0]!.args.slice(-2)).toEqual(["--offline", "value_transfers"]);
  });

  it("runs local reads with --offline", async () => {
    const { runner, calls } = fakeRunner([{ stdout: fx("empty-addresses.txt"), stderr: "", code: 0 }]);
    const { zingo } = adapter(runner);
    expect(await zingo.getReceiveAddress()).toMatch(/^utest1/);
    expect(calls[0]!.args).toContain("--offline");
    expect(calls[0]!.args).not.toContain("--server");
  });
});
