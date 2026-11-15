/**
 * lib/d2c/stats-ingest/bird.ts
 *
 * Bird campaign stats → d2c_broadcast_stats rows. Read-only.
 *
 * Endpoint (found live on the Electric workspace, 15 Nov 2026):
 *
 *   GET /workspaces/{ws}/reporting/campaigns/metrics?periodStart=…&periodEnd=…
 *   → [{ summary: { campaignId, campaignName, campaignActivatedDate,
 *        platformId, sent, delivered, bounced, readOrOpened, clicked,
 *        unsubscribed, … } }]
 *
 *   - The period filters on the campaign's ACTIVATION date and may be at
 *     most 28 days ("periodStart and periodEnd are too far apart").
 *   - The counts are the campaign's running totals, whatever the period:
 *     a one-day window and a 28-day window gave the same numbers.
 *   - The response is a bare array with no paging; `limit` is ignored.
 *     A window's rows matched the campaigns activated in it (9 of 9).
 *   - readOrOpened is WhatsApp read receipts (only recipients with read
 *     receipts on), so it is "read" here. clicked is short-link clicks.
 *
 * The older `/campaigns/{id}/broadcasts/{id}/statistics` probes 422
 * (lib/d2c/metrics/bird.ts); this reporting endpoint is the one with
 * engagement.
 *
 * Audiences come from `GET /workspaces/{ws}/campaigns` (the current
 * version's recipients.include / exclude) and each list's name from
 * `GET /workspaces/{ws}/lists/{id}` (some workspaces 403 on /groups but
 * 200 on /lists, so /lists is asked first and /groups only on a 403 or
 * 404). Only names are read; the bulk list counters are never used.
 */

import { attributeSend, audienceKind, type ShowIndex } from "./attribution.ts";
import { statusOf, type StatsReader } from "./reader.ts";
import type { D2CAudience, D2CAudienceRef, D2CStatsChannel, D2CStatsRow } from "./types.ts";

export const BIRD_MAX_WINDOW_DAYS = 28;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_CAMPAIGN_PAGES = 100;

export interface BirdCampaignSummary {
  campaignId?: string;
  campaignName?: string;
  campaignActivatedDate?: string;
  campaignStatus?: string;
  platformId?: string;
  sent?: number;
  delivered?: number;
  bounced?: number;
  readOrOpened?: number;
  opened?: number;
  clicked?: number;
  unsubscribed?: number;
  skipped?: number;
  queued?: number;
}

interface BirdRecipientRef {
  type?: string;
  id?: string;
}

export interface BirdCampaign {
  id?: string;
  name?: string;
  activatedAt?: string;
  status?: string;
  currentVersion?: {
    audience?: { type?: string; group?: { groupId?: string } } | null;
    recipients?: { include?: BirdRecipientRef[]; exclude?: BirdRecipientRef[] } | null;
    channels?: { platforms?: { platformId?: string; channels?: { id?: string }[] }[] } | null;
  } | null;
}

/** [start, end) windows of at most 28 days covering since → until, oldest first. */
export function birdWindows(sinceMs: number, untilMs: number, days = BIRD_MAX_WINDOW_DAYS): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const step = days * DAY_MS;
  for (let start = sinceMs; start < untilMs; start += step) {
    const end = Math.min(start + step, untilMs);
    out.push([new Date(start).toISOString(), new Date(end).toISOString()]);
  }
  return out;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** A list name exactly as Bird returns it: attribution compares names byte for byte. */
function asStored(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** Every campaign summary activated in the windows, deduped on campaign id (latest read wins). */
export async function fetchBirdMetrics(
  reader: StatsReader,
  workspaceId: string,
  windows: ReadonlyArray<[string, string]>,
): Promise<BirdCampaignSummary[]> {
  const byId = new Map<string, BirdCampaignSummary>();
  for (const [start, end] of windows) {
    const params = new URLSearchParams({ periodStart: start, periodEnd: end });
    const json = await reader.get<unknown>(
      `/workspaces/${workspaceId}/reporting/campaigns/metrics?${params}`,
    );
    const rows = Array.isArray(json) ? json : [];
    for (const row of rows) {
      const summary = (row as { summary?: BirdCampaignSummary })?.summary;
      const id = str(summary?.campaignId);
      if (summary && id) byId.set(id, summary);
    }
  }
  return [...byId.values()];
}

/** Every campaign in the workspace (cursor `pageToken`, never `nextPageToken`). */
export async function fetchBirdCampaigns(
  reader: StatsReader,
  workspaceId: string,
): Promise<Map<string, BirdCampaign>> {
  const out = new Map<string, BirdCampaign>();
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_CAMPAIGN_PAGES; page++) {
    const params = new URLSearchParams({ limit: "100" });
    if (pageToken) params.set("pageToken", pageToken);
    const json = await reader.get<{ results?: BirdCampaign[]; nextPageToken?: string }>(
      `/workspaces/${workspaceId}/campaigns?${params}`,
    );
    const batch = Array.isArray(json?.results) ? json.results : [];
    for (const c of batch) {
      const id = str(c?.id);
      if (id) out.set(id, c);
    }
    const next = json?.nextPageToken;
    if (typeof next !== "string" || !next || batch.length === 0 || next === pageToken) break;
    pageToken = next;
  }
  return out;
}

/** The lists a campaign targets, from its current version. */
export function birdAudience(campaign: BirdCampaign | undefined): D2CAudience | null {
  const version = campaign?.currentVersion;
  if (!version) return null;
  const refs: D2CAudienceRef[] = [];
  let otherConditions = 0;
  const add = (ref: BirdRecipientRef, include: boolean) => {
    const id = str(ref?.id);
    if (!id) return;
    if (ref.type && ref.type !== "group" && ref.type !== "list") {
      // A segment or contact include: no list name to match, so it widens.
      if (include) otherConditions += 1;
      return;
    }
    if (!refs.some((r) => r.id === id && r.include === include)) refs.push({ id, name: null, include });
  };
  for (const ref of version.recipients?.include ?? []) add(ref, true);
  for (const ref of version.recipients?.exclude ?? []) add(ref, false);
  if (refs.length === 0) {
    const groupId = str(version.audience?.group?.groupId);
    if (groupId) refs.push({ id: groupId, name: null, include: true });
  }
  const includes = refs.filter((r) => r.include).length;
  return { mode: "any", wholeList: includes === 0 && otherConditions === 0, refs, otherConditions };
}

/** The channel ids a campaign sends from, as stored (never matched by name). */
export function birdChannelIds(campaign: BirdCampaign | undefined): string[] {
  const ids = new Set<string>();
  for (const p of campaign?.currentVersion?.channels?.platforms ?? []) {
    for (const c of p.channels ?? []) {
      const id = str(c?.id);
      if (id) ids.add(id);
    }
  }
  return [...ids];
}

/**
 * List names for the given ids, /lists first, /groups on a 403 or 404.
 * Notes record which path answered, per workspace.
 */
export async function fetchBirdListNames(
  reader: StatsReader,
  workspaceId: string,
  ids: readonly string[],
  notes: string[],
): Promise<Map<string, string | null>> {
  const names = new Map<string, string | null>();
  let groupsFallback = 0;
  let unreadable = 0;
  for (const id of ids) {
    if (names.has(id)) continue;
    try {
      const list = await reader.get<{ name?: string }>(`/workspaces/${workspaceId}/lists/${id}`);
      names.set(id, asStored(list?.name));
      continue;
    } catch (err) {
      const status = statusOf(err);
      if (status !== 403 && status !== 404) throw err;
    }
    try {
      const group = await reader.get<{ name?: string }>(`/workspaces/${workspaceId}/groups/${id}`);
      names.set(id, asStored(group?.name));
      groupsFallback += 1;
    } catch (err) {
      const status = statusOf(err);
      if (status !== 403 && status !== 404) throw err;
      names.set(id, null);
      unreadable += 1;
    }
  }
  if (groupsFallback) notes.push(`${groupsFallback} list name(s) read from /groups after /lists refused`);
  if (unreadable) notes.push(`${unreadable} list name(s) unreadable on /lists and /groups`);
  return names;
}

function birdChannel(platformId: string | null): D2CStatsChannel | null {
  if (platformId === "whatsapp") return "whatsapp";
  if (platformId === "sms") return "sms";
  if (platformId === "email") return "email";
  return null;
}

/** One summary + its campaign → a row. Null when the platform isn't WhatsApp, SMS or email. */
export function mapBirdSummary(
  summary: BirdCampaignSummary,
  campaign: BirdCampaign | undefined,
  listNames: ReadonlyMap<string, string | null>,
  ctx: { workspaceId: string; accountClientIds: readonly string[]; index: ShowIndex; nowIso: string },
): D2CStatsRow | null {
  const id = str(summary.campaignId);
  const channel = birdChannel(str(summary.platformId));
  if (!id || !channel) return null;
  const base = birdAudience(campaign);
  const audience: D2CAudience | null = base
    ? { ...base, refs: base.refs.map((r) => ({ ...r, name: listNames.get(r.id) ?? null })) }
    : null;
  const who = attributeSend(ctx.index, audience, { accountClientIds: ctx.accountClientIds });
  const channelIds = birdChannelIds(campaign);
  return {
    provider: "bird",
    account_id: ctx.workspaceId,
    external_id: id,
    channel,
    client_id: who.clientId,
    event_id: who.eventId,
    attribution: who.attribution,
    audience_kind: audienceKind(audience),
    name: str(summary.campaignName) ?? str(campaign?.name),
    sent_at: str(summary.campaignActivatedDate) ?? str(campaign?.activatedAt),
    list_id: null,
    channel_ids: channelIds.length ? channelIds : null,
    audience,
    sent: num(summary.sent),
    delivered: num(summary.delivered),
    read: num(summary.readOrOpened),
    clicked: num(summary.clicked),
    opens_unique_raw: null,
    opens_unique_filtered: null,
    open_rate_filtered: null,
    bounces: num(summary.bounced),
    unsubscribes: num(summary.unsubscribed),
    raw: { ...summary },
    fetched_at: ctx.nowIso,
  };
}

/** The earliest activation in the workspace's campaigns, for a full backfill. */
export function earliestActivation(campaigns: ReadonlyMap<string, BirdCampaign>): number | null {
  let min: number | null = null;
  for (const c of campaigns.values()) {
    const t = c.activatedAt ? Date.parse(c.activatedAt) : NaN;
    if (Number.isFinite(t) && (min === null || t < min)) min = t;
  }
  return min;
}
