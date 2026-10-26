import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createLogger } from "../lib/logger.js";
import { ZcashError } from "../zcash/adapter.js";
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
    expect(calls[0]!.timeoutMs).toBe(10 * 60_000);
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

  it("runs local reads with --offline", async () => {
    const { runner, calls } = fakeRunner([{ stdout: fx("empty-addresses.txt"), stderr: "", code: 0 }]);
    const { zingo } = adapter(runner);
    expect(await zingo.getReceiveAddress()).toMatch(/^utest1/);
    expect(calls[0]!.args).toContain("--offline");
    expect(calls[0]!.args).not.toContain("--server");
  });
});
