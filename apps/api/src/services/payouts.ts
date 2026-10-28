import { audit, type DB } from "../db/db.js";
import { generatePin, hashPin, randomId, randomSecret, sha256Hex, verifyPin, verifySecret } from "../lib/crypto.js";
import { HttpError } from "../lib/http.js";
import { formatNgn, formatZec, ngnToZat } from "../lib/money.js";
import { ZcashError } from "../zcash/adapter.js";
import type { AppContext } from "./context.js";

export const CATEGORIES = ["medical", "legal", "food", "transport", "shelter", "other"] as const;
export type Category = (typeof CATEGORIES)[number];
export type PayoutStatus = "active" | "claiming" | "claimed" | "expired" | "cancelled" | "locked";
export type ClaimMethod = "zcash_address" | "cashout_demo";
export type PublicClaimStatus = "available" | "claimed" | "expired" | "cancelled" | "locked";

export const PAYOUT_MEMO = "Asiri payout";
const DAY_MS = 24 * 60 * 60 * 1000;

export interface PayoutRow {
  id: string;
  amount_zat: number;
  fee_buffer_zat: number;
  amount_ngn_at_creation: number;
  rate_zec_ngn: number;
  category: Category;
  internal_note: string | null;
  status: PayoutStatus;
  secret_hash: string;
  pin_hash: string;
  pin_attempts: number;
  claim_token_hash: string | null;
  claim_token_expires_at: string | null;
  claim_method: ClaimMethod | null;
  claim_txid: string | null;
  created_at: string;
  expires_at: string;
  claimed_at: string | null;
}

/** Admin view of a payout. Never includes the secret, PIN, or any hash. */
export interface AdminPayout {
  id: string;
  amountZat: number;
  feeBufferZat: number;
  amountNgn: number;
  rateZecNgn: number;
  amountNgnDisplay: string;
  amountZecDisplay: string;
  category: Category;
  internalNote: string | null;
  status: PayoutStatus;
  pinAttempts: number;
  claimMethod: ClaimMethod | null;
  claimTxid: string | null;
  createdAt: string;
  expiresAt: string;
  claimedAt: string | null;
}

export function toAdminPayout(r: PayoutRow): AdminPayout {
  return {
    id: r.id,
    amountZat: r.amount_zat,
    feeBufferZat: r.fee_buffer_zat,
    amountNgn: r.amount_ngn_at_creation,
    rateZecNgn: r.rate_zec_ngn,
    amountNgnDisplay: formatNgn(r.amount_ngn_at_creation),
    amountZecDisplay: formatZec(r.amount_zat, 8),
    category: r.category,
    internalNote: r.internal_note,
    status: r.status,
    pinAttempts: r.pin_attempts,
    claimMethod: r.claim_method,
    claimTxid: r.claim_txid,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    claimedAt: r.claimed_at,
  };
}

// ---------------------------------------------------------------------------
// Balances (Agent.md Section 7, plus docs/DECISIONS.md D-002)
// ---------------------------------------------------------------------------

/** Funds held for open links: amount + fee buffer of active, claiming and locked payouts. */
export function reservedZat(db: DB): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(amount_zat + fee_buffer_zat), 0) AS v FROM payouts WHERE status IN ('active','claiming','locked')`,
    )
    .get() as { v: number };
  return row.v;
}

/** Demo cash-outs paid off-chain: the ZEC is still in the wallet but already promised away. */
export function settledOffchainZat(db: DB): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(amount_zat + fee_buffer_zat), 0) AS v FROM payouts
       WHERE status = 'claimed' AND claim_method = 'cashout_demo' AND claim_txid IS NULL`,
    )
    .get() as { v: number };
  return row.v;
}

export interface Balances {
  spendableZat: number;
  pendingZat: number;
  reservedZat: number;
  settledOffchainZat: number;
  availableZat: number;
}

export async function getBalances(ctx: AppContext): Promise<Balances> {
  const wallet = await ctx.adapter.getBalance();
  return balancesFrom(ctx.db, wallet.spendableZat, wallet.pendingZat);
}

function balancesFrom(db: DB, spendableZat: number, pendingZat: number): Balances {
  const reserved = reservedZat(db);
  const settled = settledOffchainZat(db);
  return {
    spendableZat,
    pendingZat,
    reservedZat: reserved,
    settledOffchainZat: settled,
    availableZat: Math.max(0, spendableZat - reserved - settled),
  };
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export interface CreatePayoutInput {
  amountNgn: number;
  category: Category;
  internalNote?: string;
  expiresInDays?: number;
}

export interface CreatedPayout {
  payout: AdminPayout;
  link: string;
  pin: string;
  whatsappUrl: string;
  smsUrl: string;
}

export function shareMessage(fundName: string, link: string): string {
  return `Hi, you have received support from ${fundName}. Open this private link to receive it: ${link} . You will get a 6-digit PIN separately. Please do not share this link.`;
}

export async function createPayout(ctx: AppContext, input: CreatePayoutInput): Promise<CreatedPayout> {
  const { db, env } = ctx;
  const quote = await ctx.price.get();
  const amountZat = ngnToZat(input.amountNgn, quote.zecNgn);
  if (amountZat <= 0) throw new HttpError(400, "validation_error", { message: "Amount is too small" });
  const feeBuffer = env.FEE_BUFFER_ZAT;
  const wallet = await ctx.adapter.getBalance();

  const secret = randomSecret();
  const pin = generatePin();
  const pinHash = await hashPin(pin);
  const now = ctx.now();
  const expiresAt = new Date(now.getTime() + (input.expiresInDays ?? env.CLAIM_LINK_TTL_DAYS) * DAY_MS);
  const note = input.internalNote?.trim() || null;

  // Check + insert synchronously in one transaction so two concurrent creates cannot both pass the check.
  const insert = db.transaction((): PayoutRow => {
    const { availableZat } = balancesFrom(db, wallet.spendableZat, wallet.pendingZat);
    if (availableZat < amountZat + feeBuffer) throw new HttpError(409, "insufficient_funds", { availableZat });
    let id = randomId(10);
    while (db.prepare(`SELECT 1 FROM payouts WHERE id = ?`).get(id)) id = randomId(10);
    db.prepare(
      `INSERT INTO payouts (id, amount_zat, fee_buffer_zat, amount_ngn_at_creation, rate_zec_ngn, category, internal_note,
                            status, secret_hash, pin_hash, pin_attempts, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, 0, ?, ?)`,
    ).run(
      id,
      amountZat,
      feeBuffer,
      input.amountNgn,
      quote.zecNgn,
      input.category,
      note,
      sha256Hex(secret),
      pinHash,
      now.toISOString(),
      expiresAt.toISOString(),
    );
    audit(db, "payout.created", { id, amountZat, category: input.category }, now);
    return getRow(db, id)!;
  });
  const row = insert();

  const link = `${env.PUBLIC_WEB_URL}/c/${row.id}#${secret}`;
  const message = encodeURIComponent(shareMessage(env.FUND_NAME, link));
  return {
    payout: toAdminPayout(row),
    link,
    pin,
    whatsappUrl: `https://wa.me/?text=${message}`,
    smsUrl: `sms:?body=${message}`,
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function getRow(db: DB, id: string): PayoutRow | undefined {
  return db.prepare(`SELECT * FROM payouts WHERE id = ?`).get(id) as PayoutRow | undefined;
}

export function listPayouts(db: DB): AdminPayout[] {
  const rows = db.prepare(`SELECT * FROM payouts ORDER BY created_at DESC, id`).all() as PayoutRow[];
  return rows.map(toAdminPayout);
}

export function statusCounts(db: DB): Record<"active" | "claimed" | "expired" | "cancelled" | "locked", number> {
  const counts = { active: 0, claimed: 0, expired: 0, cancelled: 0, locked: 0 };
  const rows = db.prepare(`SELECT status, COUNT(*) AS n FROM payouts GROUP BY status`).all() as { status: PayoutStatus; n: number }[];
  for (const r of rows) {
    const key = r.status === "claiming" ? "active" : r.status;
    counts[key] += r.n;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Expiry
// ---------------------------------------------------------------------------

/** Moves every active/locked payout past its expiry to `expired`. Returns the number expired. */
export function expireDue(ctx: AppContext): number {
  const now = ctx.now();
  const rows = ctx.db
    .prepare(
      `UPDATE payouts SET status = 'expired', claim_token_hash = NULL, claim_token_expires_at = NULL
       WHERE status IN ('active','locked') AND expires_at <= ? RETURNING id, amount_zat, category`,
    )
    .all(now.toISOString()) as { id: string; amount_zat: number; category: Category }[];
  for (const r of rows) audit(ctx.db, "payout.expired", { id: r.id, amountZat: r.amount_zat, category: r.category }, now);
  return rows.length;
}

/** Lazy expiry for a single payout read by a claim request (D-003). */
function expireIfDue(ctx: AppContext, row: PayoutRow): PayoutRow {
  if ((row.status === "active" || row.status === "locked") && row.expires_at <= ctx.now().toISOString()) {
    expireDue(ctx);
    return getRow(ctx.db, row.id)!;
  }
  return row;
}

// ---------------------------------------------------------------------------
// Claims (recipient side)
// ---------------------------------------------------------------------------

// Compared against when the id is unknown, so unknown ids and wrong secrets take the same path.
const DUMMY_HASH = sha256Hex("asiri-unknown-payout");

function findBySecret(ctx: AppContext, id: string, secret: string): PayoutRow {
  const row = getRow(ctx.db, id);
  const ok = verifySecret(secret, row?.secret_hash ?? DUMMY_HASH);
  if (!row || !ok) throw new HttpError(404, "not_found");
  return expireIfDue(ctx, row);
}

function toPublicStatus(status: PayoutStatus): PublicClaimStatus {
  return status === "active" || status === "claiming" ? "available" : status;
}

export function openClaim(ctx: AppContext, id: string, secret: string): { status: PublicClaimStatus; fundName: string } {
  const row = findBySecret(ctx, id, secret);
  return { status: toPublicStatus(row.status), fundName: ctx.env.FUND_NAME };
}

/** Throws the right error for a payout that cannot be claimed now. */
function assertClaimable(row: PayoutRow, forRedeem: boolean): void {
  switch (row.status) {
    case "active":
      return;
    case "locked":
      throw new HttpError(423, "locked");
    case "claiming":
      throw new HttpError(409, "already_processing");
    case "claimed":
      // A second redeem of an already-claimed payout is a double claim (409); unlock just says it is gone (410).
      throw forRedeem ? new HttpError(409, "already_processing") : new HttpError(410, "claimed");
    case "expired":
    case "cancelled":
      throw new HttpError(410, row.status);
  }
}

export interface UnlockResult {
  amountZat: number;
  amountZecDisplay: string;
  amountNgnDisplay: string;
  expiresAt: string;
  claimToken: string;
}

export async function unlockClaim(ctx: AppContext, id: string, secret: string, pin: string): Promise<UnlockResult> {
  const { db, env } = ctx;
  const row = findBySecret(ctx, id, secret);
  assertClaimable(row, false);

  const ok = await verifyPin(pin, row.pin_hash);
  const now = ctx.now();
  if (!ok) {
    const updated = db
      .prepare(`UPDATE payouts SET pin_attempts = pin_attempts + 1 WHERE id = ? AND status = 'active' RETURNING pin_attempts`)
      .get(id) as { pin_attempts: number } | undefined;
    if (!updated) assertClaimable(getRow(db, id)!, false);
    const attempts = updated?.pin_attempts ?? env.PIN_MAX_ATTEMPTS;
    if (attempts >= env.PIN_MAX_ATTEMPTS) {
      const locked = db.prepare(`UPDATE payouts SET status = 'locked', claim_token_hash = NULL WHERE id = ? AND status = 'active'`).run(id);
      if (locked.changes) audit(db, "payout.locked", { id }, now);
      throw new HttpError(423, "locked");
    }
    throw new HttpError(401, "wrong_pin", { attemptsLeft: env.PIN_MAX_ATTEMPTS - attempts });
  }

  const claimToken = randomSecret();
  const tokenExpires = new Date(now.getTime() + env.CLAIM_TOKEN_TTL_MINUTES * 60_000);
  const res = db
    .prepare(
      `UPDATE payouts SET claim_token_hash = ?, claim_token_expires_at = ?, pin_attempts = 0 WHERE id = ? AND status = 'active'`,
    )
    .run(sha256Hex(claimToken), tokenExpires.toISOString(), id);
  if (!res.changes) assertClaimable(getRow(db, id)!, false);
  return {
    amountZat: row.amount_zat,
    amountZecDisplay: formatZec(row.amount_zat, 8),
    amountNgnDisplay: formatNgn(row.amount_ngn_at_creation),
    expiresAt: row.expires_at,
    claimToken,
  };
}

export interface RedeemResult {
  status: "claimed";
  method: ClaimMethod;
  txid?: string;
  demo: boolean;
}

/**
 * active --redeem--> claiming --send ok--> claimed
 *                            \--send fails--> active (claim token stays valid, D-005)
 * The bank name and account number of a demo cash-out are validated by the route and never reach this function.
 */
export async function redeemClaim(
  ctx: AppContext,
  id: string,
  input: { claimToken: string } & ({ method: "zcash_address"; zcashAddress: string } | { method: "cashout_demo" }),
): Promise<RedeemResult> {
  const { db, env, adapter } = ctx;
  // Only the holder of this payout's claim token learns anything about it (audit L1). The id alone is in the URL path,
  // so it reaches access logs and link previews: an unknown id, a wrong token and a stale token get the same answer.
  const found = getRow(db, id);
  const tokenOk = verifySecret(input.claimToken, found?.claim_token_hash ?? DUMMY_HASH);
  if (!found || !found.claim_token_hash || !tokenOk) throw new HttpError(401, "claim_session_expired");
  const row = expireIfDue(ctx, found);
  assertClaimable(row, true);

  let destination: string | undefined;
  if (input.method === "zcash_address") {
    if (!(await adapter.validateAddress(input.zcashAddress))) throw new HttpError(400, "invalid_address");
    destination = input.zcashAddress;
  } else {
    if (!env.DEMO_MODE) throw new HttpError(400, "method_not_available");
    destination = env.OFFRAMP_ZCASH_ADDRESS;
  }

  const now = ctx.now();
  const claimed = db
    .prepare(
      `UPDATE payouts SET status = 'claiming'
       WHERE id = ? AND status = 'active' AND claim_token_hash = ? AND claim_token_expires_at > ?`,
    )
    .run(id, sha256Hex(input.claimToken), now.toISOString());
  if (!claimed.changes) {
    const current = getRow(db, id)!;
    if (current.status !== "active") assertClaimable(current, true);
    // Still active, so the token did not match or has expired: ask for the PIN again.
    throw new HttpError(401, "claim_session_expired");
  }

  let txid: string | undefined;
  if (destination) {
    try {
      txid = (await adapter.send(destination, row.amount_zat, PAYOUT_MEMO)).txid;
    } catch (err) {
      const code = err instanceof ZcashError ? err.code : "send_failed";
      if (code === "send_unconfirmed") {
        // The money may be on its way: reopening the link could pay twice. It stays `claiming` for the organizer to
        // check against the wallet (D-028); the recipient is told it is being sent.
        audit(db, "payout.send_unconfirmed", { id, method: input.method }, ctx.now());
        ctx.logger.error({ payoutId: id }, "payout send unconfirmed; left in claiming for a manual check");
        throw new HttpError(409, "already_processing");
      }
      db.prepare(`UPDATE payouts SET status = 'active' WHERE id = ? AND status = 'claiming'`).run(id);
      audit(db, "payout.claim_failed", { id, method: input.method, code }, ctx.now());
      ctx.logger.warn({ payoutId: id, code }, "payout send failed");
      throw sendErrorToHttp(code);
    }
  }

  // The spent token's hash stays, so replaying it is recognised as a double claim (409), not as a wrong token.
  db.prepare(
    `UPDATE payouts SET status = 'claimed', claim_method = ?, claim_txid = ?, claimed_at = ?
     WHERE id = ? AND status = 'claiming'`,
  ).run(input.method, txid ?? null, ctx.now().toISOString(), id);
  audit(db, "payout.claimed", { id, method: input.method, amountZat: row.amount_zat, category: row.category }, ctx.now());

  return { status: "claimed", method: input.method, ...(txid ? { txid } : {}), demo: input.method === "cashout_demo" && !txid };
}

function sendErrorToHttp(code: string): HttpError {
  switch (code) {
    case "funds_pending":
      return new HttpError(503, "funds_pending");
    case "insufficient_funds":
    case "insufficient_funds_for_fee":
      return new HttpError(503, code);
    case "invalid_address":
      return new HttpError(400, "invalid_address");
    default:
      return new HttpError(502, "send_failed");
  }
}

// ---------------------------------------------------------------------------
// Admin actions
// ---------------------------------------------------------------------------

export function cancelPayout(ctx: AppContext, id: string): AdminPayout {
  const res = ctx.db
    .prepare(
      `UPDATE payouts SET status = 'cancelled', claim_token_hash = NULL, claim_token_expires_at = NULL
       WHERE id = ? AND status IN ('active','locked')`,
    )
    .run(id);
  const row = getRow(ctx.db, id);
  if (!row) throw new HttpError(404, "not_found");
  if (!res.changes) throw new HttpError(409, "invalid_status", { status: row.status });
  audit(ctx.db, "payout.cancelled", { id, amountZat: row.amount_zat, category: row.category }, ctx.now());
  return toAdminPayout(row);
}

export function adminUnlockPayout(ctx: AppContext, id: string): AdminPayout {
  const res = ctx.db.prepare(`UPDATE payouts SET status = 'active', pin_attempts = 0 WHERE id = ? AND status = 'locked'`).run(id);
  const row = getRow(ctx.db, id);
  if (!row) throw new HttpError(404, "not_found");
  if (!res.changes) throw new HttpError(409, "invalid_status", { status: row.status });
  audit(ctx.db, "payout.unlocked", { id }, ctx.now());
  return toAdminPayout(expireIfDue(ctx, row));
}
