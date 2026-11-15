/**
 * lib/d2c/stats-ingest/mailchimp.ts
 *
 * Mailchimp campaign reports → d2c_broadcast_stats rows. Read-only.
 *
 *   GET /3.0/?fields=account_id                     (once per account)
 *   GET /3.0/reports?count=1000&offset=…&since_send_time=…
 *   GET /3.0/campaigns?status=sent&count=1000&…     (recipients.segment_opts)
 *   GET /3.0/lists/{id}/segments?count=1000&…       (tag names, per list used)
 *
 * Opens: the report's `opens.proxy_excluded_unique_opens` and
 * `proxy_excluded_open_rate` are Mailchimp's bot-filtered figures
 * (Apple Mail Privacy Protection opens removed). Both are stored when
 * the report gives them; `unique_opens` is stored as the raw count and
 * is never the open rate (lib/d2c/stats-ingest/opens.ts decides what
 * is shown). On Electric's account, 15 Nov 2026, all 370 reports carry
 * the filtered fields; the newest read 3.0 % filtered against 28.7 % raw.
 *
 * Clicks are `unique_subscriber_clicks` (people who clicked), the
 * numerator of Mailchimp's click_rate. Delivered is emails_sent less
 * hard, soft and syntax bounces, as lib/d2c/metrics/mailchimp.ts has it.
 *
 * The audience's default from_name is never read: it is stale on some
 * clients and has no bearing on stats.
 */

import { attributeSend, audienceKind, type ShowIndex } from "./attribution.ts";
import type { StatsReader } from "./reader.ts";
import type { D2CAudience, D2CAudienceRef, D2CStatsRow } from "./types.ts";

const PAGE = 1000;
const MAX_PAGES = 50;

export interface MailchimpReportRow {
  id?: string;
  campaign_title?: string;
  type?: string;
  list_id?: string;
  emails_sent?: number;
  unsubscribed?: number;
  send_time?: string;
  bounces?: { hard_bounces?: number; soft_bounces?: number; syntax_errors?: number };
  opens?: {
    opens_total?: number;
    unique_opens?: number;
    open_rate?: number;
    proxy_excluded_opens?: number;
    proxy_excluded_unique_opens?: number;
    proxy_excluded_open_rate?: number;
  };
  clicks?: {
    clicks_total?: number;
    unique_clicks?: number;
    unique_subscriber_clicks?: number;
    click_rate?: number;
  };
}

interface SegmentCondition {
  condition_type?: string;
  field?: string;
  op?: string;
  value?: unknown;
}

export interface MailchimpCampaignRecipients {
  id?: string;
  recipients?: {
    list_id?: string;
    segment_opts?: {
      saved_segment_id?: number | string;
      match?: string;
      conditions?: SegmentCondition[];
    } | null;
  } | null;
}

const REPORT_FIELDS = [
  "total_items",
  "reports.id",
  "reports.campaign_title",
  "reports.type",
  "reports.list_id",
  "reports.emails_sent",
  "reports.unsubscribed",
  "reports.send_time",
  "reports.bounces",
  "reports.opens",
  "reports.clicks",
].join(",");

const CAMPAIGN_FIELDS = [
  "total_items",
  "campaigns.id",
  "campaigns.recipients.list_id",
  "campaigns.recipients.segment_opts",
].join(",");

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** A segment name exactly as Mailchimp returns it: attribution compares names byte for byte. */
function asStored(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

async function pageMailchimp<T>(
  reader: StatsReader,
  path: string,
  key: string,
  params: Record<string, string>,
): Promise<T[]> {
  const out: T[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const q = new URLSearchParams({ ...params, count: String(PAGE), offset: String(page * PAGE) });
    const json = await reader.get<Record<string, unknown>>(`${path}?${q}`);
    const batch = Array.isArray(json?.[key]) ? (json[key] as T[]) : [];
    out.push(...batch);
    const total = num(json?.total_items);
    if (batch.length < PAGE || (total !== null && out.length >= total)) break;
  }
  return out;
}

export async function fetchMailchimpAccountId(reader: StatsReader): Promise<string> {
  const root = await reader.get<{ account_id?: string }>("/3.0/?fields=account_id");
  const id = str(root?.account_id);
  if (!id) throw new Error("Mailchimp account root returned no account_id");
  return id;
}

export function fetchMailchimpReports(reader: StatsReader, sinceIso: string | null): Promise<MailchimpReportRow[]> {
  const params: Record<string, string> = { fields: REPORT_FIELDS };
  if (sinceIso) params.since_send_time = sinceIso;
  return pageMailchimp<MailchimpReportRow>(reader, "/3.0/reports", "reports", params);
}

export async function fetchMailchimpRecipients(
  reader: StatsReader,
  sinceIso: string | null,
): Promise<Map<string, MailchimpCampaignRecipients>> {
  const params: Record<string, string> = { status: "sent", fields: CAMPAIGN_FIELDS };
  if (sinceIso) params.since_send_time = sinceIso;
  const rows = await pageMailchimp<MailchimpCampaignRecipients>(reader, "/3.0/campaigns", "campaigns", params);
  const out = new Map<string, MailchimpCampaignRecipients>();
  for (const row of rows) {
    const id = str(row?.id);
    if (id) out.set(id, row);
  }
  return out;
}

/** Segment / tag names on one list, by id. */
export async function fetchMailchimpSegmentNames(
  reader: StatsReader,
  listId: string,
): Promise<Map<string, string>> {
  const rows = await pageMailchimp<{ id?: number | string; name?: string }>(
    reader,
    `/3.0/lists/${encodeURIComponent(listId)}/segments`,
    "segments",
    { fields: "total_items,segments.id,segments.name" },
  );
  const out = new Map<string, string>();
  for (const row of rows) {
    const name = asStored(row?.name);
    if (row?.id != null && name) out.set(String(row.id), name);
  }
  return out;
}

/** Segment ids a campaign's conditions name, for the names read. */
export function segmentIdsOf(campaign: MailchimpCampaignRecipients | undefined): string[] {
  const opts = campaign?.recipients?.segment_opts;
  const ids = new Set<string>();
  for (const c of opts?.conditions ?? []) {
    if (c?.condition_type === "StaticSegment" && c.value != null) ids.add(String(c.value));
  }
  if (opts?.saved_segment_id != null && ids.size === 0) ids.add(String(opts.saved_segment_id));
  return [...ids];
}

/** A campaign's audience from its segment_opts. */
export function mailchimpAudience(
  campaign: MailchimpCampaignRecipients | undefined,
  names: ReadonlyMap<string, string>,
): D2CAudience {
  const opts = campaign?.recipients?.segment_opts;
  const conditions = opts?.conditions ?? [];
  const mode: "any" | "all" = opts?.match === "all" ? "all" : "any";
  const refs: D2CAudienceRef[] = [];
  let otherConditions = 0;
  for (const c of conditions) {
    if (c?.condition_type === "StaticSegment" && c.value != null) {
      const id = String(c.value);
      const include = c.op !== "static_not";
      refs.push({ id, name: names.get(id) ?? null, include });
      // "Everyone NOT tagged X" widens a match-any union.
      if (!include && mode === "any") otherConditions += 1;
    } else if (mode === "any") {
      otherConditions += 1;
    }
  }
  if (conditions.length === 0 && opts?.saved_segment_id != null) {
    const id = String(opts.saved_segment_id);
    refs.push({ id, name: names.get(id) ?? null, include: true });
  }
  const wholeList = refs.filter((r) => r.include).length === 0 && otherConditions === 0;
  return { mode, wholeList, refs, otherConditions };
}

/** One report + its campaign's recipients → a row. */
export function mapMailchimpReport(
  report: MailchimpReportRow,
  campaign: MailchimpCampaignRecipients | undefined,
  names: ReadonlyMap<string, string>,
  ctx: {
    accountId: string;
    accountClientIds: readonly string[];
    listClientIds: ReadonlyMap<string, string>;
    index: ShowIndex;
    nowIso: string;
  },
): D2CStatsRow | null {
  const id = str(report.id);
  if (!id) return null;
  const listId = str(report.list_id) ?? str(campaign?.recipients?.list_id);
  const audience = campaign ? mailchimpAudience(campaign, names) : null;
  const who = attributeSend(ctx.index, audience, {
    accountClientIds: ctx.accountClientIds,
    listClientId: listId ? ctx.listClientIds.get(listId) ?? null : null,
    mailchimpListId: listId,
  });
  const sent = num(report.emails_sent);
  const b = report.bounces;
  const bounces = b ? (num(b.hard_bounces) ?? 0) + (num(b.soft_bounces) ?? 0) + (num(b.syntax_errors) ?? 0) : null;
  const delivered = sent === null ? null : Math.max(0, sent - (bounces ?? 0));
  const o = report.opens;
  return {
    provider: "mailchimp",
    account_id: ctx.accountId,
    external_id: id,
    channel: "email",
    client_id: who.clientId,
    event_id: who.eventId,
    attribution: who.attribution,
    audience_kind: audienceKind(audience),
    name: str(report.campaign_title),
    sent_at: str(report.send_time),
    list_id: listId,
    channel_ids: null,
    audience,
    sent,
    delivered,
    read: null,
    clicked: num(report.clicks?.unique_subscriber_clicks) ?? num(report.clicks?.unique_clicks),
    opens_unique_raw: num(o?.unique_opens),
    opens_unique_filtered: num(o?.proxy_excluded_unique_opens),
    open_rate_filtered: num(o?.proxy_excluded_open_rate),
    bounces,
    unsubscribes: num(report.unsubscribed),
    raw: {
      type: report.type ?? null,
      emails_sent: report.emails_sent ?? null,
      bounces: report.bounces ?? null,
      opens: report.opens ?? null,
      clicks: report.clicks ?? null,
      unsubscribed: report.unsubscribed ?? null,
    },
    fetched_at: ctx.nowIso,
  };
}
