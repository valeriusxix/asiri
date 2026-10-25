# zingo-cli notes (M3 discovery)

Everything here was read from the zingolib repository at tag `zingolib_v7.0.0` (latest release on 2026-10-25, commit `bfb0a21`) or observed by running things. Nothing is assumed from older versions.

## Source and build

- Repo: https://github.com/zingolabs/zingolib, tag `zingolib_v7.0.0` (2026-10-15). There are **no prebuilt binaries**; releases are crate tags only.
- `rust-toolchain.toml` pins Rust `1.99.0` (rustup installs it on first build).
- `zingo-cli` 0.4.0 lives in `zingo-cli/`. Its default cargo feature is `nym`, the Nym mixnet transport.
- The official build procedure is `makers run-cli --build-only` (cargo-make). From `tools/workbench/src/bin/run-cli.rs` and `bundle-nym-proxy.rs`, that task runs:
  1. `cargo build --release -p zingo-cli`
  2. `cargo build --manifest-path zingo-netutils/Cargo.toml --features nym --bin nym-proxy --release`, then copies `nym-proxy(.exe)` next to `zingo-cli` in `target/release/`.
- The README says a CLI that cannot find `nym-proxy` cannot go online (precedence: `--nym-proxy`, then `$ZINGO_NYM_PROXY`, then beside the binary, then `PATH`).

## CLI surface (from zingo-cli/README.md at the tag)

- One-shot mode: `zingo-cli [session options] <command> [args]` runs one command and exits (`0` on success). Interactive mode when no command is given.
- `--chain testnet` (or `-c testnet`) selects testnet. The default is mainnet. Each network needs its own `--data-dir`.
- `--data-dir <PATH>`: wallet + logs (default `./wallets`).
- **Offline by default.** Going online needs consent: `--online` (this session), `--remember-online` (persisted beside the wallet), or `--server <uri>` (pinning an indexer implies consent).
- `--waitsync` blocks the command until the background sync completes; `--nosync` skips the startup sync.
- New wallet: created automatically if the data dir has none. Restore: `--seed "<words>" --birthday <height>`, or set the `ZINGO_SEED` env var instead of putting the seed on the command line. `--viewkey <UFVK> --birthday <h>` creates a watch-only wallet.
- Documented examples: `addresses`, `--waitsync balance`, `--nosync info`, `send <address> <zatoshis> "optional memo"`, `help`, `help <command>`.
- `ZINGO_DISABLE_SAVER` disables persistence for a session (useful for throwaway checks).

The exact command list, flags and output formats for balance, addresses, transaction list, send/confirm and UFVK export will be recorded below from `zingo-cli help` and `help <command>` once the binary builds. The parsers are written only from those captured outputs.

## Testnet indexer (lightwalletd), verified

zingolib's own source lists two testnet indexers (`zingo-netutils/src/indexers.rs`): `https://testnet.zec.rocks:443` and `https://zaino.testnet.unsafe.zec.rocks:443`.

Verified on 2026-10-25 with a raw gRPC call to `cash.z.wallet.sdk.rpc.CompactTxStreamer/GetLightdInfo` (service path from `zcash/lightwalletd` `lightwallet-protocol/walletrpc/service.proto`):

| Server | Result |
|---|---|
| `https://testnet.zec.rocks:443` | **Works.** `vendor: ECC LightWalletD`, `version: v0.5.4`, `chainName: "test"`, `saplingActivationHeight: 280000`, `blockHeight: 4540332` |
| `https://zaino.testnet.unsafe.zec.rocks:443` | Empty response to GetLightdInfo; not used |

`LIGHTWALLETD_URL=https://testnet.zec.rocks:443` is the value to use with `ZCASH_MODE=zingo`.

**NU7 note.** Testnet activated NU7 on 2026-10-04, and some infrastructure that did not upgrade sits on a split chain. `testnet.zec.rocks` is on the current chain: its tip (4,540,332) matched the Valar faucet's `chainHeight` (4,540,359, about 11 minutes later at about 25 s blocks), and the faucet broadcasts to the NU7 Zakura nodes. zingolib v7 knows the new Ironwood pool (`ironwood_notes` in its `notes` output).

## Testnet funds (faucets)

| Faucet | How | Notes |
|---|---|---|
| Valar Group, https://faucet.testnet.valargroup.dev | `POST /api/claim {"address":"utest1…"}` returns `202 {id,status}`; `GET /api/claim/{id}` returns the txid; `GET /api/status` | 0.125 TAZ per IP and per address per 24 h. Status on 2026-10-25: `ready: true`, balance about 7,466 TAZ, `chainHeight` 4,540,359 |
| Jino Labs, https://zcashfaucet.jinolabs.xyz | Browser proof-of-work, shielded z2z drip | 0.1 TAZ. NU7 status unknown |

0.125 TAZ covers several small demo payouts (for example ₦500 at a demo rate, plus the 20,000 zat fee buffer each).

## Build log (Windows 11, VS Build Tools 2022, 8 cores, 8 GB RAM)

- 2026-10-25 14:10: started `cargo build --release -p zingo-cli` with `CARGO_BUILD_JOBS=5`; rustup installed 1.99.0.
- 14:46: **zingo-cli built** in 19 min (`target/release/zingo-cli.exe`, 78 MB, `--version` prints `Zingo CLI 0.1.1`). No source changes were needed on Windows.
- 14:46 to about 15:25: `nym-proxy` build (`zingo-netutils` workspace, Nym SDK) compiled 488 crates, then was **stopped by Claude Code because the machine ran critically low on memory** (0.83 GB of 7.85 GB free afterwards, with other apps open). It is not a compile error. Artifacts in `zingo-netutils/target/release` are kept, so a restart resumes. To resume with less memory:
  `cd C:\Users\hp\zingo-build\zingolib && set CARGO_BUILD_JOBS=2 && cargo build --manifest-path zingo-netutils/Cargo.toml --features nym --bin nym-proxy --release && copy zingo-netutils\target\release\nym-proxy.exe target\release\`
- 2026-10-25 evening, second attempt (user asked to restart): resumed with `CARGO_BUILD_JOBS=1`, compiled 233 more crates (730 rlibs in `zingo-netutils/target/release/deps`, out of at most 808 lockfile packages) and reached `nym-client-core`, then was **stopped again by Claude Code for low memory** (Claude Code reaps its background shells under memory pressure). No compile error. `nym-proxy.exe` is not built yet. The same resume command continues from here. It is best run in a terminal outside Claude Code, which this reaping does not affect.
- Without `nym-proxy`, zingo-cli can only run offline (sync and send need the mixnet transport in default builds). The only opt-out is zingo-cli's `nakednet-test-mode` feature, which its `Cargo.toml` marks as "never for use", so it is not an option.

## Captured outputs (fixtures)

Captured with the built binary in a throwaway scratch wallet (`--chain testnet --offline`). Saved under `apps/api/src/test/fixtures/zingo/`:

| File | Command | Format |
|---|---|---|
| `version.txt`, `cli-help.txt`, `help.txt`, `help-<cmd>.txt` | `--version`, `--help`, `help`, `help <cmd>` | text |
| `parse_address-1..5.txt` | `parse_address <addr>` (UA, sapling, transparent, bad t1 on testnet, garbage) | one JSON line between log lines, exit code always 0 |
| `empty-addresses.txt` | `addresses` | JSON array of `{account, address_index, has_orchard, has_sapling, has_transparent, encoded_address}` |
| `empty-balance.txt` | `balance` | **not JSON**: `[` then `confirmed_<pool>_balance: <zat>` lines for pools ironwood, orchard, sapling, transparent, then `]` |
| `empty-spendable_balance.txt` | `spendable_balance` | JSON `{"spendable_balance": <zat>}` |
| `empty-export_ufvk.txt` | `export_ufvk` | JSON `{"ufvk": "uviewtest1…", "birthday": <height>}` |
| `empty-height.txt`, `empty-birthday.txt` | `height`, `birthday` | JSON `{"height": n}`; bare number |
| `empty-transactions.txt`, `empty-value_transfers.txt` | `transactions`, `value_transfers` | empty output on an empty wallet (formats still to capture with funds) |
| `empty-notes.txt` | `notes` | JSON `{ironwood_notes, orchard_notes, sapling_notes}` |

Facts observed:
- Every one-shot prints log lines around the result ("Launching save task...", "Save task shutdown successfully.", "Zingo CLI quit successfully."), so parsers extract the JSON span.
- Without any connectivity flag a session runs offline and prints a consent notice. `--offline` makes that explicit and silences it.
- Any command, even `parse_address`, creates a wallet in an empty `--data-dir`. An offline-created testnet wallet got birthday `4133900` (the library's floor, about 400k blocks behind the tip), so the treasury should be created online.
- `quicksend`, `confirm` and `info` are hidden from `help` in an offline session ("Command quicksend not found"). Their help needs an online session, so it is still to capture.
- `send` usage (from `help send`): `send <address> <zatoshis> "<optional memo>"`, then `confirm`. `recovery_info` prints the seed phrase (used only in the backup message, never captured).
- One-shot offline calls take about 0.5 to 1.6 s on this laptop.

## Still to do for M3

1. Build `nym-proxy` (see above), then capture `help quicksend`, `help confirm` and `help info` online.
2. Create the treasury wallet online against `https://testnet.zec.rocks:443`, claim 0.125 TAZ from the Valar faucet, and capture real `transactions` / `value_transfers` / `quicksend` outputs.
3. Create a second testnet wallet (another `--data-dir`) as the payout recipient. Run the claim end to end and record the txid here.
