import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  getAudienceSegments,
  getSegmentById,
  searchListTags,
  MailchimpApiError,
} from "../mailchimp/client.ts";
import { birdJson, BirdHttpError } from "./bird/client.ts";
import { getD2CConnectionCredentials } from "../db/d2c.ts";
import { parseMailchimpApiKey } from "./mailchimp/credentials.ts";
import type { D2CConnection } from "./types";

/**
 * lib/d2c/stats.ts
 *
 * External signup-count readers for the D2C event dashboard. Every helper is
 * READ-ONLY (no writes, no side effects) so the D2C 3-of-3 live gate does NOT
 * apply — reads run even for dry-run connections. Each returns a discriminated
 * result so a provider outage degrades one card, never the whole dashboard.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any, any, any>;

export interface CountOk {
  count: number;
  asOf: string;
}
export interface CountErr {
  error: string;
}
export type CountResult = CountOk | CountErr;

export function isCountOk(r: CountResult): r is CountOk {
  return typeof (r as CountOk).count === "number";
}

// ─── Mailchimp ───────────────────────────────────────────────────────────────

/**
 * Count Mailchimp members carrying `tagName` in `audienceId`.
 *
 * Preferred path: the list-level Tags API (`GET /lists/{id}/tag-search`) —
 * this is the account's actual Tags panel (Contacts → Tags filter), which is
 * where Throwback-style tags (e.g. `T26-ALGARVE`) live. Tag-search returns
 * tag identity only (id + name, NO member_count — verified against a live
 * Throwback tag; the Mailchimp docs' example response agrees), so a matched
 * tag needs a follow-up `getSegmentById` call: every tag is internally a
 * static segment sharing the tag's numeric id, and reading it directly by id
 * also sidesteps an observed lag where a same-day-created tag hadn't yet
 * appeared in a bulk `type=static` segments listing.
 *
 * Falls back to the bulk Segments listing (matched by name) for older
 * accounts where a UI-created tag never got a tag-search entry at all.
 *
 * Credentials are resolved from the connection's encrypted blob (the
 * `D2CConnection.credentials` field is intentionally empty on public reads).
 */
export async function countMailchimpMembersByTag(
  supabase: AnySupabaseClient,
  connection: D2CConnection,
  audienceId: string,
  tagName: string,
): Promise<CountResult> {
  try {
    const creds = await getD2CConnectionCredentials(supabase, connection.id);
    const apiKey =
      creds && typeof creds.api_key === "string" ? creds.api_key.trim() : "";
    if (!apiKey) return { error: "Mailchimp credentials unavailable" };
    const dc =
      (creds && typeof creds.server_prefix === "string"
        ? creds.server_prefix.trim()
        : "") || parseMailchimpApiKey(apiKey)?.serverPrefix || "";
    if (!dc) return { error: "Mailchimp data-centre could not be derived" };

    const wanted = tagName.trim().toLowerCase();
    const asOf = new Date().toISOString();

    const tagSearch = await searchListTags(dc, audienceId, apiKey, tagName);
    const tagMatch = (tagSearch.tags ?? []).find(
      (t) => (t.name ?? "").trim().toLowerCase() === wanted,
    );
    if (tagMatch) {
      const seg = await getSegmentById(dc, audienceId, tagMatch.id, apiKey);
      return { count: seg.member_count ?? 0, asOf };
    }

    const segs = await getAudienceSegments(dc, audienceId, apiKey, {
      type: "static",
    });
    const segMatch = segs.segments.find(
      (s) => (s.name ?? "").trim().toLowerCase() === wanted,
    );
    if (segMatch) {
      return { count: segMatch.member_count ?? 0, asOf };
    }

    return { error: `Tag "${tagName}" not found in audience` };
  } catch (e) {
    const msg =
      e instanceof MailchimpApiError
        ? e.message
        : e instanceof Error
          ? e.message
          : "Mailchimp read failed";
    return { error: msg };
  }
}

// ─── Bird ──────────────────────────────────────────────────────────────────

interface BirdListRow {
  id?: string;
  name?: string;
  // Bird list rows may expose a member counter under a few names depending on
  // API version — read defensively.
  contactCount?: number;
  memberCount?: number;
  totalContacts?: number;
  count?: number;
}
interface BirdListEnvelope {
  results?: BirdListRow[];
  data?: BirdListRow[];
  total?: number;
}
interface BirdContactsEnvelope {
  total?: number;
  results?: unknown[];
  data?: unknown[];
}

function firstNumber(...vals: Array<number | undefined | null>): number | null {
  for (const v of vals) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

/**
 * Count Bird contacts in the list matching `tagName`. Bird organises contacts
 * into named *lists* (not Mailchimp-style tags), so we resolve the list by
 * name, then read its member count — either off the list row directly or via
 * `GET …/contacts?include_total=true&limit=1` (management endpoints accept
 * `include_total`, returning a `total`).
 *
 * `channelId` is accepted for signature parity with the send audience shape
 * but is not needed for the contacts read.
 */
export async function countBirdContactsByTag(
  supabase: AnySupabaseClient,
  connection: D2CConnection,
  workspaceId: string,
  _channelId: string | null,
  tagName: string,
): Promise<CountResult> {
  try {
    const creds = await getD2CConnectionCredentials(supabase, connection.id);
    const apiKey =
      creds && typeof creds.api_key === "string" ? creds.api_key.trim() : "";
    const wsId =
      (creds && typeof creds.workspace_id === "string"
        ? creds.workspace_id.trim()
        : "") || workspaceId;
    if (!apiKey || !wsId) return { error: "Bird credentials unavailable" };

    const listEnv = await birdJson<BirdListEnvelope>(
      apiKey,
      `/workspaces/${wsId}/lists?limit=100&include_total=true`,
      { method: "GET" },
    );
    const lists = listEnv.results ?? listEnv.data ?? [];
    const wanted = tagName.trim().toLowerCase();
    const match = lists.find(
      (l) => (l.name ?? "").trim().toLowerCase() === wanted,
    );
    if (!match || !match.id) {
      return { error: `List "${tagName}" not found in workspace` };
    }

    const direct = firstNumber(
      match.contactCount,
      match.memberCount,
      match.totalContacts,
      match.count,
    );
    if (direct != null) {
      return { count: direct, asOf: new Date().toISOString() };
    }

    // Fall back to a management-endpoint total on the list's contacts.
    const contactsEnv = await birdJson<BirdContactsEnvelope>(
      apiKey,
      `/workspaces/${wsId}/lists/${match.id}/contacts?limit=1&include_total=true`,
      { method: "GET" },
    );
    const total = firstNumber(contactsEnv.total);
    if (total != null) {
      return { count: total, asOf: new Date().toISOString() };
    }
    return { error: "Bird list member count unavailable" };
  } catch (e) {
    const msg =
      e instanceof BirdHttpError
        ? `Bird HTTP ${e.status}`
        : e instanceof Error
          ? e.message
          : "Bird read failed";
    return { error: msg };
  }
}

// ─── Landing pages ───────────────────────────────────────────────────────────

/**
 * Count live landing-page signups for an event (canonical, non-deleted,
 * non-anonymised). Returns 0 for D2C-only events with no landing page.
 * Forward-compatible with pre-migration-140 DBs (retries without
 * `anonymized_at` when the column is missing).
 */
export async function countLandingPageSignups(
  supabase: AnySupabaseClient,
  eventId: string,
): Promise<CountOk> {
  const asOf = new Date().toISOString();
  const withAnon = await supabase
    .from("event_signups")
    .select("id", { count: "exact", head: true })
    .eq("event_id", eventId)
    .is("deleted_at", null)
    .is("anonymized_at", null);
  if (!withAnon.error) {
    return { count: withAnon.count ?? 0, asOf };
  }
  // 42703 = undefined_column (pre-migration-140 DB).
  if (
    withAnon.error.code === "42703" ||
    /anonymized_at/i.test(withAnon.error.message)
  ) {
    const fallback = await supabase
      .from("event_signups")
      .select("id", { count: "exact", head: true })
      .eq("event_id", eventId)
      .is("deleted_at", null);
    return { count: fallback.count ?? 0, asOf };
  }
  console.warn("[d2c stats] LP signup count failed:", withAnon.error.message);
  return { count: 0, asOf };
}

// ─── Aggregate ───────────────────────────────────────────────────────────────

export interface EventSignupStats {
  mailchimp: CountResult | null;
  bird: CountResult | null;
  landing_page: CountOk | null;
  /** Sum of the countable (non-error, non-null) sources. */
  total_unique_estimate: number;
}

/** Pure sum seam — tested in isolation. */
export function sumSignupStats(input: {
  mailchimp: CountResult | null;
  bird: CountResult | null;
  landing_page: CountOk | null;
}): number {
  let total = 0;
  if (input.mailchimp && isCountOk(input.mailchimp)) total += input.mailchimp.count;
  if (input.bird && isCountOk(input.bird)) total += input.bird.count;
  if (input.landing_page) total += input.landing_page.count;
  return total;
}

// In-memory 60s cache per event. Bounded by natural event cardinality; a Vercel
// worker only ever holds a handful of hot events. Mirrors the LP rate-limiter's
// per-process posture — no Redis until logs show a need.
interface StatsCacheEntry {
  at: number;
  stats: EventSignupStats;
}
const STATS_TTL_MS = 60_000;
const statsCache = new Map<string, StatsCacheEntry>();

interface SendAudienceRow {
  channel: string;
  connection_id: string;
  audience: Record<string, unknown> | null;
}

/**
 * Aggregate signup counts for an event across Mailchimp, Bird and the landing
 * page. The Mailchimp / Bird audience descriptors (tag + audience/list id) are
 * read from the event's scheduled sends, and the connection rows resolve the
 * decrypt-able credentials. Cached in-memory for 60s per event.
 *
 * `supabase` MUST be a service-role client (crosses user_id ownership for the
 * connections + sends reads, and decrypts credentials).
 */
export async function getEventSignupStats(
  supabase: AnySupabaseClient,
  eventId: string,
  options?: { force?: boolean; nowMs?: number },
): Promise<EventSignupStats> {
  const nowMs = options?.nowMs ?? Date.now();
  if (!options?.force) {
    const hit = statsCache.get(eventId);
    if (hit && nowMs - hit.at < STATS_TTL_MS) return hit.stats;
  }

  // Read the event's sends to discover the external audience descriptors.
  const { data: sendsRaw } = await supabase
    .from("d2c_scheduled_sends")
    .select("channel, connection_id, audience")
    .eq("event_id", eventId);
  const sends = (sendsRaw ?? []) as unknown as SendAudienceRow[];

  const mcSend = sends.find(
    (s) =>
      s.channel === "email" &&
      typeof s.audience?.audience_id === "string" &&
      typeof s.audience?.tag === "string",
  );
  const birdSend = sends.find(
    (s) =>
      s.channel === "whatsapp" && typeof s.audience?.tag === "string",
  );

  // Load the connections referenced by those sends.
  const connectionIds = [
    ...new Set(
      [mcSend?.connection_id, birdSend?.connection_id].filter(
        (x): x is string => typeof x === "string",
      ),
    ),
  ];
  const connById = new Map<string, D2CConnection>();
  if (connectionIds.length > 0) {
    const { data: connRows } = await supabase
      .from("d2c_connections")
      .select(
        "id, user_id, client_id, provider, external_account_id, status, last_synced_at, last_error, live_enabled, approved_by_matas, created_at, updated_at",
      )
      .in("id", connectionIds);
    for (const raw of (connRows ?? []) as Array<Record<string, unknown>>) {
      connById.set(raw.id as string, {
        id: raw.id as string,
        user_id: raw.user_id as string,
        client_id: raw.client_id as string,
        provider: raw.provider as D2CConnection["provider"],
        credentials: {},
        external_account_id: (raw.external_account_id as string | null) ?? null,
        status: raw.status as D2CConnection["status"],
        last_synced_at: (raw.last_synced_at as string | null) ?? null,
        last_error: (raw.last_error as string | null) ?? null,
        live_enabled: Boolean(raw.live_enabled),
        approved_by_matas: Boolean(raw.approved_by_matas),
        created_at: raw.created_at as string,
        updated_at: raw.updated_at as string,
      });
    }
  }

  const mcConn = mcSend ? connById.get(mcSend.connection_id) : undefined;
  const birdConn = birdSend ? connById.get(birdSend.connection_id) : undefined;

  const [mailchimp, bird, landing_page] = await Promise.all([
    mcConn && mcSend
      ? countMailchimpMembersByTag(
          supabase,
          mcConn,
          String(mcSend.audience!.audience_id),
          String(mcSend.audience!.tag),
        )
      : Promise.resolve<CountResult | null>(null),
    birdConn && birdSend
      ? countBirdContactsByTag(
          supabase,
          birdConn,
          birdConn.external_account_id ?? "",
          typeof birdSend.audience?.channel_id === "string"
            ? birdSend.audience.channel_id
            : null,
          String(birdSend.audience!.tag),
        )
      : Promise.resolve<CountResult | null>(null),
    countLandingPageSignups(supabase, eventId),
  ]);

  // Surface the LP card only when the event actually has signups OR a landing
  // page; a plain 0 for a D2C-only event is fine to keep (the operator page
  // decides whether to render it based on `landing_page.count`).
  const stats: EventSignupStats = {
    mailchimp,
    bird,
    landing_page,
    total_unique_estimate: sumSignupStats({ mailchimp, bird, landing_page }),
  };

  statsCache.set(eventId, { at: nowMs, stats });
  return stats;
}

/** Test-only cache reset. */
export function _resetD2CStatsCacheForTests(): void {
  statsCache.clear();
}
