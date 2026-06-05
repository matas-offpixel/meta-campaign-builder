/**
 * lib/customer-audience/hash-client.ts
 *
 * BROWSER-ONLY — never import from a Server Component or Route Handler.
 *
 * PII Safety contract:
 *   - Raw PII (emails, phone numbers) NEVER leaves this module as plaintext.
 *   - Only SHA-256 hex digests are returned.
 *   - No console.log of values — only counts.
 *   - Uses Web Crypto API (crypto.subtle) — no third-party hash library.
 *
 * Meta's expected normalisation for Customer Match:
 *   Email: trim, lowercase
 *   Phone: E.164 format, no "+" prefix, strip non-digits after country code
 *
 * See: https://developers.facebook.com/docs/marketing-api/audiences/guides/custom-audiences/
 */

import { parsePhoneNumberFromString } from "libphonenumber-js";

// ─── Email ────────────────────────────────────────────────────────────────────

/**
 * Normalise an email for Meta hashing:
 *   - trim whitespace
 *   - lowercase
 * Returns the normalised string, or null if the value is empty after trim.
 */
export function normalizeEmail(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  if (!v || !v.includes("@")) return null;
  return v;
}

// ─── Phone ────────────────────────────────────────────────────────────────────

/**
 * Normalise a phone number to E.164 format WITHOUT the leading "+", as Meta
 * expects. Default country code: GB (+44).
 *
 * Returns null on parse failure (the row is skipped, not errored).
 */
export function normalizePhone(raw: string, defaultCountry = "GB"): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const parsed = parsePhoneNumberFromString(trimmed, defaultCountry as Parameters<typeof parsePhoneNumberFromString>[1]);
  if (!parsed || !parsed.isValid()) return null;

  // Meta wants E.164 without the leading "+"
  return parsed.format("E.164").replace(/^\+/, "");
}

// ─── SHA-256 via Web Crypto ───────────────────────────────────────────────────

/**
 * SHA-256 hash of a UTF-8 string. Returns lowercase hex.
 * Uses `crypto.subtle` — available in all modern browsers and in Node ≥18.
 */
export async function sha256(s: string): Promise<string> {
  const encoded = new TextEncoder().encode(s);
  const buffer = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ─── Batch hashing ────────────────────────────────────────────────────────────

export type MatchSchema = "EMAIL_SHA256" | "PHONE_SHA256";

export interface AudienceBatchResult {
  /** Meta-compatible schema array, e.g. ["EMAIL_SHA256"] or ["EMAIL_SHA256","PHONE_SHA256"] */
  schema: MatchSchema[];
  /**
   * Rows in schema order. Each row is a string[] where missing fields are "".
   * Empty-string columns will be rejected by Meta — callers must filter to
   * schema entries that have valid values.
   */
  data: string[][];
  /** Email rows successfully hashed (for logging only — no values). */
  emailCount: number;
  /** Phone rows successfully hashed (for logging only — no values). */
  phoneCount: number;
  /** Rows where both email and phone were absent or invalid (skipped). */
  skippedCount: number;
}

/**
 * Hash a batch of rows into Meta's expected upload shape.
 *
 * Deduplication is performed on normalised plaintext before hashing.
 * The returned `data` uses only the schema columns present (EMAIL_SHA256
 * and/or PHONE_SHA256) depending on what the caller supplies.
 */
export async function hashAudienceBatch(
  rows: { email?: string; phone?: string }[],
  includeEmail = true,
  includePhone = true,
): Promise<AudienceBatchResult> {
  const schema: MatchSchema[] = [];
  if (includeEmail) schema.push("EMAIL_SHA256");
  if (includePhone) schema.push("PHONE_SHA256");

  // Deduplicate by normalised email+phone key before hashing
  const seen = new Set<string>();
  const unique: { email: string | null; phone: string | null }[] = [];

  for (const row of rows) {
    const email = includeEmail && row.email ? normalizeEmail(row.email) : null;
    const phone = includePhone && row.phone ? normalizePhone(row.phone) : null;

    if (!email && !phone) continue;

    const dedupeKey = `${email ?? ""}|${phone ?? ""}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    unique.push({ email, phone });
  }

  // Hash all values in parallel
  const hashed: string[][] = [];
  let emailCount = 0;
  let phoneCount = 0;
  let skippedCount = rows.length - unique.length;

  for (const row of unique) {
    const entry: string[] = [];

    if (includeEmail) {
      if (row.email) {
        entry.push(await sha256(row.email));
        emailCount++;
      } else {
        entry.push("");
      }
    }

    if (includePhone) {
      if (row.phone) {
        entry.push(await sha256(row.phone));
        phoneCount++;
      } else {
        entry.push("");
      }
    }

    // Only include row if at least one column is non-empty
    if (entry.some((v) => v !== "")) {
      hashed.push(entry);
    } else {
      skippedCount++;
    }
  }

  return { schema, data: hashed, emailCount, phoneCount, skippedCount };
}

/**
 * Split a flat list of hashed rows into chunks of `size` for batched posting.
 * Default 10,000 matches Meta's recommended upload chunk size.
 */
export function chunkData(data: string[][], size = 10_000): string[][][] {
  const chunks: string[][][] = [];
  for (let i = 0; i < data.length; i += size) {
    chunks.push(data.slice(i, i + size));
  }
  return chunks;
}
