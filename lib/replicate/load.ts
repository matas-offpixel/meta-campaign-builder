/**
 * Reads what replicateDraft needs, through whatever Supabase client the
 * caller passes (the server action passes the operator's session client, so
 * owner RLS applies). SELECTs only. Every list read is chunked or paged
 * (PostgREST returns at most 1,000 rows).
 *
 * Before migration 266 is applied the new columns (events.meta_pixel_id,
 * venues.client_id / meta_ad_account_id / meta_pixel_id) don't exist: the
 * reads fall back to the older column lists and those values read as unset.
 */

import { normalizeAdAccountId } from "../meta/ad-account.ts";
import { venueKey } from "../plan/venue-key.ts";
import type { AudienceRoleRow, ReplicateEvent, ReplicateVenue } from "./replicate.ts";

type Err = { code?: string; message?: string } | null;
type Res<T> = Promise<{ data: T | null; error: Err }>;

/** The slice of the Supabase query builder these reads use. */
export interface ReplicateDb {
  from(table: string): {
    select(cols: string): ReplicateQuery;
  };
}

export interface ReplicateQuery {
  eq(col: string, value: unknown): ReplicateQuery;
  in(col: string, values: unknown[]): ReplicateQuery;
  order(col: string, opts?: { ascending?: boolean }): ReplicateQuery;
  range(from: number, to: number): Res<Record<string, unknown>[]>;
  maybeSingle(): Res<Record<string, unknown>>;
}

const PAGE = 1000;
const CHUNK = 100;

const EVENT_COLS = "id, event_code, client_id, name, venue_id, venue_name, venue_city, event_date, presale_at, general_sale_at, signup_url, meta_ad_account_id";

function missingColumn(error: Err): boolean {
  if (!error) return false;
  return error.code === "42703" || /column .* does not exist/i.test(error.message ?? "");
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export type LoadedEvent = ReplicateEvent & { venue_id: string | null };

export async function loadReplicateEvent(db: ReplicateDb, id: string): Promise<LoadedEvent | null> {
  let res = await db.from("events").select(`${EVENT_COLS}, meta_pixel_id`).eq("id", id).maybeSingle();
  if (missingColumn(res.error)) res = await db.from("events").select(EVENT_COLS).eq("id", id).maybeSingle();
  if (res.error || !res.data) return null;
  const r = res.data;
  return {
    id: String(r.id),
    event_code: text(r.event_code),
    client_id: text(r.client_id),
    name: text(r.name),
    venue_id: text(r.venue_id),
    venue_name: text(r.venue_name),
    venue_city: text(r.venue_city),
    event_date: text(r.event_date),
    presale_at: text(r.presale_at),
    general_sale_at: text(r.general_sale_at),
    signup_url: text(r.signup_url),
    meta_ad_account_id: text(r.meta_ad_account_id),
    meta_pixel_id: text(r.meta_pixel_id),
  };
}

function toVenue(r: Record<string, unknown>): ReplicateVenue {
  return {
    id: String(r.id),
    name: String(r.name ?? ""),
    meta_ad_account_id: text(r.meta_ad_account_id),
    meta_pixel_id: text(r.meta_pixel_id),
  };
}

/**
 * The event's venue: by events.venue_id, else the client's venue whose name
 * has the event's venue key. Null when neither exists (every venue reads
 * "not set, check").
 */
export async function loadReplicateVenue(db: ReplicateDb, event: LoadedEvent): Promise<ReplicateVenue | null> {
  if (event.venue_id) {
    const res = await db.from("venues").select("*").eq("id", event.venue_id).maybeSingle();
    if (!res.error && res.data) return toVenue(res.data);
  }
  const key = venueKey(event.venue_name);
  if (!event.client_id || !key) return null;
  const res = await db.from("venues").select("*").eq("client_id", event.client_id).order("name").range(0, PAGE - 1);
  if (res.error || !res.data) return null;
  const hit = res.data.find((r) => venueKey(String(r.name ?? "")) === key);
  return hit ? toVenue(hit) : null;
}

const AUDIENCE_COLS = "meta_audience_id, meta_ad_account_id, funnel_stage, audience_subtype, retention_days, source_id, list_role, event_id, status, name";

function toAudience(r: Record<string, unknown>): AudienceRoleRow {
  return {
    meta_audience_id: text(r.meta_audience_id),
    meta_ad_account_id: String(r.meta_ad_account_id ?? ""),
    funnel_stage: String(r.funnel_stage ?? ""),
    audience_subtype: String(r.audience_subtype ?? ""),
    retention_days: typeof r.retention_days === "number" ? r.retention_days : null,
    source_id: text(r.source_id),
    list_role: text(r.list_role),
    event_id: text(r.event_id),
    status: text(r.status),
    name: text(r.name),
  };
}

async function pagedAudiences(db: ReplicateDb, col: string, values: string[]): Promise<AudienceRoleRow[]> {
  const out: AudienceRoleRow[] = [];
  for (let at = 0; ; at += PAGE) {
    const res = await db.from("meta_custom_audiences").select(AUDIENCE_COLS).in(col, values).order("id").range(at, at + PAGE - 1);
    if (res.error || !res.data) break;
    out.push(...res.data.map(toAudience));
    if (res.data.length < PAGE) break;
  }
  return out;
}

/** The rows behind the source draft's audience ids, and every row in the target account. */
export async function loadAudienceRows(
  db: ReplicateDb,
  sourceIds: string[],
  targetAccount: string | null,
): Promise<AudienceRoleRow[]> {
  const rows: AudienceRoleRow[] = [];
  const ids = [...new Set(sourceIds.filter(Boolean))];
  for (let i = 0; i < ids.length; i += CHUNK) rows.push(...(await pagedAudiences(db, "meta_audience_id", ids.slice(i, i + CHUNK))));
  const act = normalizeAdAccountId(targetAccount);
  if (act) rows.push(...(await pagedAudiences(db, "meta_ad_account_id", [act, act.replace(/^act_/, "")])));
  return rows;
}

/** bm_ad_accounts.name by `act_…` id, bm_pages.page_name by page id. Missing names stay out. */
export async function loadReplicateNames(
  db: ReplicateDb,
  accounts: Array<string | null>,
  pageIds: string[],
): Promise<{ accountNames: Record<string, string>; pageNames: Record<string, string> }> {
  const accountNames: Record<string, string> = {};
  const acts = [...new Set(accounts.map((a) => normalizeAdAccountId(a)).filter((a): a is string => Boolean(a)))];
  if (acts.length) {
    const res = await db.from("bm_ad_accounts").select("ad_account_id, name").in("ad_account_id", acts).order("ad_account_id").range(0, PAGE - 1);
    for (const r of res.data ?? []) {
      const id = normalizeAdAccountId(text(r.ad_account_id));
      const name = text(r.name);
      if (id && name) accountNames[id] = name;
    }
  }
  const pageNames: Record<string, string> = {};
  const pages = [...new Set(pageIds.filter(Boolean))];
  for (let i = 0; i < pages.length; i += CHUNK) {
    const res = await db.from("bm_pages").select("page_id, page_name").in("page_id", pages.slice(i, i + CHUNK)).order("page_id").range(0, PAGE - 1);
    for (const r of res.data ?? []) {
      const id = text(r.page_id);
      const name = text(r.page_name);
      if (id && name && !pageNames[id]) pageNames[id] = name;
    }
  }
  return { accountNames, pageNames };
}
