import "server-only";

import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * lib/db/fan-detail.ts — single-fan detail read for the admin detail view
 * (OP909 Sprint 2 PR 6). Like lib/db/fan-signups.ts this uses the
 * SERVICE-ROLE client (landing_page_decrypt_batch is service_role-only) and
 * the same scope contract: callers pass a clientId from requireClientContext()
 * and every query pins `.eq("client_id", clientId)` — a forged/foreign signup
 * id matches zero rows.
 *
 * Unlike the list read, this intentionally does NOT filter deleted/anonymised
 * rows: the detail view must be able to show a soft-deleted or anonymised fan
 * (with the appropriate status + empty PII).
 */

export interface FanDetailTimelineRow {
  createdAt: string;
  eventName: string;
  isRepeat: boolean;
}

export interface FanDetail {
  id: string;
  email: string | null;
  phone: string | null;
  igHandle: string | null;
  ttHandle: string | null;
  phoneCountryCode: string | null;
  geoCountry: string | null;
  geoRegion: string | null;
  geoCity: string | null;
  source: string | null;
  utm: Record<string, string> | null;
  referrerUrl: string | null;
  userAgent: string | null;
  consentGdprAt: string | null;
  consentWaOptInAt: string | null;
  createdAt: string;
  deletedAt: string | null;
  anonymizedAt: string | null;
  eventId: string;
  eventName: string;
  eventSlug: string;
  /** Canonical signup + its repeat/attribution touches (unsorted). */
  timeline: FanDetailTimelineRow[];
}

interface RawDetailRow {
  id: string;
  email_encrypted: string | null;
  phone_encrypted: string | null;
  ig_handle: string | null;
  tt_handle: string | null;
  phone_country_code: string | null;
  geo_country: string | null;
  geo_region: string | null;
  geo_city: string | null;
  source: string | null;
  utm: Record<string, string> | null;
  referrer_url: string | null;
  user_agent: string | null;
  consent_gdpr_at: string | null;
  consent_wa_opt_in_at: string | null;
  created_at: string;
  deleted_at: string | null;
  anonymized_at: string | null;
  event_id: string;
  events:
    | { id: string; name: string; slug: string }
    | Array<{ id: string; name: string; slug: string }>
    | null;
}

// `anonymized_at` (migration 140) is selected separately so the read stays
// forward-compatible: if the migration hasn't been applied yet, the query
// below retries without it rather than 500-ing the whole detail view.
const DETAIL_COLUMNS_BASE =
  "id, email_encrypted, phone_encrypted, ig_handle, tt_handle, " +
  "phone_country_code, geo_country, geo_region, geo_city, source, utm, " +
  "referrer_url, user_agent, consent_gdpr_at, consent_wa_opt_in_at, " +
  "created_at, deleted_at, event_id, " +
  "events!inner (id, name, slug)";

const MISSING_ANONYMIZED_COL = /anonymized_at/i;

/**
 * Fetch the canonical row, tolerating a not-yet-applied migration 140: try
 * with anonymized_at, and on an "undefined column" error retry without it
 * (anonymized_at defaults to null). Removes the deploy-ordering footgun where
 * the detail view would 500 between merge and migration apply.
 */
async function fetchCanonical(
  db: ReturnType<typeof createServiceRoleClient>,
  clientId: string,
  signupId: string,
): Promise<RawDetailRow | null> {
  const withAnon = await db
    .from("event_signups")
    .select(`${DETAIL_COLUMNS_BASE}, anonymized_at`)
    .eq("id", signupId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (!withAnon.error) {
    return (withAnon.data as unknown as RawDetailRow) ?? null;
  }
  if (
    withAnon.error.code !== "42703" &&
    !MISSING_ANONYMIZED_COL.test(withAnon.error.message)
  ) {
    throw new Error(
      `[admin-fan-detail] signup lookup failed: ${withAnon.error.message}`,
    );
  }
  const fallback = await db
    .from("event_signups")
    .select(DETAIL_COLUMNS_BASE)
    .eq("id", signupId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (fallback.error) {
    throw new Error(
      `[admin-fan-detail] signup lookup failed: ${fallback.error.message}`,
    );
  }
  if (!fallback.data) return null;
  return { ...(fallback.data as unknown as RawDetailRow), anonymized_at: null };
}

function embeddedEvent(row: RawDetailRow) {
  const e = row.events;
  if (!e) return null;
  return Array.isArray(e) ? (e[0] ?? null) : e;
}

function requireTokenKey(): string {
  const value = process.env.LANDING_PAGES_TOKEN_KEY;
  if (!value || value.length < 8) {
    throw new Error(
      "[admin-fan-detail] LANDING_PAGES_TOKEN_KEY must be set and at least 8 characters",
    );
  }
  return value;
}

async function decryptPair(
  db: ReturnType<typeof createServiceRoleClient>,
  emailBlob: string | null,
  phoneBlob: string | null,
): Promise<{ email: string | null; phone: string | null }> {
  if (emailBlob === null && phoneBlob === null) {
    return { email: null, phone: null };
  }
  const { data, error } = await db.rpc("landing_page_decrypt_batch", {
    p_blobs: [emailBlob, phoneBlob],
    p_key: requireTokenKey(),
  });
  if (error) {
    throw new Error(`[admin-fan-detail] decrypt failed: ${error.message}`);
  }
  const arr = (Array.isArray(data) ? data : []) as Array<string | null>;
  return { email: arr[0] ?? null, phone: arr[1] ?? null };
}

/**
 * Full detail for one signup, or null when it doesn't exist / belongs to
 * another client. Fetches the canonical row, decrypts its PII, and builds the
 * timeline from the canonical row + any repeat/attribution rows.
 */
export async function getFanDetail(
  clientId: string,
  signupId: string,
): Promise<FanDetail | null> {
  const db = createServiceRoleClient();

  const row = await fetchCanonical(db, clientId, signupId);
  if (!row) return null;

  const event = embeddedEvent(row);
  if (!event) return null;

  const [{ email, phone }, repeats] = await Promise.all([
    decryptPair(db, row.email_encrypted, row.phone_encrypted),
    fetchRepeats(db, clientId, signupId),
  ]);

  const timeline: FanDetailTimelineRow[] = [
    { createdAt: row.created_at, eventName: event.name, isRepeat: false },
    ...repeats,
  ];

  return {
    id: row.id,
    email,
    phone,
    igHandle: row.ig_handle,
    ttHandle: row.tt_handle,
    phoneCountryCode: row.phone_country_code,
    geoCountry: row.geo_country,
    geoRegion: row.geo_region,
    geoCity: row.geo_city,
    source: row.source,
    utm: row.utm,
    referrerUrl: row.referrer_url,
    userAgent: row.user_agent,
    consentGdprAt: row.consent_gdpr_at,
    consentWaOptInAt: row.consent_wa_opt_in_at,
    createdAt: row.created_at,
    deletedAt: row.deleted_at,
    anonymizedAt: row.anonymized_at,
    eventId: event.id,
    eventName: event.name,
    eventSlug: event.slug,
    timeline,
  };
}

async function fetchRepeats(
  db: ReturnType<typeof createServiceRoleClient>,
  clientId: string,
  canonicalId: string,
): Promise<FanDetailTimelineRow[]> {
  const { data, error } = await db
    .from("event_signups")
    .select("created_at, events!inner (name)")
    .eq("client_id", clientId)
    .eq("deduplicated_signup_id", canonicalId);
  if (error) {
    // The timeline degrades to the canonical row alone — a repeat-lookup
    // failure must not 500 the whole detail view.
    console.error(`[admin-fan-detail] repeat lookup failed: ${error.message}`);
    return [];
  }
  return ((data ?? []) as Array<{
    created_at: string;
    events: { name: string } | Array<{ name: string }> | null;
  }>).map((r) => {
    const e = Array.isArray(r.events) ? r.events[0] : r.events;
    return {
      createdAt: r.created_at,
      eventName: e?.name ?? "—",
      isRepeat: true,
    };
  });
}
