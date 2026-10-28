import Anthropic from "@anthropic-ai/sdk";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { parseEnv } from "../env.js";
import { createLogger } from "../lib/logger.js";
import { CURRENCIES, formatMoney, type CurrencyCode } from "../lib/currency.js";
import { allowedNumbers, createReportWriter, reportSystemPrompt, unexpectedNumbers, validateReport, type MessagesClient } from "../services/reportWriter.js";
import { templateReport, templateWriter, type ReportStats } from "../services/reports.js";
import { createPayout, setup, TEST_ENV, TESTNET_ADDRESS } from "./helpers.js";

const STATS: ReportStats = {
  fundName: "Test Relief Fund",
  periodStart: "2026-10-13",
  periodEnd: "2026-10-20",
  periodLabel: "13 October 2026 to 20 October 2026",
  periodDays: 7,
  currency: "NGN",
  currencyName: "Nigerian naira",
  currencySymbol: "₦",
  rateZecFiat: 60000,
  donationsReceived: "₦1,250,000",
  donationsCount: 14,
  simulatedDonations: "₦15,000",
  paidOut: "₦480,000",
  paymentsCount: 9,
  demoCashouts: "₦45,000",
  demoCashoutsCount: 2,
  waitingToBeClaimed: "₦70,000",
  byCategory: [
    { category: "medical", payments: 5, amount: "₦300,000" },
    { category: "food", payments: 4, amount: "₦180,000" },
  ],
};

const GOOD =
  "This week, generous donors gave ₦1,250,000 across 14 donations to the Test Relief Fund. " +
  "We sent ₦480,000 in 9 payments: ₦300,000 for medical care and ₦180,000 for food. " +
  "₦70,000 is waiting to be collected. Thank you. You can verify every total on our transparency page.";

const silent = createLogger("silent");

/** Builds a fake Messages API response; only the fields the writer reads matter here. */
function message(text: string, stop_reason: Anthropic.Beta.Messages.BetaMessage["stop_reason"] = "end_turn") {
  // Cast: a full BetaMessage has many usage/metadata fields the writer never reads.
  return { content: [{ type: "text", text }], stop_reason } as unknown as Anthropic.Beta.Messages.BetaMessage;
}

function fakeClient(respond: () => Promise<Anthropic.Beta.Messages.BetaMessage>) {
  const calls: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming[] = [];
  const client: MessagesClient = {
    beta: {
      messages: {
        create: async (params) => {
          calls.push(params);
          return respond();
        },
      },
    },
  };
  return { client, calls };
}

const envWith = (extra: Record<string, string> = {}) => parseEnv({ ...TEST_ENV, ANTHROPIC_API_KEY: "test-key", ...extra });

/** The same period stats, formatted in any supported currency (amounts in minor units). */
function statsIn(code: CurrencyCode): ReportStats {
  const m = (minor: number) => formatMoney(minor, code);
  return {
    ...STATS,
    currency: code,
    currencyName: CURRENCIES[code].name,
    currencySymbol: CURRENCIES[code].symbol,
    donationsReceived: m(125_000),
    simulatedDonations: m(1_500),
    paidOut: m(48_050),
    demoCashouts: m(4_500),
    waitingToBeClaimed: m(7_000),
    byCategory: [
      { category: "medical", payments: 5, amount: m(30_050) },
      { category: "food", payments: 4, amount: m(18_000) },
    ],
  };
}

describe("reports in every supported currency", () => {
  it("formats the stats in the fund currency", () => {
    expect(statsIn("GBP").donationsReceived).toBe("£1,250.00");
    expect(statsIn("CAD").donationsReceived).toBe("CA$1,250.00");
    expect(statsIn("USD").donationsReceived).toBe("$1,250.00");
    expect(statsIn("NGN").donationsReceived).toBe("₦1,250");
  });

  it("tells Claude the currency instead of hard-coding the naira sign", () => {
    expect(reportSystemPrompt(statsIn("GBP"))).toContain("- Show amounts in British pounds using £ and the formatting given.");
    expect(reportSystemPrompt(statsIn("CAD"))).toContain("- Show amounts in Canadian dollars using CA$ and the formatting given.");
    expect(reportSystemPrompt(statsIn("USD"))).not.toContain("₦");
  });

  it.each([
    ["GBP", "£1,250.00", "£1,250", "£480.50", "£975.00"],
    ["USD", "$1,250.00", "$1,250", "$480.50", "$975.00"],
    ["CAD", "CA$1,250.00", "CA$1,250", "CA$480.50", "CA$975.00"],
    ["NGN", "₦1,250", "₦1,250.00", "₦480.50", "₦975"],
  ] as const)("%s: accepts the given figures in either form, rejects a made-up one", (code, full, short, paid, invented) => {
    const stats = statsIn(code);
    const good = `Donors gave ${full} in 14 donations. We sent ${paid} in 9 payments. Thank you. Please verify the totals on our transparency page.`;
    expect(validateReport(good, stats)).toEqual({ ok: true });
    expect(validateReport(good.replace(full, short), stats)).toEqual({ ok: true });
    expect(validateReport(`${good} A further ${invented} is on its way.`, stats)).toEqual({ ok: false, reason: "unexpected_number" });
  });

  it("the template fallback uses the same formatting and passes its own check, in every currency", () => {
    for (const code of ["NGN", "USD", "GBP", "CAD"] as const) {
      const stats = statsIn(code);
      const text = templateReport(stats);
      expect(text).toContain(stats.donationsReceived);
      expect(text).toContain(stats.paidOut);
      expect(validateReport(text, stats)).toEqual({ ok: true });
    }
  });
});

describe("report number validation", () => {
  it("collects every number in the stats, comma-free", () => {
    const allowed = allowedNumbers(STATS);
    for (const n of ["1250000", "480000", "300000", "70000", "15000", "14", "9", "2026", "13", "20"]) {
      expect(allowed.has(n), n).toBe(true);
    }
    expect(allowed.has("60000"), "the ZEC rate is never allowed").toBe(false);
  });

  it("accepts text that only uses the given numbers", () => {
    expect(unexpectedNumbers(GOOD, STATS)).toEqual([]);
    expect(validateReport(GOOD, STATS)).toEqual({ ok: true });
  });

  it("rejects every invented number, small ones included (audit M2)", () => {
    expect(unexpectedNumbers("We helped 37 people and paid ₦500,000.", STATS)).toEqual(["37", "500000"]);
    expect(unexpectedNumbers("Around 2,000 families.", STATS)).toEqual(["2000"]);
    expect(unexpectedNumbers("We made 12 payments.", STATS)).toEqual(["12"]);
    expect(validateReport("We raised ₦9,999,999 this week.", STATS)).toEqual({ ok: false, reason: "unexpected_number" });
    // The inventions the audit found getting through the 3+ digit rule:
    expect(validateReport(`${GOOD} Your gifts reached 47 families.`, STATS)).toEqual({ ok: false, reason: "unexpected_number" });
  });

  it("rejects figures it cannot check: percentages, scale words and large number words (audit M2)", () => {
    // Numbers that ARE in the stats (9, 14), so only the new check can reject these.
    for (const extra of [
      "Next month we hope to raise ₦9 million.",
      "About ₦9m is still needed.",
      "14% of donations went straight to people.",
      "Nine per cent went to transport.",
      "Forty-seven people were helped.",
      "Hundreds of families were reached.",
      "Over a dozen clinics took part.",
    ]) {
      expect(validateReport(`${GOOD} ${extra}`, STATS), extra).toEqual({ ok: false, reason: "uncheckable_figure" });
    }
    // The exact strings from the audit are rejected too, by whichever check sees them first.
    for (const extra of ["Next month we hope to raise ₦3 million.", "About ₦1.5m is still needed.", "85% of donations went straight to people."]) {
      expect(validateReport(`${GOOD} ${extra}`, STATS).ok, extra).toBe(false);
    }
  });

  it("still accepts plain prose that only uses the given numbers", () => {
    expect(validateReport(`${GOOD} That is 9 payments in the last 7 days, and every one of them mattered.`, STATS)).toEqual({ ok: true });
    expect(validateReport(`${GOOD} Thank you to all 14 of you, and to everyone who shared our link more than once.`, STATS)).toEqual({ ok: true });
  });

  it("rejects empty text and crypto jargon", () => {
    expect(validateReport("   ", STATS)).toEqual({ ok: false, reason: "empty" });
    expect(validateReport("We received 14 donations in ZEC.", STATS)).toEqual({ ok: false, reason: "jargon" });
  });

  it("the template passes its own validation", () => {
    expect(validateReport(templateReport(STATS), STATS)).toEqual({ ok: true });
    const words = templateReport(STATS).split(/\s+/).length;
    expect(words).toBeGreaterThan(40);
    expect(words).toBeLessThan(180);
  });
});

describe("Claude report writer", () => {
  it("falls back to the template when there is no API key", async () => {
    const writer = createReportWriter(parseEnv(TEST_ENV), silent);
    expect(writer).toBe(templateWriter);
    expect(await writer(STATS)).toEqual({ body: templateReport(STATS), generator: "template" });
  });

  it("sends aggregates only, with the Section 12 prompt, and accepts a valid answer", async () => {
    const { client, calls } = fakeClient(async () => message(GOOD));
    const out = await createReportWriter(envWith(), silent, client)(STATS);
    expect(out).toEqual({ body: GOOD, generator: "claude" });
    const params = calls[0]!;
    expect(params).toMatchObject({
      model: "claude-sonnet-5-5",
      max_tokens: 600,
      system: reportSystemPrompt(STATS),
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    expect(params.messages).toEqual([{ role: "user", content: `Write the update for this period:\n${JSON.stringify(STATS, null, 2)}` }]);
  });

  it("omits the server-side fallback beta when a custom gateway URL is configured", async () => {
    const { client, calls } = fakeClient(async () => message(GOOD));
    await createReportWriter(envWith({ ANTHROPIC_BASE_URL: "https://gateway.example/api" }), silent, client)(STATS);
    expect(calls[0]).not.toHaveProperty("fallbacks");
    expect(calls[0]).not.toHaveProperty("betas");
  });

  it.each([
    ["an invented number", async () => message("We raised ₦7,777,777 for 14 donors.")],
    ["an invented small number", async () => message(`${GOOD} Your gifts reached 47 families.`)],
    ["an invented amount in words", async () => message(`${GOOD} Next month we hope to raise ₦3 million.`)],
    ["a refusal", async () => message("", "refusal")],
    ["a truncated answer", async () => message("This week donors gave", "max_tokens")],
    ["an empty answer", async () => message("")],
    ["a connection error", async () => Promise.reject(new Anthropic.APIConnectionError({ message: "offline" }))],
    ["an unexpected error", async () => Promise.reject(new Error("boom"))],
  ])("falls back to the template on %s", async (_label, respond) => {
    const { client } = fakeClient(respond);
    expect(await createReportWriter(envWith(), silent, client)(STATS)).toEqual({ body: templateReport(STATS), generator: "template" });
  });
});

describe("report stats privacy", () => {
  it("never include payout ids, internal notes, donor memos or addresses", async () => {
    const h = setup();
    await h.mockDonate(300_000_000, "for Mama Ngozi");
    await h.jobs.runOnce();
    const p = await createPayout(h, { amount: 30_000, category: "medical", internalNote: "Clinic visit, week 2" });
    const t = (await request(h.app).post(`/api/claims/${p.id}/unlock`).send({ secret: p.secret, pin: p.pin })).body.claimToken;
    await request(h.app).post(`/api/claims/${p.id}/redeem`).send({ claimToken: t, method: "zcash_address", zcashAddress: TESTNET_ADDRESS }).expect(200);

    const { client, calls } = fakeClient(async () => message(GOOD));
    const { generateReport } = await import("../services/reports.js");
    await generateReport(h.ctx, 7, createReportWriter(envWith(), silent, client));
    const sent = JSON.stringify(calls[0]);
    for (const leak of [p.id, "Clinic visit", "Ngozi", TESTNET_ADDRESS, "utest1mock"]) expect(sent).not.toContain(leak);
    expect(sent).toContain("₦30,000");
  });
});
