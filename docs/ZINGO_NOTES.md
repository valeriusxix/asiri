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
  `cd C:\Users\hp\zingo-build\zingolib && cargo build -j 1 --manifest-path zingo-netutils/Cargo.toml --features nym --bin nym-proxy --release && copy zingo-netutils\target\release\nym-proxy.exe target\release\`
  (An earlier version of this line used `set CARGO_BUILD_JOBS=2 && …`. cmd keeps the space before `&&`, so cargo rejects the job count as `2 `. Pass `-j` instead.)
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

## Online session (2026-10-26, with nym-proxy built)

`nym-proxy.exe` built at 01:06 on 2026-10-26 (24.5 MB), the user ran the resume command in their own cmd window. It sits beside `zingo-cli.exe` in `target/release`.

New fixtures (saved under `apps/api/src/test/fixtures/zingo/`):

| File | Command | What it shows |
|---|---|---|
| `help-online.txt` | `--server <url> --nosync help` | Online sessions add `change_server`, `confirm`, `current_price`, `info`, `migrate`, `network`, `quicksend`, `quickshield`, `rescan`, `transmit` |
| `help-quicksend.txt`, `help-confirm.txt`, `help-info.txt`, `help-network.txt`, `help-messages.txt`, `help-rescan.txt`, `help-remove_transaction.txt`, `help-transmit.txt` | `help <cmd>` online | `quicksend <address> <zatoshis> "<optional memo>"` fuses `send` and `confirm`, which is what one-shot mode needs |
| `online-info.txt` (+ `.stderr.txt`) | `--server <url> --nosync info` | JSON: `ECC LightWalletD` v0.5.4, `chain_name: "test"`, `latest_block_height: 4542019`. About 27 s, mostly the Server-Selection Sweep bootstrapping a mixnet transport |
| `waitsync-height.txt` (+ `.stderr.txt`) | `--server <url> --waitsync height` on a new wallet | JSON `{"height": 4542152}` after the sync finished (42 s to create and sync, 34 s for the next sync) |
| `quicksend-insufficient.txt` (+ `.stderr.txt`) | `--server <url> --nosync quicksend <utest1…> 10000 "Asiri payout"` from an empty wallet | Exit code 1, empty stdout. stderr: `Error: Send error.` / `caused by: Propose send error.` / `caused by: Insufficient balance (have 0, need 20000 including fee)`. The fee for one small payment is 10,000 zat |

**How sync returns (important).** In one-shot mode, `--waitsync <cmd>` waits for the sync task's result, and a one-shot `sync run` holds the session open until the result. But the sync engine only finishes when the wallet's sync config has `shutdown_on_completion` set (`pepper-sync/src/sync.rs`: a scan that reaches the tip moves the engine to Shutdown only with that flag). That flag is **stored in the wallet file**. `zingo-cli` writes `shutdown_on_completion = --waitsync` only when it creates a wallet (`zingo-cli/src/lib.rs`, `build_zingo_config`), and wallets created without it keep `false`. Observed:
- A wallet created by `--nosync info`, then `--waitsync height`: no return in 580 s (it reached 159 of 165 blocks, then sat on a one-block `Verify` range).
- A wallet created by an interactive session: scanned to the tip in about 90 s and kept following new blocks; `--waitsync height` and `--nosync sync run` both still running at 300 s.
- A wallet **created by** `--waitsync height`: returned in 42 s, and the next `--waitsync height` returned in 34 s.

So `ZingoAdapter.init()` creates the treasury with `--server <url> --waitsync height`, and `sync()` runs the same command (10 minute timeout). A treasury created any other way would make every sync time out.

**Connectivity:** `--server <url>` is the consent to go online. Sync uses a direct connection to the pinned server; sends and price fetches route over the Nym mixnet and "fail closed while it bootstraps" (`help network`). A transient `tls handshake eof` from the server was retried automatically ("automatic recovery 1 of 3").

**Treasury wallet** (`data/treasury`, gitignored). Created 2026-10-26 01:47 by `ZingoAdapter.init()` in 113 s. It logged only the backup command, never the seed.
- Address index 0, Orchard only (what `/donate` shows): `utest16yp9w0mmexz4yx25tsmjq8jlzs8naq4cvmt46ukdymrpehhwmjl00nqcqqf89fz9apvpkkqjgj9yd4gsududgy5pquagg2sfzut8tj2k`
- Address index 1, Orchard + Sapling (`new_address oz`): `utest1unytxf6gr7glh2mhwfxmujlchxpkv4psn4eteal23jlxg35qt0aur3qfn06q30rj38nx6ln28qrt8ujdsyfk5f0jd3l9mhrjtwvusq6udefw2ah4eqn89fdp9lltjxe6wmvr7g7q58vm5uwswv5070nzpdf5yc5dp4ypvjwfly7q0yd4`
- Transparent: `tmVE5iqEQqXcVpp6cRnxyEJYbaK82W9bwhf` (`new_taddress` refuses a second one until this one receives funds)

**NU7 and receivers.** `addresses` reports only Orchard, Sapling and transparent receivers. From zingolib's source: "the Ironwood receiver of a unified address is its orchard receiver", and a payment to an Orchard receiver lands in the Ironwood bundle after NU7. So zingo-to-zingo payouts to Orchard UAs are fine.

**Second wallet (recipient):** `C:\Users\hp\zingo-build\scratch-online3`, created with `--waitsync`, outside the repo. Its address is `utest1p3sk9g7t309wa4…` (110 chars, Orchard).

**Faucets on 2026-10-26 (both unavailable):**
- Valar (`POST /api/claim`): accepted the request, then `status: failed`, `message: "the wallet cannot pay this address"` for the Orchard-only UA, the Orchard+Sapling UA and the transparent address alike. Its `/api/status` showed `ready: true`, a balance of about 7,466 TAZ, `paidCount: 0`, and a last recent payout about 2.4 days earlier, so the problem is on the faucet's side. Its `explorerTxUrl` is `https://testnet.zcashexplorer.app/transactions/{txid}` (use this explorer for the M3 txid check).
- Jino Labs: "Drips are paused for the testnet NU7 upgrade. Zallet, the wallet this faucet sends with, has no NU7 release yet."

## Still to do for M3

1. Get testnet ZEC into the treasury: both faucets are down (above), so this needs a person with TAZ, a retry of Valar later, or a request in the Zcash Global Discord.
2. With funds, capture real `balance`, `transactions`, `value_transfers` and a successful `quicksend` output, then write `listTransactions` and `send` (and its txid parser) from those captures only. Pending funds are checked before sending (`spendable_balance` against `balance`) to return `funds_pending`.
3. Run a claim end to end to the second wallet and record the txid here, with its explorer link.
