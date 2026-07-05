import "server-only";

import { hashEmail } from "@/lib/landing-pages/hash";
import {
  buildFanQueryPlan,
  classifySearch,
  FANS_PER_PAGE,
  type FanCsvRow,
  type FanFilters,
  type FanQueryOp,
} from "@/lib/admin/fans-query";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

/**
 * lib/db/fan-signups.ts — data layer for the fan table (OP909 Phase 5).
 *
 * Unlike the other client-admin reads this module uses the SERVICE-ROLE
 * client: decryption (landing_page_decrypt_batch, migration 138) is
 * service_role-execute-only by design. The scope contract compensates:
 * callers pass a clientId that came from requireClientContext() (never
 * user input), and every query pins `.eq("client_id", clientId)` before
 * any user-controlled filter is applied.
 */

export interface FanRow {
  id: string;
  email: string | null;
  phone: string | null;
  igHandle: string | null;
  ttHandle: string | null;
  country: string | null;
  region: string | null;
  marketingConsentAt: string | null;
  waOptInAt: string | null;
  createdAt: string;
  eventId: string;
  eventName: string;
  eventSlug: string;
}

export interface FanListResult {
  rows: FanRow[];
  /** Total rows matching the filters (all pages). */
  total: number;
  perPage: number;
}

interface RawSignupRow {
  id: string;
  email_encrypted: string | null;
  phone_encrypted: string | null;
  ig_handle: string | null;
  tt_handle: string | null;
  geo_country: string | null;
  geo_region: string | null;
  consent_gdpr_at: string | null;
  consent_wa_opt_in_at: string | null;
  created_at: string;
  event_id: string;
  events:
    | { id: string; name: string; slug: string }
    | Array<{ id: string; name: string; slug: string }>
    | null;
}

const SELECT_COLUMNS =
  "id, email_encrypted, phone_encrypted, ig_handle, tt_handle, " +
  "geo_country, geo_region, consent_gdpr_at, consent_wa_opt_in_at, " +
  "created_at, event_id, events!inner (id, name, slug)";

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Replay a pure query plan onto the PostgREST builder. */
function applyPlan(builder: any, plan: FanQueryOp[]): any {
  let b = builder;
  for (const op of plan) {
    switch (op.op) {
      case "eq":
        b = b.eq(op.column, op.value);
        break;
      case "is":
        b = b.is(op.column, op.value);
        break;
      case "not":
        b = b.not(op.column, op.operator, op.value);
        break;
      case "gte":
        b = b.gte(op.column, op.value);
        break;
      case "lte":
        b = b.lte(op.column, op.value);
        break;
      case "or":
        b = b.or(op.conditions);
        break;
      case "order":
        b = b.order(op.column, { ascending: op.ascending });
        break;
      case "range":
        b = b.range(op.fromIndex, op.toIndex);
        break;
    }
  }
  return b;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function requireEnv(name: "LANDING_PAGES_TOKEN_KEY" | "LANDING_PAGES_HASH_SALT"): string {
  const value = process.env[name];
  if (!value || value.length < 8) {
    throw new Error(`[admin-fans] ${name} must be set and at least 8 characters`);
  }
  return value;
}

function embeddedEvent(row: RawSignupRow) {
  const e = row.events;
  if (!e) return null;
  return Array.isArray(e) ? (e[0] ?? null) : e;
}

/** One RPC per column (not per row) — migration 138. */
async function decryptColumn(
  db: ReturnType<typeof createServiceRoleClient>,
  blobs: Array<string | null>,
  key: string,
): Promise<Array<string | null>> {
  if (blobs.every((b) => b === null)) return blobs.map(() => null);
  const { data, error } = await db.rpc("landing_page_decrypt_batch", {
    p_blobs: blobs,
    p_key: key,
  });
  if (error) {
    throw new Error(`[admin-fans] batch decrypt failed: ${error.message}`);
  }
  if (!Array.isArray(data) || data.length !== blobs.length) {
    throw new Error(
      `[admin-fans] batch decrypt returned ${Array.isArray(data) ? data.length : typeof data} values for ${blobs.length} blobs`,
    );
  }
  return data as Array<string | null>;
}

async function fetchAndDecrypt(
  clientId: string,
  filters: FanFilters,
  forExport: boolean,
): Promise<{ rows: FanRow[]; total: number }> {
  const db = createServiceRoleClient();

  const term = classifySearch(filters.search);
  const hashedEmail =
    term.kind === "email"
      ? hashEmail(term.normalised, requireEnv("LANDING_PAGES_HASH_SALT"))
      : null;
  const plan = buildFanQueryPlan(filters, hashedEmail, forExport);

  const base = db
    .from("event_signups")
    .select(SELECT_COLUMNS, { count: "exact" })
    .eq("client_id", clientId);
  const { data, error, count } = await applyPlan(base, plan);
  if (error) {
    throw new Error(`[admin-fans] signup query failed: ${error.message}`);
  }

  const raw = (data ?? []) as unknown as RawSignupRow[];
  const key = requireEnv("LANDING_PAGES_TOKEN_KEY");
  const [emails, phones] = await Promise.all([
    decryptColumn(db, raw.map((r) => r.email_encrypted), key),
    decryptColumn(db, raw.map((r) => r.phone_encrypted), key),
  ]);

  const rows: FanRow[] = [];
  raw.forEach((row, i) => {
    const event = embeddedEvent(row);
    if (!event) return;
    rows.push({
      id: row.id,
      email: emails[i],
      phone: phones[i],
      igHandle: row.ig_handle,
      ttHandle: row.tt_handle,
      country: row.geo_country,
      region: row.geo_region,
      marketingConsentAt: row.consent_gdpr_at,
      waOptInAt: row.consent_wa_opt_in_at,
      createdAt: row.created_at,
      eventId: event.id,
      eventName: event.name,
      eventSlug: event.slug,
    });
  });
  return { rows, total: count ?? rows.length };
}

/** One page of decrypted fan rows + the total for pagination. */
export async function listFanSignups(
  clientId: string,
  filters: FanFilters,
): Promise<FanListResult> {
  const { rows, total } = await fetchAndDecrypt(clientId, filters, false);
  return { rows, total, perPage: FANS_PER_PAGE };
}

/** All matching rows (capped) in CSV row shape. */
export async function listFanSignupsForCsv(
  clientId: string,
  filters: FanFilters,
): Promise<FanCsvRow[]> {
  const { rows } = await fetchAndDecrypt(clientId, filters, true);
  return rows.map((row) => ({
    email: row.email,
    phone: row.phone,
    ig: row.igHandle,
    tt: row.ttHandle,
    country: row.country,
    region: row.region,
    marketingConsentAt: row.marketingConsentAt,
    waOptInAt: row.waOptInAt,
    signupAt: row.createdAt,
    pageSlug: row.eventSlug,
    pageTitle: row.eventName,
  }));
}

// ─── Filter dropdown options (session client — no PII) ──────────────────────

export interface FanFilterOptions {
  events: Array<{ eventId: string; eventName: string }>;
  countries: string[];
}

/**
 * Options for the filter bar. Session-bound client + member RLS (only
 * non-PII columns cross this boundary).
 */
export async function getFanFilterOptions(
  clientId: string,
): Promise<FanFilterOptions> {
  const supabase = await createClient();
  const [eventsRes, countriesRes] = await Promise.all([
    supabase
      .from("events")
      .select("id, name, page_events!inner (id)")
      .eq("client_id", clientId),
    supabase
      .from("event_signups")
      .select("geo_country")
      .eq("client_id", clientId)
      .is("deleted_at", null)
      .not("geo_country", "is", null),
  ]);
  if (eventsRes.error) {
    throw new Error(`[admin-fans] event options failed: ${eventsRes.error.message}`);
  }
  if (countriesRes.error) {
    throw new Error(
      `[admin-fans] country options failed: ${countriesRes.error.message}`,
    );
  }

  const events = ((eventsRes.data ?? []) as Array<{ id: string; name: string }>)
    .map((row) => ({ eventId: row.id, eventName: row.name }))
    .sort((a, b) => a.eventName.localeCompare(b.eventName));

  const countries = Array.from(
    new Set(
      ((countriesRes.data ?? []) as Array<{ geo_country: string | null }>)
        .map((row) => row.geo_country)
        .filter((c): c is string => typeof c === "string" && c.length === 2),
    ),
  ).sort();

  return { events, countries };
}
