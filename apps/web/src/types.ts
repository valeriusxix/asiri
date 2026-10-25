// Mirrors the API response shapes in Agent.md Section 8. Keep in sync by hand (no shared package).

export type Network = "testnet" | "mainnet";

export interface Health {
  ok: true;
  mode: "mock" | "zingo";
  network: Network;
}
