/**
 * lib/attribution/webhook-parser.ts
 *
 * Pure helpers extracted from
 * `app/api/webhooks/ticketing/[provider]/route.ts` so the parsing +
 * signature-verification logic can be unit-tested directly. The
 * route handler stays as a thin glue layer that loads supabase,
 * looks up the event, and upserts.
 *
 * Pure module — no Supabase, no `server-only`, no Next runtime
 * imports. Safe to import from anywhere.
 */

import { createHmac } from "node:crypto";

import {
  hashEmail,
  hashExternalId,
  hashIp,
  constantTimeEqualHex,
} from "./hashing.ts";

export interface FourthefansRawPayload {
  order_id?: unknown;
  event_id?: unknown;
  email?: unknown;
  external_id?: unknown;
  _fbc?: unknown;
  _fbp?: unknown;
  fbc?: unknown;
  fbp?: unknown;
  purchased_at?: unknown;
  tickets?: unknown;
  ticket_count?: unknown;
  amount?: unknown;
  amount_minor?: unknown;
  currency?: unknown;
  ua?: unknown;
  user_agent?: unknown;
  ip?: unknown;
}

/**
 * Outcome of HMAC verification. The route returns 401 on every
 * failure; this discriminator lets the route emit the right body.
 */
export type SignatureResult =
  | { ok: true }
  | { ok: false; reason: "missing_header" | "signature_mismatch" };

/**
 * Verify a Fourthefans webhook HMAC. The signature header is
 * either `x-fourthefans-signature` (preferred) or
 * `x-webhook-signature` (fallback for staging probes that haven't
 * been updated yet). A `sha256=` prefix is tolerated for parity
 * with GitHub-style webhook conventions.
 */
export function verifyFourthefansSignature(
  rawBody: string,
  secret: string,
  headers: Record<string, string | null | undefined>,
): SignatureResult {
  const supplied =
    headers["x-fourthefans-signature"] ??
    headers["x-webhook-signature"] ??
    null;
  if (!supplied || supplied.trim() === "") {
    return { ok: false, reason: "missing_header" };
  }
  const expected = createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("hex");
  const stripped = supplied.replace(/^sha256=/i, "").trim();
  if (!constantTimeEqualHex(stripped, expected)) {
    return { ok: false, reason: "signature_mismatch" };
  }
  return { ok: true };
}

/** Validated, hashed, server-safe view of a Fourthefans webhook body. */
export interface ParsedFourthefansPayload {
  externalOrderId: string;
  eventId: string;
  purchasedAt: string;
  ticketCount: number;
  amountMinor: number | null;
  currency: string;
  emailHash: string | null;
  externalIdHash: string | null;
  fbc: string | null;
  fbp: string | null;
  ua: string | null;
  ipHash: string | null;
}

export type ParseResult =
  | { ok: true; payload: ParsedFourthefansPayload }
  | {
      ok: false;
      reason:
        | "missing_required_field"
        | "purchased_at_invalid";
      missing?: string[];
    };

/**
 * Validate a Fourthefans webhook body and project it into the
 * shape the route handler upserts into `ticketing_purchase_events`.
 * Performs PII hashing inline so the only raw PII that survives is
 * the original `raw_payload` blob the handler stores for audit.
 */
export function parseFourthefansPayload(
  raw: FourthefansRawPayload,
): ParseResult {
  const externalOrderId = stringOrNull(raw.order_id);
  const eventId = stringOrNull(raw.event_id);
  const purchasedAtRaw = stringOrNull(raw.purchased_at);
  const missing: string[] = [];
  if (!externalOrderId) missing.push("order_id");
  if (!eventId) missing.push("event_id");
  if (!purchasedAtRaw) missing.push("purchased_at");
  if (missing.length > 0) {
    return { ok: false, reason: "missing_required_field", missing };
  }

  const purchasedAtDate = new Date(purchasedAtRaw!);
  if (Number.isNaN(purchasedAtDate.getTime())) {
    return { ok: false, reason: "purchased_at_invalid" };
  }

  const ticketCount = Math.max(
    0,
    coerceInt(raw.tickets) ?? coerceInt(raw.ticket_count) ?? 1,
  );
  const amountMinor =
    coerceInt(raw.amount_minor) ?? coerceMoneyToMinor(raw.amount);
  const currency = stringOrNull(raw.currency) ?? "GBP";
  const fbc = stringOrNull(raw._fbc) ?? stringOrNull(raw.fbc);
  const fbp = stringOrNull(raw._fbp) ?? stringOrNull(raw.fbp);
  const emailHash = hashEmail(stringOrNull(raw.email));
  const externalIdHash = hashExternalId(stringOrNull(raw.external_id));
  const ua = stringOrNull(raw.ua) ?? stringOrNull(raw.user_agent);
  const ipHash = hashIp(stringOrNull(raw.ip));

  return {
    ok: true,
    payload: {
      externalOrderId: externalOrderId!,
      eventId: eventId!,
      purchasedAt: purchasedAtDate.toISOString(),
      ticketCount,
      amountMinor,
      currency,
      emailHash,
      externalIdHash,
      fbc,
      fbp,
      ua,
      ipHash,
    },
  };
}

function stringOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function coerceInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value);
  }
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n)) return Math.round(n);
  }
  return null;
}

/**
 * Convert a money-shaped value to integer minor units.
 *   - `12.50` (number) → `1250`
 *   - `"12.50"` (string) → `1250`
 *   - `12` (number) → `1200`
 * Returns `null` for un-coercible values so the column can stay
 * NULL for free / unpriced tiers.
 */
function coerceMoneyToMinor(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value * 100);
  }
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n)) return Math.round(n * 100);
  }
  return null;
}
