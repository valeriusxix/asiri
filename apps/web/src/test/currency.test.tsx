import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { claim, transparencyCopy } from "../copy";
import { BANK_FIELDS, compactMoney, CURRENCY_CODES, formatMoney, parseAmount, withinLimits, zatToFiatMinor } from "../currency";
import { CashoutStep } from "../pages/Claim";
import { TransparencyBody } from "../pages/Transparency";
import type { ClaimUnlock, Price, Transparency } from "../types";

const text = (el: ReactElement) => renderToStaticMarkup(el).replace(/<[^>]+>/g, " ").replaceAll("&#x27;", "'");

describe("web currency module mirrors the API", () => {
  it("formats exactly like apps/api/src/lib/currency.ts", () => {
    // The same cases as the API's lib.test.ts.
    expect(formatMoney(5_000_000, "NGN")).toBe("₦50,000");
    expect(formatMoney(125_050, "NGN")).toBe("₦1,250.50");
    expect(formatMoney(125_000, "USD")).toBe("$1,250.00");
    expect(formatMoney(1_999, "GBP")).toBe("£19.99");
    expect(formatMoney(125_000, "CAD")).toBe("CA$1,250.00");
    expect(zatToFiatMinor(154_590_000, 1_600_000, "NGN")).toBe(247_344_000);
  });

  it("parses typed amounts with up to 2 decimals and checks limits", () => {
    expect(parseAmount("1,250.50", "USD")).toBe(125_050);
    expect(parseAmount("₦50,000", "NGN")).toBe(5_000_000);
    expect(parseAmount("CA$19.99", "CAD")).toBe(1_999);
    expect(parseAmount("12.345", "GBP")).toBeNull();
    expect(parseAmount("ten", "USD")).toBeNull();
    expect(withinLimits(100, "USD", "payout")).toBe(true); // $1.00
    expect(withinLimits(99, "USD", "payout")).toBe(false);
    expect(withinLimits(49_999, "NGN", "payout")).toBe(false); // ₦499.99
    expect(withinLimits(500_001, "GBP", "payout")).toBe(false); // £5,000.01
  });

  it("labels chart axes compactly in each currency", () => {
    expect(compactMoney(1_234, "USD")).toBe("$1.2K");
    expect(compactMoney(850_000, "NGN")).toBe("₦850K");
    expect(compactMoney(2_500_000, "CAD")).toBe("CA$2.5M");
  });
});

describe("transparency currency switcher", () => {
  // Test rates, not market prices.
  const price: Price = {
    rates: { NGN: 1_600_000, USD: 1_000, GBP: 800, CAD: 1_400 },
    sources: { NGN: "fixed", USD: "coingecko", GBP: "coingecko", CAD: "coingecko" },
    fundCurrency: "USD",
    updatedAt: "2026-10-28T12:00:00.000Z",
  };
  const data: Transparency = {
    fundName: "Community Relief Fund",
    network: "testnet",
    mode: "zingo",
    fundCurrency: "USD",
    totals: { receivedZat: 250_000_000, simulatedZat: 0, paidOutZat: 50_000_000, outstandingZat: 0, payoutsCount: 3, demoCashoutZat: 0, demoCashoutCount: 0 },
    byCategory: [],
    weekly: [],
    latestReport: null,
    ufvk: "uviewtest1qqqq",
    verifyHint: "",
    updatedAt: "2026-10-28T12:00:00.000Z",
  };

  it.each([
    ["USD", "$2,500.00", "$500.00"],
    ["GBP", "£2,000.00", "£400.00"],
    ["CAD", "CA$3,500.00", "CA$700.00"],
    ["NGN", "₦4,000,000", "₦800,000"],
  ] as const)("shows the same ZEC totals in %s, labelled approximate", (currency, raised, paid) => {
    const out = text(<TransparencyBody data={data} price={price} currency={currency} />);
    expect(out).toContain(raised);
    expect(out).toContain(paid);
    expect(out).toContain("2.50 ZEC"); // canonical amount is always shown
    expect(out).toContain(transparencyCopy.approxShort);
    for (const code of CURRENCY_CODES) expect(out).toContain(code); // every switcher option
  });

  it("names the rate source for the chosen currency", () => {
    expect(text(<TransparencyBody data={data} price={price} currency="NGN" />)).toContain("fixed demo rate");
    expect(text(<TransparencyBody data={data} price={price} currency="GBP" />)).toContain("live rate");
  });
});

describe("demo cash-out form asks for each currency's details (Part 1.7)", () => {
  const unlocked = (currency: ClaimUnlock["currency"], amountDisplay: string): ClaimUnlock => ({
    amountZat: 1,
    amountZecDisplay: "0.00000001 ZEC",
    currency,
    amountDisplay,
    expiresAt: "2026-11-11T00:00:00.000Z",
    claimToken: "t",
  });

  it.each([
    ["NGN", "₦50,000", ["Account number"], ["Routing number", "Sort code", "Institution number", "Transit number"]],
    ["USD", "$40.00", ["Routing number", "Account number"], ["Sort code", "Institution number", "Transit number"]],
    ["GBP", "£30.00", ["Sort code", "Account number"], ["Routing number", "Institution number", "Transit number"]],
    ["CAD", "CA$55.00", ["Institution number", "Transit number", "Account number"], ["Routing number", "Sort code"]],
  ] as const)("%s", (currency, amount, shown, hidden) => {
    const out = text(<CashoutStep unlocked={unlocked(currency, amount)} onBack={() => {}} onSubmit={async () => null} />);
    expect(out).toContain(amount);
    expect(out).toContain(claim.bankLabel); // free-text bank name for every currency
    expect(out).toContain(claim.demoNote);
    for (const label of shown) expect(out).toContain(label);
    for (const label of hidden) expect(out).not.toContain(label);
    expect(BANK_FIELDS[currency].map((f) => claim.bankFields[f.field])).toEqual(shown);
  });

  it("has no bank dropdown any more", () => {
    expect(renderToStaticMarkup(<CashoutStep unlocked={unlocked("USD", "$40.00")} onBack={() => {}} onSubmit={async () => null} />)).not.toContain("<select");
  });
});
