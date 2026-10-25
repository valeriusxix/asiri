import Anthropic from "@anthropic-ai/sdk";
import type { Env } from "../env.js";
import type { Logger } from "../lib/logger.js";
import { templateReport, templateWriter, type ReportStats, type ReportWriter } from "./reports.js";

/** Agent.md Section 12, verbatim. */
export const REPORT_SYSTEM_PROMPT = `You write short, warm, factual updates for donors of a community relief fund.
Rules:
- Use ONLY the numbers in the JSON you are given. Do not invent or estimate any figure.
- Never guess or describe who the recipients are.
- No crypto jargon. Say "donations" and "payments", not "transactions" or "ZEC".
- Show naira amounts with the ₦ sign and thousands separators.
- 120 to 180 words, plain text, no headings, no bullet points.
- End with one sentence inviting readers to verify the totals on the transparency page.`;

const NUMBER = /\d[\d,]*(?:\.\d+)?/g;
const normalize = (n: string) => n.replace(/,/g, "").replace(/\.$/, "");
const digitCount = (n: string) => n.replace(/\D/g, "").length;

/** Every number that appears anywhere in the stats (amounts, counts, rate, dates), comma-free. */
export function allowedNumbers(stats: ReportStats): Set<string> {
  const allowed = new Set<string>();
  const visit = (v: unknown): void => {
    if (typeof v === "number") allowed.add(String(v));
    else if (typeof v === "string") for (const m of v.match(NUMBER) ?? []) allowed.add(normalize(m));
    else if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === "object") Object.values(v).forEach(visit);
  };
  visit(stats);
  return allowed;
}

/** Numbers of 3+ digits in `text` that do not appear in the stats (Section 12 validation). */
export function unexpectedNumbers(text: string, stats: ReportStats): string[] {
  const allowed = allowedNumbers(stats);
  return (text.match(NUMBER) ?? []).map(normalize).filter((n) => digitCount(n) >= 3 && !allowed.has(n));
}

const JARGON = /\b(ZEC|zatoshis?|blockchain|crypto(currency)?|shielded|wallet)\b/i;

export function validateReport(text: string, stats: ReportStats): { ok: true } | { ok: false; reason: string } {
  if (!text.trim()) return { ok: false, reason: "empty" };
  if (unexpectedNumbers(text, stats).length > 0) return { ok: false, reason: "unexpected_number" };
  if (JARGON.test(text)) return { ok: false, reason: "jargon" };
  return { ok: true };
}

/** The slice of the SDK client the writer uses, so tests can inject a fake. */
export type MessagesClient = {
  beta: { messages: { create(params: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming): Promise<Anthropic.Beta.Messages.BetaMessage> } };
};

/**
 * Report writer backed by Claude, with the deterministic template as the fallback for every failure:
 * no key, API error, refusal, truncation, empty text, an invented number, or jargon.
 */
export function createReportWriter(env: Env, logger: Logger, client?: MessagesClient): ReportWriter {
  if (!env.ANTHROPIC_API_KEY && !client) return templateWriter;
  const anthropic: MessagesClient =
    client ?? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, baseURL: env.ANTHROPIC_BASE_URL ?? null, maxRetries: 1, timeout: 45_000 });
  // Server-side refusal fallback is a first-party Claude API beta; a custom gateway may not support it.
  const fallbacks = env.ANTHROPIC_BASE_URL ? {} : { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };

  return async (stats) => {
    const fallback = (reason: string) => {
      logger.warn({ reason }, "report: using template");
      return { body: templateReport(stats), generator: "template" as const };
    };
    try {
      const response = await anthropic.beta.messages.create({
        model: env.ANTHROPIC_MODEL,
        max_tokens: 600,
        system: REPORT_SYSTEM_PROMPT,
        // A short factual paragraph; low effort keeps thinking from eating the 600-token budget.
        output_config: { effort: "low" },
        messages: [{ role: "user", content: `Write the update for this period:\n${JSON.stringify(stats, null, 2)}` }],
        ...fallbacks,
      });
      if (response.stop_reason !== "end_turn") return fallback(`stop_reason_${response.stop_reason ?? "unknown"}`);
      const text = response.content
        .flatMap((b) => (b.type === "text" ? [b.text] : []))
        .join("")
        .trim();
      const check = validateReport(text, stats);
      if (!check.ok) return fallback(check.reason);
      return { body: text, generator: "claude" };
    } catch (err) {
      const kind =
        err instanceof Anthropic.AuthenticationError
          ? "auth"
          : err instanceof Anthropic.RateLimitError
            ? "rate_limited"
            : err instanceof Anthropic.BadRequestError
              ? "bad_request"
              : err instanceof Anthropic.APIConnectionError
                ? "connection"
                : err instanceof Anthropic.APIError
                  ? `api_${err.status ?? "error"}`
                  : "unknown";
      return fallback(kind);
    }
  };
}
