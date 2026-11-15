/**
 * lib/audience-breakdowns/read.ts
 *
 * Server read helpers for E1 "Who we reached" (dashboard v2 phase 2, HE1):
 * the platforms' own audience figures for a show, a venue or a client.
 * Read-only; no UI here. "Meta says" — these are Meta's and TikTok's
 * modelled audiences, never blended with the first-party CIRQLIN figures
 * (HE2).
 *
 * A row counts for a show when today's campaign_event_overrides row names
 * that show, else when it was stored against that show (the writer used
 * the dashboard's rule). Every read pages in primary-key order and dedupes
 * (lib/db/paged-read.ts). The caller's client decides what's visible: the
 * owner's session (RLS), or the service role scoped by client id.
 *
 * Relative imports only: the `node --test` runner can't resolve `@/`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { loadCampaignOverrides } from "../attribution/campaign-owner.ts";
import { loadAllPaged, type PagedQuery } from "../db/paged-read.ts";
import { rowBelongsTo } from "./attribution.ts";
import { OUTSIDE_UK, UNKNOWN } from "./tiktok.ts";

type Db = Pick<SupabaseClient, "from">;

const IN_CHUNK = 100;

export type BreakdownPeriod = { since?: string; until?: string };

export type MetaStoredRow = {
  meta_campaign_id: string;
  date: string;
  breakdown: "age_gender" | "region";
  age: string;
  gender: string;
  region: string;
  event_id: string | null;
  campaign_name: string | null;
  spend: number | string;
  impressions: number | string;
  clicks: number | string;
  link_clicks: number | string;
  registrations: number | string;
  purchases: number | string;
  purchase_value: number | string;
};

export type TikTokStoredRow = {
  tiktok_campaign_id: string;
  date: string;
  breakdown: "age_gender" | "nation";
  age: string;
  gender: string;
  nation: string;
  event_id: string | null;
  campaign_name: string | null;
  spend: number | string;
  impressions: number | string;
  clicks: number | string;
};

const META_COLUMNS =
  "meta_campaign_id,date,breakdown,age,gender,region,event_id,campaign_name,spend,impressions,clicks,link_clicks,registrations,purchases,purchase_value";
const META_KEYS = ["meta_campaign_id", "date", "breakdown", "age", "gender", "region"] as const;
const TIKTOK_COLUMNS = "tiktok_campaign_id,date,breakdown,age,gender,nation,event_id,campaign_name,spend,impressions,clicks";
const TIKTOK_KEYS = ["tiktok_campaign_id", "date", "breakdown", "age", "gender", "nation"] as const;

const n = (v: unknown): number => {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
};

/** A Meta segment's figures, as E1's "Meta results by age" table reads them. */
export type MetaSegmentFigures = {
  segment: string;
  spend: number;
  impressions: number;
  /** This segment's impressions ÷ the breakdown's total. 0..1. */
  impressionShare: number | null;
  clicks: number;
  linkClicks: number;
  /** Link clicks ÷ impressions. 0..1. */
  ctr: number | null;
  /** Complete registrations. */
  signups: number;
  costPerSignup: number | null;
  purchases: number;
  costPerPurchase: number | null;
  revenue: number;
};

/**
 * A Meta region's figures. No results: Meta's insights return no
 * conversions under breakdowns=region (measured 15 Nov 2026 on
 * NX26-LOCKLEAD: £1,569 of spend, 500 signups by age, 0 by region), so
 * the region table never shows signups or purchases, rather than zeros.
 */
export type MetaRegionFigures = Pick<MetaSegmentFigures, "segment" | "spend" | "impressions" | "impressionShare" | "clicks" | "linkClicks" | "ctr">;

export type TikTokSegmentFigures = {
  segment: string;
  spend: number;
  impressions: number;
  impressionShare: number | null;
  clicks: number;
  /** Clicks ÷ impressions. 0..1. */
  ctr: number | null;
};

export type MetaAudience = {
  byAge: MetaSegmentFigures[];
  byGender: MetaSegmentFigures[];
  /** "25-34 · female" etc. */
  byAgeGender: MetaSegmentFigures[];
  /** By spend, largest first. Delivery only (see MetaRegionFigures). */
  byRegion: MetaRegionFigures[];
  /** The age+gender read's total; the region read's total can differ by Meta's rounding. */
  total: MetaSegmentFigures;
  firstDay: string | null;
  lastDay: string | null;
  campaigns: number;
};

export type TikTokAudience = {
  byAge: TikTokSegmentFigures[];
  byGender: TikTokSegmentFigures[];
  byAgeGender: TikTokSegmentFigures[];
  /** England, Scotland, Wales, Northern Ireland, Outside the UK, Unknown: fixed order, only those with delivery. */
  byNation: TikTokSegmentFigures[];
  total: TikTokSegmentFigures;
  firstDay: string | null;
  lastDay: string | null;
  campaigns: number;
};

export type AudienceBreakdowns = {
  meta: MetaAudience;
  tiktok: TikTokAudience;
};

type MetaSums = { spend: number; impressions: number; clicks: number; linkClicks: number; signups: number; purchases: number; revenue: number };
type TikTokSums = { spend: number; impressions: number; clicks: number };

const ratio = (a: number, b: number): number | null => (b > 0 ? a / b : null);
const cost = (spend: number, results: number): number | null => (results > 0 ? spend / results : null);
const round2 = (x: number) => Math.round(x * 100) / 100;

function metaFigures(segment: string, s: MetaSums, totalImpressions: number): MetaSegmentFigures {
  return {
    segment,
    spend: round2(s.spend),
    impressions: s.impressions,
    impressionShare: ratio(s.impressions, totalImpressions),
    clicks: s.clicks,
    linkClicks: s.linkClicks,
    ctr: ratio(s.linkClicks, s.impressions),
    signups: s.signups,
    costPerSignup: cost(s.spend, s.signups),
    purchases: s.purchases,
    costPerPurchase: cost(s.spend, s.purchases),
    revenue: round2(s.revenue),
  };
}

function tiktokFigures(segment: string, s: TikTokSums, totalImpressions: number): TikTokSegmentFigures {
  return {
    segment,
    spend: round2(s.spend),
    impressions: s.impressions,
    impressionShare: ratio(s.impressions, totalImpressions),
    clicks: s.clicks,
    ctr: ratio(s.clicks, s.impressions),
  };
}

/** "18-24" < "25-34" < … < "65+" < anything without a number ("unknown", "Unknown"). */
export function compareAge(a: string, b: string): number {
  const start = (x: string) => {
    const m = /^(\d+)/.exec(x);
    return m ? Number(m[1]) : Number.POSITIVE_INFINITY;
  };
  return start(a) - start(b) || a.localeCompare(b);
}

const GENDER_ORDER = ["female", "male", "unknown"];
export function compareGender(a: string, b: string): number {
  const i = (g: string) => {
    const k = GENDER_ORDER.indexOf(g.toLowerCase());
    return k < 0 ? GENDER_ORDER.length : k;
  };
  return i(a) - i(b) || a.localeCompare(b);
}

// Written out: Object.values on numeric-string keys would order them by GeoNames id (Wales first).
export const NATION_ORDER = ["England", "Scotland", "Wales", "Northern Ireland", OUTSIDE_UK, UNKNOWN];

function add<T extends Record<string, number>>(into: Map<string, T>, key: string, zero: () => T, row: T): void {
  const s = into.get(key) ?? zero();
  for (const k of Object.keys(row) as (keyof T)[]) (s[k] as number) += row[k] as number;
  into.set(key, s);
}

const metaZero = (): MetaSums => ({ spend: 0, impressions: 0, clicks: 0, linkClicks: 0, signups: 0, purchases: 0, revenue: 0 });
const tiktokZero = (): TikTokSums => ({ spend: 0, impressions: 0, clicks: 0 });

function span(days: readonly string[]): { firstDay: string | null; lastDay: string | null } {
  if (!days.length) return { firstDay: null, lastDay: null };
  const sorted = [...days].sort();
  return { firstDay: sorted[0]!, lastDay: sorted[sorted.length - 1]! };
}

/** E1's Meta table from stored rows. Pure. */
export function summariseMeta(rows: readonly MetaStoredRow[]): MetaAudience {
  const age = new Map<string, MetaSums>();
  const gender = new Map<string, MetaSums>();
  const ageGender = new Map<string, MetaSums>();
  const region = new Map<string, MetaSums>();
  const total = metaZero();
  const regionTotal = metaZero();
  for (const r of rows) {
    const s: MetaSums = {
      spend: n(r.spend),
      impressions: n(r.impressions),
      clicks: n(r.clicks),
      linkClicks: n(r.link_clicks),
      signups: n(r.registrations),
      purchases: n(r.purchases),
      revenue: n(r.purchase_value),
    };
    if (r.breakdown === "age_gender") {
      add(age, r.age, metaZero, s);
      add(gender, r.gender, metaZero, s);
      add(ageGender, `${r.age} · ${r.gender}`, metaZero, s);
      for (const k of Object.keys(s) as (keyof MetaSums)[]) total[k] += s[k];
    } else {
      add(region, r.region, metaZero, s);
      regionTotal.impressions += s.impressions;
    }
  }
  const ageGenderKeys = [...ageGender.keys()].sort((a, b) => {
    const [aa, ag] = a.split(" · ");
    const [ba, bg] = b.split(" · ");
    return compareAge(aa!, ba!) || compareGender(ag!, bg!);
  });
  return {
    byAge: [...age.keys()].sort(compareAge).map((k) => metaFigures(k, age.get(k)!, total.impressions)),
    byGender: [...gender.keys()].sort(compareGender).map((k) => metaFigures(k, gender.get(k)!, total.impressions)),
    byAgeGender: ageGenderKeys.map((k) => metaFigures(k, ageGender.get(k)!, total.impressions)),
    byRegion: [...region.entries()]
      .map(([k, s]): MetaRegionFigures => {
        const f = metaFigures(k, s, regionTotal.impressions);
        return { segment: f.segment, spend: f.spend, impressions: f.impressions, impressionShare: f.impressionShare, clicks: f.clicks, linkClicks: f.linkClicks, ctr: f.ctr };
      })
      .sort((a, b) => b.spend - a.spend || a.segment.localeCompare(b.segment)),
    total: metaFigures("All", total, total.impressions),
    ...span(rows.map((r) => r.date)),
    campaigns: new Set(rows.map((r) => r.meta_campaign_id)).size,
  };
}

/** E1's TikTok table from stored rows. Pure. */
export function summariseTikTok(rows: readonly TikTokStoredRow[]): TikTokAudience {
  const age = new Map<string, TikTokSums>();
  const gender = new Map<string, TikTokSums>();
  const ageGender = new Map<string, TikTokSums>();
  const nation = new Map<string, TikTokSums>();
  const total = tiktokZero();
  let nationImpressions = 0;
  for (const r of rows) {
    const s: TikTokSums = { spend: n(r.spend), impressions: n(r.impressions), clicks: n(r.clicks) };
    if (r.breakdown === "age_gender") {
      add(age, r.age, tiktokZero, s);
      add(gender, r.gender, tiktokZero, s);
      add(ageGender, `${r.age} · ${r.gender}`, tiktokZero, s);
      total.spend += s.spend;
      total.impressions += s.impressions;
      total.clicks += s.clicks;
    } else {
      add(nation, r.nation, tiktokZero, s);
      nationImpressions += s.impressions;
    }
  }
  const ageGenderKeys = [...ageGender.keys()].sort((a, b) => {
    const [aa, ag] = a.split(" · ");
    const [ba, bg] = b.split(" · ");
    return compareAge(aa!, ba!) || compareGender(ag!, bg!);
  });
  const nationIndex = (x: string) => {
    const i = NATION_ORDER.indexOf(x);
    return i < 0 ? NATION_ORDER.length : i;
  };
  return {
    byAge: [...age.keys()].sort(compareAge).map((k) => tiktokFigures(k, age.get(k)!, total.impressions)),
    byGender: [...gender.keys()].sort(compareGender).map((k) => tiktokFigures(k, gender.get(k)!, total.impressions)),
    byAgeGender: ageGenderKeys.map((k) => tiktokFigures(k, ageGender.get(k)!, total.impressions)),
    byNation: [...nation.keys()]
      .sort((a, b) => nationIndex(a) - nationIndex(b) || a.localeCompare(b))
      .map((k) => tiktokFigures(k, nation.get(k)!, nationImpressions)),
    total: tiktokFigures("All", total, total.impressions),
    ...span(rows.map((r) => r.date)),
    campaigns: new Set(rows.map((r) => r.tiktok_campaign_id)).size,
  };
}

function inPeriod(q: PagedQuery, period: BreakdownPeriod): PagedQuery {
  let out = q;
  if (period.since) out = out.gte("date", period.since);
  if (period.until) out = out.lte("date", period.until);
  return out;
}

async function chunked<T>(ids: readonly string[], read: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) out.push(...(await read(ids.slice(i, i + IN_CHUNK))));
  return out;
}

/** Missing table (migration 245 not applied) reads as no rows. */
export function isMissingBreakdownsTable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /(meta|tiktok)_audience_breakdowns/.test(message) && /(does not exist|schema cache|not find)/i.test(message);
}

async function orEmpty<T>(read: () => Promise<T[]>): Promise<T[]> {
  try {
    return await read();
  } catch (error) {
    if (isMissingBreakdownsTable(error)) return [];
    throw error;
  }
}

/**
 * Stored rows that belong to any of `eventIds` by today's rule: rows stored
 * against them, plus rows of campaigns an override points at them; then
 * every row is checked against today's overrides. Pure apart from the reads.
 */
async function rowsFor<T extends { event_id: string | null }>(
  db: Db,
  table: string,
  columns: string,
  keys: readonly string[],
  campaignColumn: string,
  overrides: ReadonlyMap<string, string>,
  eventIds: readonly string[],
  period: BreakdownPeriod,
): Promise<T[]> {
  const wanted = new Set(eventIds);
  const overridden = [...overrides].filter(([, e]) => wanted.has(e)).map(([c]) => c);
  const [stored, moved] = await Promise.all([
    chunked(eventIds, (chunk) => orEmpty(() => loadAllPaged<T>(db, table, columns, keys, (q) => inPeriod(q.in("event_id", chunk), period)))),
    chunked(overridden, (chunk) => orEmpty(() => loadAllPaged<T>(db, table, columns, keys, (q) => inPeriod(q.in(campaignColumn, chunk), period)))),
  ]);
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of [...stored, ...moved]) {
    const r = row as unknown as Record<string, unknown>;
    const key = keys.map((k) => String(r[k] ?? "")).join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    const campaignId = String(r[campaignColumn] ?? "");
    if (eventIds.some((id) => rowBelongsTo(id, { campaignId, storedEventId: row.event_id }, overrides))) out.push(row);
  }
  return out;
}

export async function loadMetaBreakdownRows(db: Db, eventIds: readonly string[], period: BreakdownPeriod = {}): Promise<MetaStoredRow[]> {
  if (!eventIds.length) return [];
  const overrides = await loadCampaignOverrides(db, "meta");
  return rowsFor<MetaStoredRow>(db, "meta_audience_breakdowns", META_COLUMNS, META_KEYS, "meta_campaign_id", overrides, eventIds, period);
}

export async function loadTikTokBreakdownRows(db: Db, eventIds: readonly string[], period: BreakdownPeriod = {}): Promise<TikTokStoredRow[]> {
  if (!eventIds.length) return [];
  const overrides = await loadCampaignOverrides(db, "tiktok");
  return rowsFor<TikTokStoredRow>(db, "tiktok_audience_breakdowns", TIKTOK_COLUMNS, TIKTOK_KEYS, "tiktok_campaign_id", overrides, eventIds, period);
}

/** Both platforms for a set of shows. */
export async function audienceBreakdownsForEvents(db: Db, eventIds: readonly string[], period: BreakdownPeriod = {}): Promise<AudienceBreakdowns> {
  const [meta, tiktok] = await Promise.all([loadMetaBreakdownRows(db, eventIds, period), loadTikTokBreakdownRows(db, eventIds, period)]);
  return { meta: summariseMeta(meta), tiktok: summariseTikTok(tiktok) };
}

/** One show. */
export function audienceBreakdownsForShow(db: Db, eventId: string, period: BreakdownPeriod = {}): Promise<AudienceBreakdowns> {
  return audienceBreakdownsForEvents(db, [eventId], period);
}

async function clientEventIds(db: Db, clientId: string, venueKey?: string | null): Promise<string[]> {
  const rows = await loadAllPaged<{ id: string; venue_key: string | null }>(db, "events", "id,venue_key", ["id"], (q) => q.eq("client_id", clientId));
  return rows.filter((r) => venueKey === undefined || (r.venue_key ?? null) === venueKey).map((r) => r.id);
}

/**
 * One venue of a client: its shows by events.venue_key exactly as stored
 * (lib/dashboard/sales-calc/scope.ts). `null` is the client's "Venue not
 * set" shows.
 */
export async function audienceBreakdownsForVenue(db: Db, clientId: string, venueKey: string | null, period: BreakdownPeriod = {}): Promise<AudienceBreakdowns> {
  return audienceBreakdownsForEvents(db, await clientEventIds(db, clientId, venueKey), period);
}

/** Every show of a client. An explicit client id reads it even when archived (CLAUDE.md, Archived clients). */
export async function audienceBreakdownsForClient(db: Db, clientId: string, period: BreakdownPeriod = {}): Promise<AudienceBreakdowns> {
  return audienceBreakdownsForEvents(db, await clientEventIds(db, clientId), period);
}
