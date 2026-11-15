/**
 * lib/d2c/stats-ingest/run.ts
 *
 * HE3's ingest run: every active Bird and Mailchimp connection, read
 * once per account, mapped to d2c_broadcast_stats rows, and upserted
 * when `apply` is set. Read-only against Bird and Mailchimp (GETs only,
 * through reader.ts). Archived clients are excluded. Keys are decrypted
 * through the D2C RPC and never logged.
 *
 * Nightly from /api/cron/d2c-metrics-refresh behind
 * ENABLE_D2C_STATS_INGEST === "1" (the last 56 days of sends, whose
 * read / click totals still move); full history from
 * scripts/d2c-stats-backfill.mts.
 *
 * Relative imports only (node --test, and the script).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { loadAllPaged } from "../../db/paged-read.ts";
import { loadArchivedClientIds } from "../../db/client-status.ts";
import { parseMailchimpApiKey } from "../mailchimp/credentials.ts";
import { buildShowIndex, cqListNames, type ShowIndex } from "./attribution.ts";
import {
  birdWindows,
  earliestActivation,
  fetchBirdCampaigns,
  fetchBirdListNames,
  fetchBirdMetrics,
  mapBirdSummary,
} from "./bird.ts";
import {
  fetchMailchimpAccountId,
  fetchMailchimpRecipients,
  fetchMailchimpReports,
  fetchMailchimpSegmentNames,
  mapMailchimpReport,
  segmentIdsOf,
} from "./mailchimp.ts";
import { birdReader, errorLine, mailchimpReader, type StatsReader } from "./reader.ts";
import { upsertStatsRows } from "./store.ts";
import type { D2CShowKey, D2CStatsProvider, D2CStatsRow, D2CStatsSource, D2CStatsSourceSummary } from "./types.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any, any, any>;

export const STATS_INGEST_ENV = "ENABLE_D2C_STATS_INGEST";
export const STATS_CRON_NAME = "d2c-stats-ingest";
/** Nightly look-back: reads and clicks keep landing for weeks after a send. */
export const NIGHTLY_LOOKBACK_DAYS = 56;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Exactly "1"; anything else (unset included) is off. */
export function isStatsIngestEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env[STATS_INGEST_ENV] === "1";
}

/**
 * The once-a-night slot inside the 15-minute d2c-metrics-refresh cron:
 * 04:00–04:14 UTC, after the 02:30–04:00 insight crons.
 */
export function isNightlyStatsSlot(now: Date): boolean {
  return now.getUTCHours() === 4 && now.getUTCMinutes() < 15;
}

export type CredentialLoader = (connectionId: string) => Promise<Record<string, unknown> | null>;

/**
 * Decrypt a connection's credentials through `get_d2c_credentials`
 * (needs D2C_TOKEN_KEY), falling back to the legacy plaintext column as
 * lib/db/d2c.ts does. Never logs the result.
 */
export function rpcCredentialLoader(db: Db, tokenKey: string | undefined = process.env.D2C_TOKEN_KEY): CredentialLoader {
  return async (connectionId) => {
    if (!tokenKey || tokenKey.length < 8) throw new Error("D2C_TOKEN_KEY is not set");
    const { data, error } = await db.rpc("get_d2c_credentials", { p_id: connectionId, p_key: tokenKey });
    if (error) throw new Error("could not decrypt D2C credentials");
    if (data && typeof data === "object" && !Array.isArray(data) && Object.keys(data).length > 0) {
      return data as Record<string, unknown>;
    }
    const legacy = await db.from("d2c_connections").select("credentials").eq("id", connectionId).maybeSingle();
    const creds = (legacy.data as { credentials?: unknown } | null)?.credentials;
    return creds && typeof creds === "object" && Object.keys(creds as object).length > 0
      ? (creds as Record<string, unknown>)
      : null;
  };
}

export interface IngestOptions {
  apply: boolean;
  nowMs?: number;
  /** Bird: read campaigns activated since this time; null = the workspace's whole history. */
  birdSinceMs?: number | null;
  /** Mailchimp: since_send_time; null = every sent campaign. */
  mailchimpSinceIso?: string | null;
  clientId?: string | null;
  provider?: D2CStatsProvider | null;
  /** Local-only sources (env keys), added by the backfill script. */
  extraSources?: D2CStatsSource[];
  /** Skip stored connections (the script's env-only dry run). */
  skipStoredConnections?: boolean;
  loadCredentials?: CredentialLoader;
  readerFor?: (source: D2CStatsSource) => StatsReader;
}

export interface IngestResult {
  ok: boolean;
  applied: boolean;
  sources: D2CStatsSourceSummary[];
  rows: D2CStatsRow[];
  written: number;
  calls: number;
  skippedConnections: Array<{ connectionId: string; reason: string }>;
  error?: string;
}

interface ConnectionRow {
  id: string;
  client_id: string;
  provider: string;
  status: string;
  external_account_id: string | null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * Shows the ingest can attribute to: events with a tag, a code or a
 * CIRQLIN slug, archived clients dropped. An umbrella event
 * (`events.is_umbrella`) is never a show: its CQ lists are the client's
 * whole list (loadWholeListNames).
 */
export async function loadShowKeys(db: Db, archived: ReadonlySet<string>): Promise<D2CShowKey[]> {
  const rows = await loadAllPaged<{
    id: string;
    client_id: string | null;
    event_code: string | null;
    mailchimp_tag: string | null;
    cirqlin_page_slug: string | null;
    mailchimp_audience_id: string | null;
    is_umbrella: boolean | null;
  }>(
    db,
    "events",
    "id, client_id, event_code, mailchimp_tag, cirqlin_page_slug, mailchimp_audience_id, is_umbrella",
    ["id"],
    (q) => q.or("mailchimp_tag.not.is.null,cirqlin_page_slug.not.is.null,event_code.not.is.null"),
  );
  return rows
    .filter((r) => r.client_id && !archived.has(r.client_id) && r.is_umbrella !== true)
    .map((r) => ({
      eventId: r.id,
      clientId: r.client_id!,
      tag: r.mailchimp_tag,
      code: r.event_code,
      slug: r.cirqlin_page_slug,
      mailchimpAudienceId: r.mailchimp_audience_id,
    }));
}

/**
 * Each client's whole-list names: `clients.d2c_whole_list_tags`
 * (migration 248) and the CQ lists of its umbrella events' CIRQLIN pages.
 * Before 248 is applied the column read fails as missing; the tags are
 * then empty (those sends read not tied) and `note` says so.
 */
export async function loadWholeListNames(
  db: Db,
  archived: ReadonlySet<string>,
): Promise<{ names: Map<string, string[]>; note: string | null }> {
  const names = new Map<string, string[]>();
  const add = (clientId: string | null, list: readonly string[]) => {
    if (!clientId || archived.has(clientId) || list.length === 0) return;
    names.set(clientId, [...(names.get(clientId) ?? []), ...list]);
  };
  const umbrellas = await loadAllPaged<{ id: string; client_id: string | null; cirqlin_page_slug: string | null }>(
    db,
    "events",
    "id, client_id, cirqlin_page_slug",
    ["id"],
    (q) => q.eq("is_umbrella", true).not("cirqlin_page_slug", "is", null),
  );
  for (const u of umbrellas) add(u.client_id, cqListNames(u.cirqlin_page_slug));
  let note: string | null = null;
  try {
    const clients = await loadAllPaged<{ id: string; d2c_whole_list_tags: string[] | null }>(
      db,
      "clients",
      "id, d2c_whole_list_tags",
      ["id"],
    );
    for (const c of clients) add(c.id, (c.d2c_whole_list_tags ?? []).filter((t) => typeof t === "string" && t.trim()));
  } catch (err) {
    const line = errorLine(err);
    if (!/d2c_whole_list_tags/.test(line)) throw err;
    note = "clients.d2c_whole_list_tags not readable (migration 248 not applied): no master tags, those sends read not tied";
  }
  return { names, note };
}

/** Mailchimp list id → the one client that owns it (events + clients.mailchimp_audience_id). */
export async function loadListClients(db: Db, archived: ReadonlySet<string>): Promise<Map<string, string>> {
  const owners = new Map<string, Set<string>>();
  const add = (list: string | null, client: string | null) => {
    if (!list || !client || archived.has(client)) return;
    const set = owners.get(list) ?? new Set<string>();
    set.add(client);
    owners.set(list, set);
  };
  const events = await loadAllPaged<{ id: string; client_id: string | null; mailchimp_audience_id: string | null }>(
    db,
    "events",
    "id, client_id, mailchimp_audience_id",
    ["id"],
    (q) => q.not("mailchimp_audience_id", "is", null),
  );
  for (const e of events) add(e.mailchimp_audience_id, e.client_id);
  const clients = await loadAllPaged<{ id: string; mailchimp_audience_id: string | null }>(
    db,
    "clients",
    "id, mailchimp_audience_id",
    ["id"],
    (q) => q.not("mailchimp_audience_id", "is", null),
  );
  for (const c of clients) add(c.mailchimp_audience_id, c.id);
  const out = new Map<string, string>();
  for (const [list, set] of owners) if (set.size === 1) out.set(list, [...set][0]!);
  return out;
}

/** Stored connections → one source per Bird workspace / Mailchimp key. */
async function storedSources(
  db: Db,
  archived: ReadonlySet<string>,
  opts: IngestOptions,
  skipped: IngestResult["skippedConnections"],
): Promise<D2CStatsSource[]> {
  const conns = await loadAllPaged<ConnectionRow>(
    db,
    "d2c_connections",
    "id, client_id, provider, status, external_account_id",
    ["id"],
    (q) => q.in("provider", ["bird", "mailchimp"]).eq("status", "active"),
  );
  const load = opts.loadCredentials ?? rpcCredentialLoader(db);
  const byAccount = new Map<string, D2CStatsSource>();
  for (const c of conns) {
    if (archived.has(c.client_id)) {
      skipped.push({ connectionId: c.id, reason: "archived client" });
      continue;
    }
    if (opts.clientId && c.client_id !== opts.clientId) continue;
    if (opts.provider && c.provider !== opts.provider) continue;
    let creds: Record<string, unknown> | null;
    try {
      creds = await load(c.id);
    } catch (err) {
      skipped.push({ connectionId: c.id, reason: errorLine(err) });
      continue;
    }
    const apiKey = str(creds?.api_key);
    if (!apiKey) {
      skipped.push({ connectionId: c.id, reason: "no api_key in credentials" });
      continue;
    }
    if (c.provider === "bird") {
      const ws = str(creds?.workspace_id) ?? str(c.external_account_id);
      if (!ws) {
        skipped.push({ connectionId: c.id, reason: "no workspace_id" });
        continue;
      }
      mergeSource(byAccount, `bird:${ws}`, { provider: "bird", accountHint: ws, apiKey }, c);
    } else {
      const prefix = str(creds?.server_prefix) ?? parseMailchimpApiKey(apiKey)?.serverPrefix ?? null;
      if (!prefix) {
        skipped.push({ connectionId: c.id, reason: "no server prefix" });
        continue;
      }
      // Grouped by key here; two keys on one account merge on account_id later.
      mergeSource(byAccount, `mailchimp:${prefix}:${c.id}`, { provider: "mailchimp", accountHint: prefix, apiKey, serverPrefix: prefix }, c);
    }
  }
  return [...byAccount.values()];
}

function mergeSource(
  map: Map<string, D2CStatsSource>,
  key: string,
  base: Pick<D2CStatsSource, "provider" | "accountHint" | "apiKey" | "serverPrefix">,
  conn: ConnectionRow,
): void {
  const existing = map.get(key);
  if (existing) {
    if (!existing.clientIds.includes(conn.client_id)) existing.clientIds.push(conn.client_id);
    existing.connectionIds.push(conn.id);
    return;
  }
  map.set(key, { ...base, clientIds: [conn.client_id], connectionIds: [conn.id] });
}

function newSummary(source: D2CStatsSource, accountId: string): D2CStatsSourceSummary {
  return {
    provider: source.provider,
    accountId,
    connectionIds: [...source.connectionIds],
    calls: 0,
    rows: 0,
    byAttribution: { show: 0, client: 0, not_tied: 0, unattributed: 0 },
    byChannel: {},
    ticketHolderRows: 0,
    notes: [],
  };
}

function tally(summary: D2CStatsSourceSummary, rows: readonly D2CStatsRow[]): void {
  summary.rows = rows.length;
  for (const r of rows) {
    summary.byAttribution[r.attribution] += 1;
    summary.byChannel[r.channel] = (summary.byChannel[r.channel] ?? 0) + 1;
    if (r.audience_kind === "ticket_holder") summary.ticketHolderRows += 1;
  }
}

async function ingestBird(
  source: D2CStatsSource,
  reader: StatsReader,
  index: ShowIndex,
  opts: IngestOptions,
  nowMs: number,
): Promise<{ summary: D2CStatsSourceSummary; rows: D2CStatsRow[] }> {
  const ws = source.accountHint;
  const summary = newSummary(source, ws);
  if (source.clientIds.length > 1) summary.notes.push(`workspace shared by ${source.clientIds.length} clients`);
  const campaigns = await fetchBirdCampaigns(reader, ws);
  const sinceMs =
    opts.birdSinceMs === undefined
      ? nowMs - NIGHTLY_LOOKBACK_DAYS * DAY_MS
      : opts.birdSinceMs ?? earliestActivation(campaigns) ?? nowMs - NIGHTLY_LOOKBACK_DAYS * DAY_MS;
  const windows = birdWindows(sinceMs, nowMs);
  const metrics = await fetchBirdMetrics(reader, ws, windows);

  // Cross-check: every campaign activated in the range should have a metrics row.
  const seen = new Set(metrics.map((m) => m.campaignId));
  let missing = 0;
  for (const c of campaigns.values()) {
    const t = c.activatedAt ? Date.parse(c.activatedAt) : NaN;
    if (Number.isFinite(t) && t >= sinceMs && t < nowMs && c.id && !seen.has(c.id)) missing += 1;
  }
  if (missing) summary.notes.push(`${missing} activated campaign(s) had no metrics row`);

  const listIds = new Set<string>();
  for (const m of metrics) {
    const c = m.campaignId ? campaigns.get(m.campaignId) : undefined;
    for (const ref of c?.currentVersion?.recipients?.include ?? []) if (ref.id) listIds.add(ref.id);
    for (const ref of c?.currentVersion?.recipients?.exclude ?? []) if (ref.id) listIds.add(ref.id);
    const g = c?.currentVersion?.audience?.group?.groupId;
    if (g) listIds.add(g);
  }
  const names = await fetchBirdListNames(reader, ws, [...listIds], summary.notes);
  const nowIso = new Date(nowMs).toISOString();
  const rows: D2CStatsRow[] = [];
  for (const m of metrics) {
    const row = mapBirdSummary(m, m.campaignId ? campaigns.get(m.campaignId) : undefined, names, {
      workspaceId: ws,
      accountClientIds: source.clientIds,
      index,
      nowIso,
    });
    if (row) rows.push(row);
  }
  summary.notes.push(`${windows.length} reporting window(s) from ${new Date(sinceMs).toISOString().slice(0, 10)}`);
  return { summary, rows };
}

async function ingestMailchimp(
  source: D2CStatsSource,
  reader: StatsReader,
  accountId: string,
  index: ShowIndex,
  listClients: ReadonlyMap<string, string>,
  opts: IngestOptions,
  nowMs: number,
): Promise<{ summary: D2CStatsSourceSummary; rows: D2CStatsRow[] }> {
  const summary = newSummary(source, accountId);
  if (source.clientIds.length > 1) summary.notes.push(`account shared by ${source.clientIds.length} clients`);
  const since =
    opts.mailchimpSinceIso === undefined
      ? new Date(nowMs - NIGHTLY_LOOKBACK_DAYS * DAY_MS).toISOString()
      : opts.mailchimpSinceIso;
  const reports = await fetchMailchimpReports(reader, since);
  const recipients = await fetchMailchimpRecipients(reader, since);
  const segmentsByList = new Map<string, Set<string>>();
  for (const r of reports) {
    const c = r.id ? recipients.get(r.id) : undefined;
    const listId = r.list_id ?? c?.recipients?.list_id;
    const ids = segmentIdsOf(c);
    if (!listId || ids.length === 0) continue;
    const set = segmentsByList.get(listId) ?? new Set<string>();
    for (const id of ids) set.add(id);
    segmentsByList.set(listId, set);
  }
  const namesByList = new Map<string, Map<string, string>>();
  for (const listId of segmentsByList.keys()) {
    namesByList.set(listId, await fetchMailchimpSegmentNames(reader, listId));
  }
  const nowIso = new Date(nowMs).toISOString();
  const rows: D2CStatsRow[] = [];
  let noFiltered = 0;
  for (const r of reports) {
    const c = r.id ? recipients.get(r.id) : undefined;
    const listId = r.list_id ?? c?.recipients?.list_id ?? "";
    const row = mapMailchimpReport(r, c, namesByList.get(listId) ?? new Map(), {
      accountId,
      accountClientIds: source.clientIds,
      listClientIds: listClients,
      index,
      nowIso,
    });
    if (!row) continue;
    if (row.opens_unique_filtered == null) noFiltered += 1;
    rows.push(row);
  }
  if (noFiltered) summary.notes.push(`${noFiltered} report(s) without a bot-filtered open count (estimated on read)`);
  const missingRecipients = reports.filter((r) => r.id && !recipients.has(r.id)).length;
  if (missingRecipients) summary.notes.push(`${missingRecipients} report(s) with no campaign recipients (client only)`);
  return { summary, rows };
}

export async function runD2CStatsIngest(db: Db, opts: IngestOptions): Promise<IngestResult> {
  const nowMs = opts.nowMs ?? Date.now();
  const result: IngestResult = {
    ok: true,
    applied: false,
    sources: [],
    rows: [],
    written: 0,
    calls: 0,
    skippedConnections: [],
  };
  const archived = await loadArchivedClientIds(db);
  let shows: D2CShowKey[];
  let listClients: Map<string, string>;
  let wholeList: Awaited<ReturnType<typeof loadWholeListNames>>;
  try {
    shows = await loadShowKeys(db, archived);
    listClients = await loadListClients(db, archived);
    wholeList = await loadWholeListNames(db, archived);
  } catch (err) {
    return { ...result, ok: false, error: `show read failed: ${errorLine(err)}` };
  }
  const index = buildShowIndex(shows, wholeList.names);

  const sources: D2CStatsSource[] = [];
  if (!opts.skipStoredConnections) sources.push(...(await storedSources(db, archived, opts, result.skippedConnections)));
  for (const s of opts.extraSources ?? []) {
    if (s.clientIds.some((id) => archived.has(id))) continue;
    if (opts.provider && s.provider !== opts.provider) continue;
    sources.push(s);
  }

  const readerFor =
    opts.readerFor ??
    ((s: D2CStatsSource) => (s.provider === "bird" ? birdReader(s.apiKey) : mailchimpReader(s.serverPrefix ?? s.accountHint, s.apiKey)));

  const fail = (source: D2CStatsSource, reader: StatsReader, err: unknown, extraCalls = 0) => {
    const summary = newSummary(source, source.accountHint);
    summary.calls = reader.calls + extraCalls;
    summary.error = errorLine(err);
    result.sources.push(summary);
    result.ok = false;
  };

  // Group sources by account first, so a shared account's whole-list
  // sends see every client connected to it (and land unattributed),
  // whichever connection is read first.
  const groups = new Map<string, { source: D2CStatsSource; reader: StatsReader; accountId: string; extraCalls: number }>();
  for (const source of sources) {
    const reader = readerFor(source);
    let accountId = source.accountHint;
    if (source.provider === "mailchimp") {
      try {
        accountId = await fetchMailchimpAccountId(reader);
      } catch (err) {
        fail(source, reader, err);
        continue;
      }
    }
    const key = `${source.provider}:${accountId}`;
    const group = groups.get(key);
    if (!group) {
      groups.set(key, { source: { ...source, clientIds: [...source.clientIds], connectionIds: [...source.connectionIds] }, reader, accountId, extraCalls: 0 });
      continue;
    }
    for (const id of source.clientIds) if (!group.source.clientIds.includes(id)) group.source.clientIds.push(id);
    group.source.connectionIds.push(...source.connectionIds);
    group.extraCalls += reader.calls;
  }

  for (const { source, reader, accountId, extraCalls } of groups.values()) {
    try {
      const { summary, rows } =
        source.provider === "bird"
          ? await ingestBird(source, reader, index, opts, nowMs)
          : await ingestMailchimp(source, reader, accountId, index, listClients, opts, nowMs);
      tally(summary, rows);
      if (wholeList.note) summary.notes.push(wholeList.note);
      summary.calls = reader.calls + extraCalls;
      result.sources.push(summary);
      result.rows.push(...rows);
    } catch (err) {
      fail(source, reader, err, extraCalls);
    }
  }

  result.rows = result.rows.filter((r) => !r.client_id || !archived.has(r.client_id));
  result.calls = result.sources.reduce((n, s) => n + s.calls, 0);

  if (opts.apply && result.rows.length > 0) {
    try {
      result.written = await upsertStatsRows(db, result.rows);
      result.applied = true;
    } catch (err) {
      result.ok = false;
      result.error = errorLine(err);
    }
  } else if (opts.apply) {
    result.applied = true;
  }
  return result;
}
