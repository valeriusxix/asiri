import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NetworkPillView } from "../components/Layout";
import { donate, transparencyCopy } from "../copy";
import { ZcashCard } from "../pages/Donate";
import { TransparencyBody } from "../pages/Transparency";
import type { Fund, Transparency } from "../types";

/** Visible text and attributes of a server-rendered element. */
const render = (el: ReactElement) => renderToStaticMarkup(el).replaceAll("&#x27;", "'");
const text = (el: ReactElement) => render(el).replace(/<[^>]+>/g, " ");

const fund = (mode: Fund["mode"]): Fund => ({
  name: "Test Relief Fund",
  description: "",
  network: "testnet",
  receiveAddress: mode === "mock" ? "utest1mockqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq" : "utest1realqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq",
  ufvk: "uviewtest1qqqq",
  paymentUri: "zcash:utest1qqqq",
  demoMode: true,
  mode,
});

const transparency = (mode: Transparency["mode"]): Transparency => ({
  fundName: "Test Relief Fund",
  network: "testnet",
  mode,
  currency: { zecNgn: 1_600_000, source: "fixed" },
  totals: { receivedZat: 100_000_000, simulatedZat: 0, paidOutZat: 3_125_000, outstandingZat: 0, payoutsCount: 1, demoCashoutZat: 0, demoCashoutCount: 0 },
  byCategory: [{ category: "medical", count: 1, amountZat: 3_125_000 }],
  weekly: [],
  latestReport: null,
  ufvk: mode === "mock" ? "uviewtest1mockqqqq" : "uviewtest1realqqqq",
  verifyHint: "This is the fund's viewing key.",
  updatedAt: "2026-10-27T12:00:00.000Z",
});

describe("mock-mode placeholders are labelled Demo (audit H2)", () => {
  it("donate: the mock QR code and address say they are placeholders", () => {
    expect(text(<ZcashCard fund={fund("mock")} />)).toContain(donate.mockNote);
    expect(text(<ZcashCard fund={fund("mock")} />)).toContain("Demo");
  });

  it("donate: a real treasury shows no demo label", () => {
    const out = text(<ZcashCard fund={fund("zingo")} />);
    expect(out).not.toContain(donate.mockNote);
    expect(out).not.toContain("Demo");
    expect(out).toContain(donate.testnetNote);
  });

  it("transparency: mock totals and the mock viewing key are labelled", () => {
    const out = text(<TransparencyBody data={transparency("mock")} />);
    expect(out).toContain(transparencyCopy.mockBanner);
    expect(out).toContain(transparencyCopy.mockUfvk);
  });

  it("transparency: a real treasury shows no demo label", () => {
    const out = text(<TransparencyBody data={transparency("zingo")} />);
    expect(out).not.toContain(transparencyCopy.mockBanner);
    expect(out).not.toContain(transparencyCopy.mockUfvk);
    expect(out).not.toContain("Demo");
  });

  it("header pill: DEMO in mock mode, TESTNET on testnet, nothing on mainnet", () => {
    expect(text(<NetworkPillView network="testnet" mode="mock" />)).toContain("DEMO");
    expect(render(<NetworkPillView network="testnet" mode="mock" />)).toContain("mock treasury");
    expect(text(<NetworkPillView network="testnet" mode="zingo" />)).toContain("TESTNET");
    expect(render(<NetworkPillView network="testnet" mode="zingo" />)).not.toContain("demo runs");
    expect(render(<NetworkPillView network="mainnet" mode="zingo" />)).toBe("");
  });
});

describe("demo cash-outs are labelled where they are counted (audit M1)", () => {
  it("shows the demo share of Paid out with a Demo badge", () => {
    const data = transparency("zingo");
    data.totals = { ...data.totals, paidOutZat: 6_250_000, payoutsCount: 2, demoCashoutZat: 3_125_000, demoCashoutCount: 1 };
    const out = text(<TransparencyBody data={data} />);
    expect(out).toContain(transparencyCopy.demoCashouts);
    expect(out).toContain(transparencyCopy.demoCashoutsNote(1));
    expect(out).toContain("₦50,000");
    expect(out).toContain("Demo");
  });

  it("shows nothing extra when every payment was real", () => {
    expect(text(<TransparencyBody data={transparency("zingo")} />)).not.toContain(transparencyCopy.demoCashouts);
  });
});
