import type { RpcDb } from "./encrypt.ts";
import { encryptPii } from "./encrypt.ts";
import type { SignupGeo, SignupSubmission } from "./types.ts";

/**
 * lib/landing-pages/signup-store.ts
 *
 * Persistence for signup submissions — pure DI (PR-1 context.ts pattern) so
 * node:test exercises the REAL dedupe/insert logic against an in-memory
 * fake.
 *
 * Dedupe model (documented in migration 134 + the design doc):
 *   * First signup for (event, email) or (event, phone) → CANONICAL row
 *     with encrypted PII + hashes.
 *   * Repeat signup → attribution-only row: deduplicated_signup_id points
 *     at the canonical row, NO PII / hashes re-stored. The API returns the
 *     CANONICAL id with `deduplicated: true`.
 *   * Concurrent duplicates: the partial unique index wins the race — on
 *     23505 we re-read the canonical row and take the repeat path.
 */

export type SignupInsertBuilder = PromiseLike<{
  data: Array<{ id: string }> | null;
  error: { message: string; code?: string } | null;
}>;

export interface SignupDb extends RpcDb {
  from(table: string): {
    select(columns: string): SignupSelectBuilder;
    insert(row: Record<string, unknown>): {
      select(columns: string): SignupInsertBuilder;
    };
  };
}

export interface SignupSelectBuilder
  extends PromiseLike<{
    data: unknown[] | null;
    error: { message: string } | null;
  }> {
  eq(column: string, value: unknown): SignupSelectBuilder;
  is(column: string, value: null): SignupSelectBuilder;
}

export interface StoreSignupInput {
  eventId: string;
  clientId: string;
  submission: SignupSubmission;
  emailHash: string | null;
  phoneHash: string | null;
  ipHash: string | null;
  userAgent: string | null;
  /** Server-derived coarse geo (Vercel headers) — PR 6, migration 136. */
  geo: SignupGeo;
  tokenKey: string;
  now: Date;
}

export interface StoreSignupOutcome {
  signupId: string;
  deduplicated: boolean;
}

const UNIQUE_VIOLATION = "23505";

async function findCanonicalId(
  db: SignupDb,
  eventId: string,
  column: "email_hash" | "phone_hash",
  hash: string,
): Promise<string | null> {
  const { data, error } = await db
    .from("event_signups")
    .select("id")
    .eq("event_id", eventId)
    .eq(column, hash)
    .is("deduplicated_signup_id", null);
  if (error) {
    throw new Error(
      `[landing-pages] canonical lookup (${column}) failed: ${error.message}`,
    );
  }
  const rows = (data ?? []) as Array<{ id: string }>;
  return rows[0]?.id ?? null;
}

function baseRow(input: StoreSignupInput): Record<string, unknown> {
  const s = input.submission;
  return {
    event_id: input.eventId,
    client_id: input.clientId,
    phone_country_code: s.phone_country_code,
    // Public identifiers — deliberately NOT encrypted (design doc §PII
    // tiers): @-stripped + lowercased in the shared schema module.
    ig_handle: s.ig_handle,
    tt_handle: s.tt_handle,
    geo_country: input.geo.country,
    geo_region: input.geo.region,
    geo_city: input.geo.city,
    consent_gdpr_at: input.now.toISOString(),
    consent_wa_opt_in_at: s.consent_wa_opt_in ? input.now.toISOString() : null,
    source: s.source,
    utm: s.utm,
    referrer_url: s.referrer_url,
    ip_hash: input.ipHash,
    user_agent: input.userAgent,
  };
}

async function insertRow(
  db: SignupDb,
  row: Record<string, unknown>,
): Promise<{ id: string | null; uniqueViolation: boolean }> {
  const { data, error } = await db.from("event_signups").insert(row).select("id");
  if (error) {
    if (error.code === UNIQUE_VIOLATION || /duplicate key/i.test(error.message)) {
      return { id: null, uniqueViolation: true };
    }
    throw new Error(`[landing-pages] signup insert failed: ${error.message}`);
  }
  const id = (data ?? [])[0]?.id;
  if (!id) throw new Error("[landing-pages] signup insert returned no id");
  return { id, uniqueViolation: false };
}

/** Attribution-only repeat row — deliberately NO PII, NO hashes. */
async function insertRepeatRow(
  db: SignupDb,
  input: StoreSignupInput,
  canonicalId: string,
): Promise<void> {
  const { error } = await db
    .from("event_signups")
    .insert({ ...baseRow(input), deduplicated_signup_id: canonicalId })
    .select("id");
  if (error) {
    // Analytics row only — losing it must not fail the fan's signup.
    console.error("[landing-pages] repeat-signup row insert failed:", error.message);
  }
}

export async function storeSignup(
  db: SignupDb,
  input: StoreSignupInput,
): Promise<StoreSignupOutcome> {
  const { submission, emailHash, phoneHash, tokenKey } = input;

  // 1. Existing canonical row for either contact channel?
  let canonicalId: string | null = null;
  if (emailHash) {
    canonicalId = await findCanonicalId(db, input.eventId, "email_hash", emailHash);
  }
  if (!canonicalId && phoneHash) {
    canonicalId = await findCanonicalId(db, input.eventId, "phone_hash", phoneHash);
  }
  if (canonicalId) {
    await insertRepeatRow(db, input, canonicalId);
    return { signupId: canonicalId, deduplicated: true };
  }

  // 2. New canonical row: encrypt PII (blob + hash always travel together —
  //    DB CHECK enforces the pairing).
  const [emailEncrypted, phoneEncrypted] = await Promise.all([
    submission.email ? encryptPii(db, submission.email, tokenKey) : Promise.resolve(null),
    submission.phone_e164
      ? encryptPii(db, submission.phone_e164, tokenKey)
      : Promise.resolve(null),
  ]);

  const inserted = await insertRow(db, {
    ...baseRow(input),
    email_encrypted: emailEncrypted,
    email_hash: emailEncrypted ? emailHash : null,
    phone_encrypted: phoneEncrypted,
    phone_hash: phoneEncrypted ? phoneHash : null,
  });

  if (!inserted.uniqueViolation) {
    return { signupId: inserted.id as string, deduplicated: false };
  }

  // 3. Lost a concurrent race — the unique index caught it. Re-read the
  //    canonical row and record the repeat.
  let racedCanonicalId: string | null = null;
  if (emailHash) {
    racedCanonicalId = await findCanonicalId(db, input.eventId, "email_hash", emailHash);
  }
  if (!racedCanonicalId && phoneHash) {
    racedCanonicalId = await findCanonicalId(db, input.eventId, "phone_hash", phoneHash);
  }
  if (!racedCanonicalId) {
    throw new Error(
      "[landing-pages] unique violation but no canonical row found — investigate",
    );
  }
  await insertRepeatRow(db, input, racedCanonicalId);
  return { signupId: racedCanonicalId, deduplicated: true };
}
