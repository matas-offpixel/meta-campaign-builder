/**
 * The ingest plan: what one connector file changes in the E9 ads table
 * (migration 265), worked out against the stored rows before anything is
 * written. Pure: the script reads the rows and writes the plan.
 *
 * Merge, per ad_archive_id:
 *   - first_seen moves back to the earliest day seen, last_seen forward to the
 *     latest (so an older file never pulls last_seen back);
 *   - countries are the union of every read's countries;
 *   - start_date, link_title, snapshot_url and raw come from the newest read
 *     (a read older than last_seen keeps the stored values);
 *   - link_url and cta are never in the connector's response, so a stored value
 *     is kept and nothing else is written there.
 * A row that would not change is left out, so re-ingesting a file is a no-op
 * and a later file changes last_seen only, unless Meta changed the ad.
 *
 * Long runner: last_seen − start_date ≥ 30 days. start_date is Meta's own
 * delivery start; reads are ACTIVE-only, so last_seen is the last day the ad
 * was seen delivering. first_seen is not used: it lags by up to a week (the
 * task reads weekly), and for an ad already running when its page joined the
 * watchlist it misses every day before the first read.
 *
 * Relative imports only.
 */

import { LONG_RUNNER_DAYS, type SeenAd } from "./connector.ts";

export type StoredAd = {
  ad_archive_id: string;
  page_id: string;
  first_seen: string;
  last_seen: string;
  start_date: string | null;
  countries: string[];
  link_url: string | null;
  cta: string | null;
  link_title: string | null;
  snapshot_url: string | null;
  raw: Record<string, unknown>;
};

export type WatchedPage = { pageId: string; name: string; kind: string; active: boolean };

export type AdUpdate = { row: StoredAd; changed: (keyof StoredAd)[] };

export type LongRunner = {
  adArchiveId: string;
  pageId: string;
  startDate: string;
  lastSeen: string;
  liveDays: number;
  linkTitle: string | null;
};

export type OffWatchlist = { ad: SeenAd; reason: "not on the watchlist" | "page inactive" };

export type IngestPlan = {
  seenOn: string;
  inserts: StoredAd[];
  updates: AdUpdate[];
  unchanged: number;
  offWatchlist: OffWatchlist[];
  /** Every ad this file touched (inserted, updated or unchanged) that has run 30 days or more. */
  longRunners: LongRunner[];
};

const COMPARED: (keyof StoredAd)[] = [
  "page_id",
  "first_seen",
  "last_seen",
  "start_date",
  "countries",
  "link_url",
  "cta",
  "link_title",
  "snapshot_url",
  "raw",
];

/** Whole days from a to b, both YYYY-MM-DD. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** JSON with sorted keys, so two equal objects compare equal whatever their key order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function mergeAd(seen: SeenAd, seenOn: string, stored: StoredAd | undefined): StoredAd {
  if (!stored) {
    return {
      ad_archive_id: seen.adArchiveId,
      page_id: seen.pageId,
      first_seen: seenOn,
      last_seen: seenOn,
      start_date: seen.startDate,
      countries: seen.countries,
      link_url: null,
      cta: null,
      link_title: seen.linkTitle,
      snapshot_url: seen.snapshotUrl,
      raw: seen.raw,
    };
  }
  const newest = seenOn >= stored.last_seen;
  return {
    ad_archive_id: stored.ad_archive_id,
    page_id: newest ? seen.pageId : stored.page_id,
    first_seen: seenOn < stored.first_seen ? seenOn : stored.first_seen,
    last_seen: newest ? seenOn : stored.last_seen,
    start_date: newest ? (seen.startDate ?? stored.start_date) : (stored.start_date ?? seen.startDate),
    countries: [...new Set([...stored.countries, ...seen.countries])].sort(),
    link_url: stored.link_url,
    cta: stored.cta,
    link_title: newest ? seen.linkTitle : stored.link_title,
    snapshot_url: newest ? (seen.snapshotUrl ?? stored.snapshot_url) : stored.snapshot_url,
    raw: newest ? seen.raw : stored.raw,
  };
}

export function changedFields(before: StoredAd, after: StoredAd): (keyof StoredAd)[] {
  return COMPARED.filter((key) => canonical(before[key]) !== canonical(after[key]));
}

export function longRunnerOf(row: StoredAd): LongRunner | null {
  if (!row.start_date) return null;
  const liveDays = daysBetween(row.start_date, row.last_seen);
  if (liveDays < LONG_RUNNER_DAYS) return null;
  return {
    adArchiveId: row.ad_archive_id,
    pageId: row.page_id,
    startDate: row.start_date,
    lastSeen: row.last_seen,
    liveDays,
    linkTitle: row.link_title,
  };
}

export function planIngest(args: {
  seen: readonly SeenAd[];
  seenOn: string;
  stored: ReadonlyMap<string, StoredAd>;
  watchlist: ReadonlyMap<string, WatchedPage>;
}): IngestPlan {
  const plan: IngestPlan = { seenOn: args.seenOn, inserts: [], updates: [], unchanged: 0, offWatchlist: [], longRunners: [] };
  for (const ad of args.seen) {
    const page = args.watchlist.get(ad.pageId);
    if (!page) {
      plan.offWatchlist.push({ ad, reason: "not on the watchlist" });
      continue;
    }
    if (!page.active) {
      plan.offWatchlist.push({ ad, reason: "page inactive" });
      continue;
    }
    const stored = args.stored.get(ad.adArchiveId);
    const row = mergeAd(ad, args.seenOn, stored);
    if (!stored) plan.inserts.push(row);
    else {
      const changed = changedFields(stored, row);
      if (changed.length === 0) plan.unchanged += 1;
      else plan.updates.push({ row, changed });
    }
    const long = longRunnerOf(row);
    if (long) plan.longRunners.push(long);
  }
  plan.longRunners.sort((a, b) => b.liveDays - a.liveDays || a.adArchiveId.localeCompare(b.adArchiveId));
  return plan;
}

// ---- The seed (the E9 pages table, migration 265) ----

export const PAGE_KINDS = ["competitor", "promoter", "ticketing", "brand", "artist"] as const;
export type PageKind = (typeof PAGE_KINDS)[number];

export type PageRow = {
  page_id: string;
  name: string;
  kind: PageKind;
  derived_from_page_id: string | null;
  active: boolean;
};

export type SeedFile = { confirmed: boolean; pages: PageRow[] };

/** The seed file's pages, validated: unique numeric ids, a known kind, a parent that is itself a page. */
export function parseSeed(fileText: string, storedPageIds: ReadonlySet<string> = new Set()): SeedFile {
  const root = JSON.parse(fileText) as { confirmed?: unknown; pages?: unknown };
  if (!Array.isArray(root.pages)) throw new Error("pages must be an array");
  const pages: PageRow[] = [];
  const ids = new Set<string>();
  for (const [i, item] of root.pages.entries()) {
    const p = (item ?? {}) as Record<string, unknown>;
    const where = `pages[${i}]`;
    if (typeof p.page_id !== "string" || !/^\d+$/.test(p.page_id)) throw new Error(`${where}.page_id must be a numeric string`);
    if (ids.has(p.page_id)) throw new Error(`${where}: page ${p.page_id} is listed twice`);
    if (typeof p.name !== "string" || !p.name.trim()) throw new Error(`${where}.name is required`);
    if (!PAGE_KINDS.includes(p.kind as PageKind)) throw new Error(`${where}.kind must be one of ${PAGE_KINDS.join(", ")}`);
    const parent = p.derived_from_page_id ?? null;
    if (parent !== null && (typeof parent !== "string" || !/^\d+$/.test(parent))) throw new Error(`${where}.derived_from_page_id must be a numeric string or null`);
    if (parent === p.page_id) throw new Error(`${where} cannot be derived from itself`);
    ids.add(p.page_id);
    pages.push({ page_id: p.page_id, name: p.name.trim(), kind: p.kind as PageKind, derived_from_page_id: parent, active: p.active !== false });
  }
  for (const page of pages) {
    if (page.derived_from_page_id && !ids.has(page.derived_from_page_id) && !storedPageIds.has(page.derived_from_page_id)) {
      throw new Error(`${page.name}: derived_from_page_id ${page.derived_from_page_id} is not a page in the seed or the table`);
    }
  }
  // Parents before the pages derived from them.
  pages.sort((a, b) => Number(a.derived_from_page_id !== null) - Number(b.derived_from_page_id !== null));
  return { confirmed: root.confirmed === true, pages };
}

export type PagePlan = { inserts: PageRow[]; updates: { row: PageRow; changed: (keyof PageRow)[] }[]; unchanged: number };

export function planPages(seed: readonly PageRow[], stored: ReadonlyMap<string, PageRow>): PagePlan {
  const plan: PagePlan = { inserts: [], updates: [], unchanged: 0 };
  for (const row of seed) {
    const prior = stored.get(row.page_id);
    if (!prior) {
      plan.inserts.push(row);
      continue;
    }
    const changed = (["name", "kind", "derived_from_page_id", "active"] as const).filter((k) => prior[k] !== row[k]);
    if (changed.length === 0) plan.unchanged += 1;
    else plan.updates.push({ row, changed: [...changed] });
  }
  return plan;
}
