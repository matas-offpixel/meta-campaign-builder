/**
 * Genre rows in shadow (design record 2026-11-16-genre-key.html, GK3, GK7).
 *
 * Each night learning-refresh builds genre rows for three jobs from the
 * events' confirmed `genre_family` (migration 253): tag_performance,
 * copy_performance and copy_features. Funnel benchmarks and interest live
 * evidence get none (the audit's proposal: pixel-wide purchases, and an
 * audience's genre is not the show's).
 *
 * A genre row is built the way the job's own rows are, with the genre in the
 * client's place (tags: the genre's own baseline, as a client row has) or the
 * vertical's (copy: the event-relative index against the whole library's
 * baselines). A genre row needs at least 3 shows to count at all (GK7).
 *
 * Then the audit's control (docs/session-logs/genre-learnings-audit-2026-11-15.md
 * §3): the share of non-thin genre/all pairs that sit on opposite sides of 1,
 * against the same share after shuffling the family labels across the same
 * events (family sizes kept). A family's pool is on for a job only when it
 * has 5 or more shows across 2 or more clients AND the real grouping beats
 * 90 % or more of the shuffles.
 *
 * Nothing here is written to a learning table and no reader reads it. The
 * runner keeps the status per job on its cron run (`cron_runs.detail.genre`),
 * and the one place it shows is the operator status line on the
 * learning-refresh report (/admin/cron-health). Shuffle percentages appear
 * only there (GK3).
 *
 * Pure apart from `loadGenreFamilies`. Relative imports only.
 */

import { featureAds } from "../copy-features.ts";
import type { CopyLibrary } from "../copy-performance.ts";
import { parseFeatureKey } from "../copy/features.ts";
import { COPY_SHRINK_K, scoreTemplates, type CopyPerformanceRow, type ScoreAd } from "../copy/score.ts";
import type { CreativeTag, LearningClient, LearningFact } from "../joins.ts";
import { loadAllPaged, type PagedQuery } from "../paged-read.ts";
import type { Confidence } from "../shrink.ts";
import { computeTagPerformance, TAG_WINDOW_DAYS, windowStart, type TagPerformanceRow } from "../tag-performance.ts";
import { isGenrePoolKey, GENRE_POOL_KEYS, type GenrePoolKey } from "./families.ts";
import {
  GENRE_POOL_MIN_BEATS,
  GENRE_POOL_MIN_CLIENTS,
  GENRE_POOL_MIN_SHOWS,
  type GenreFamilyCount,
  type GenreJob,
  type GenreRunDetail,
} from "./status-lines.ts";

export {
  GENRE_JOBS,
  GENRE_POOL_MIN_BEATS,
  GENRE_POOL_MIN_CLIENTS,
  GENRE_POOL_MIN_SHOWS,
  beatsPercent,
  genreStatusLines,
  genreStatusLinesFromDetail,
  type GenreFamilyCount,
  type GenreJob,
  type GenreRunDetail,
} from "./status-lines.ts";

// ─── Rules ───────────────────────────────────────────────────────────────────

/** GK7: a genre row needs at least 3 shows to count at all. */
export const GENRE_ROW_MIN_SHOWS = 3;
/** Shuffles per job per night. */
export const GENRE_SHUFFLES = 100;
/** Wall clock a job's shuffles may take before the run stops shuffling and scores what it has. */
export const GENRE_SHUFFLE_BUDGET_MS = 40_000;


// ─── Loading ─────────────────────────────────────────────────────────────────

type Db = Parameters<typeof loadAllPaged>[0];

export type GenreFamilies = {
  /** False when the column couldn't be read (migration 253 not applied). */
  read: boolean;
  /** event id → family, the nine pooling families only. "No single genre" and Not set join none. */
  byEvent: Map<string, GenrePoolKey>;
  error?: string;
};

/**
 * Events with a confirmed family. Reads `events.genre_family` alone, so a
 * database without migration 253 fails this read and nothing else.
 */
export async function loadGenreFamilies(db: Db, archivedClientIds: ReadonlySet<string>): Promise<GenreFamilies> {
  try {
    const rows = await loadAllPaged<{ id: string; client_id: string | null; genre_family: string | null }>(
      db,
      "events",
      "id, client_id, genre_family",
      ["id"],
      (q: PagedQuery) => q.not("genre_family", "is", null),
    );
    const byEvent = new Map<string, GenrePoolKey>();
    for (const row of rows) {
      if (row.client_id && archivedClientIds.has(row.client_id)) continue;
      if (isGenrePoolKey(row.genre_family)) byEvent.set(row.id, row.genre_family);
    }
    return { read: true, byEvent };
  } catch (err) {
    return { read: false, byEvent: new Map(), error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── The control ─────────────────────────────────────────────────────────────

/** One side of a genre/all pair: what the separation test needs. */
export type PairRow = { key: string; index: number | null; confidence: Confidence; eventsN: number };

/** The audit's rule: opposite sides of 1 (≤ 0.9 against ≥ 1.1), or 0.3 apart across 1. */
export function separates(genre: number, all: number): boolean {
  return (
    (genre <= 0.9 && all >= 1.1) ||
    (genre >= 1.1 && all <= 0.9) ||
    (genre <= 0.9 && all >= 1.0 && all - genre >= 0.3) ||
    (genre >= 1.1 && all <= 1.0 && genre - all >= 0.3)
  );
}

/** GK7 at genre scope: a genre row with fewer than 3 shows doesn't count. */
export function genreRowCounts(row: PairRow): boolean {
  return row.confidence !== "thin" && row.eventsN >= GENRE_ROW_MIN_SHOWS && row.index != null;
}

export function separationRate(genreRows: readonly PairRow[], allRows: ReadonlyMap<string, PairRow>): { pairs: number; separating: number; rate: number } {
  let pairs = 0;
  let separating = 0;
  for (const row of genreRows) {
    if (!genreRowCounts(row)) continue;
    const all = allRows.get(row.key);
    if (!all || all.confidence === "thin" || all.index == null) continue;
    pairs += 1;
    if (separates(row.index!, all.index)) separating += 1;
  }
  return { pairs, separating, rate: pairs ? separating / pairs : 0 };
}

/** Deterministic, so a night's run can be repeated by hand. */
export function shuffler(seed = 7): <T>(items: readonly T[]) => T[] {
  let state = seed;
  const next = () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648;
  return <T>(items: readonly T[]) => {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(next() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
}

// ─── Per job ─────────────────────────────────────────────────────────────────

export type GenreJobStatus = {
  job: GenreJob;
  /** Families with at least one show in the job's data, leading family first. */
  families: GenreFamilyCount[];
  /** Real grouping: genre/all pairs counted and how many separate. */
  pairs: number;
  separating: number;
  /** Shuffles run (fewer than GENRE_SHUFFLES when the time budget ran out). */
  shuffles: number;
  /** Share of shuffles the real grouping beats (0–1). Null when it couldn't be tested. */
  beats: number | null;
  /** Families whose pool is on for this job. */
  on: GenrePoolKey[];
  /** Genre rows built (GK7 floor not applied). Not stored. */
  genreRows: number;
};

type JobData = {
  /** event id → { show, client } for the job's events that have a family. */
  events: Map<string, { showId: string; clientId: string }>;
  /** The confirmed families. */
  families: ReadonlyMap<string, GenrePoolKey>;
  /** Genre rows for a labelling of those events. */
  rowsFor: (labels: ReadonlyMap<string, GenrePoolKey>) => PairRow[];
  allRows: ReadonlyMap<string, PairRow>;
};

function familyCounts(events: JobData["events"], labels: ReadonlyMap<string, GenrePoolKey>): GenreFamilyCount[] {
  const shows = new Map<GenrePoolKey, Set<string>>();
  const clients = new Map<GenrePoolKey, Set<string>>();
  for (const [eventId, { showId, clientId }] of events) {
    const family = labels.get(eventId);
    if (!family) continue;
    (shows.get(family) ?? shows.set(family, new Set()).get(family)!).add(showId);
    (clients.get(family) ?? clients.set(family, new Set()).get(family)!).add(clientId);
  }
  return GENRE_POOL_KEYS.filter((family) => shows.has(family))
    .map((family) => ({ family, shows: shows.get(family)!.size, clients: clients.get(family)!.size }))
    .sort((a, b) => b.shows - a.shows || b.clients - a.clients || GENRE_POOL_KEYS.indexOf(a.family) - GENRE_POOL_KEYS.indexOf(b.family));
}

export function poolIsOn(count: GenreFamilyCount, beats: number | null): boolean {
  return count.shows >= GENRE_POOL_MIN_SHOWS && count.clients >= GENRE_POOL_MIN_CLIENTS && beats != null && beats >= GENRE_POOL_MIN_BEATS;
}

function runControl(
  job: GenreJob,
  data: JobData,
  opts: { shuffles?: number; budgetMs?: number; clock?: () => number; seed?: number },
): GenreJobStatus {
  const ids = [...data.events.keys()];
  const labels = new Map(ids.map((id) => [id, data.families.get(id)!]));
  const real = data.rowsFor(labels);
  const realRate = separationRate(real, data.allRows);
  const families = familyCounts(data.events, labels);
  // Shuffling one family's labels changes nothing, and a run with no pairs has nothing to beat.
  const testable = families.length >= 2 && realRate.pairs > 0;
  const total = opts.shuffles ?? GENRE_SHUFFLES;
  const clock = opts.clock ?? Date.now;
  const started = clock();
  const shuffle = shuffler(opts.seed);
  const values = ids.map((id) => labels.get(id)!);
  let ran = 0;
  let beaten = 0;
  if (testable) {
    for (; ran < total; ran += 1) {
      if (ran > 0 && clock() - started > (opts.budgetMs ?? GENRE_SHUFFLE_BUDGET_MS)) break;
      const shuffled = shuffle(values);
      const rate = separationRate(data.rowsFor(new Map(ids.map((id, at) => [id, shuffled[at]]))), data.allRows).rate;
      if (rate < realRate.rate) beaten += 1;
    }
  }
  const beats = testable && ran > 0 ? beaten / ran : null;
  return {
    job,
    families,
    pairs: realRate.pairs,
    separating: realRate.separating,
    shuffles: ran,
    beats,
    on: families.filter((count) => poolIsOn(count, beats)).map((count) => count.family),
    genreRows: real.length,
  };
}

// ─── tag_performance ─────────────────────────────────────────────────────────

const GENRE_CLIENT_PREFIX = "genre:";

/**
 * Genre rows for tag_performance: each fact on an event with a family takes
 * the family as its client (no vertical), so the client-scope rows that come
 * back are genre rows with the genre's own baseline.
 */
export function tagGenreRows(
  facts: readonly LearningFact[],
  labels: ReadonlyMap<string, GenrePoolKey>,
  tags: ReadonlyMap<string, CreativeTag>,
  opts: { now: Date; shows?: ReadonlyMap<string, string> },
): TagPerformanceRow[] {
  const relabelled: LearningFact[] = [];
  for (const fact of facts) {
    const family = fact.eventId ? labels.get(fact.eventId) : undefined;
    if (family) relabelled.push({ ...fact, clientId: `${GENRE_CLIENT_PREFIX}${family}` });
  }
  const clients: LearningClient[] = GENRE_POOL_KEYS.map((family) => ({ id: `${GENRE_CLIENT_PREFIX}${family}`, name: family, vertical: null, userId: null }));
  return computeTagPerformance(relabelled, clients, tags, opts)
    .filter((row) => row.scope === "client")
    .map((row) => ({ ...row, scope_id: row.scope_id.slice(GENRE_CLIENT_PREFIX.length) }));
}

const tagKey = (row: Pick<TagPerformanceRow, "stage" | "dimension" | "value_key">) => `${row.stage}|${row.dimension}|${row.value_key}`;

function tagPair(row: TagPerformanceRow): PairRow {
  return { key: tagKey(row), index: row.stage === "unknown" ? null : row.index, confidence: row.confidence, eventsN: row.events_n };
}

export function tagJobData(
  facts: readonly LearningFact[],
  families: ReadonlyMap<string, GenrePoolKey>,
  tags: ReadonlyMap<string, CreativeTag>,
  allRows: readonly TagPerformanceRow[],
  opts: { now: Date; shows?: ReadonlyMap<string, string> },
): JobData {
  const since = windowStart(opts.now, TAG_WINDOW_DAYS);
  // The same filter as the job's own ad roll-up, done once rather than per shuffle.
  const kept = facts.filter((f) => f.clientId && f.tagIds.length && f.row.date >= since && f.eventId && families.has(f.eventId));
  const events = new Map<string, { showId: string; clientId: string }>();
  for (const fact of kept) {
    const showId = opts.shows?.get(fact.eventId!);
    if (showId && !events.has(fact.eventId!)) events.set(fact.eventId!, { showId, clientId: fact.clientId! });
  }
  return {
    events,
    families,
    rowsFor: (labels) => tagGenreRows(kept, labels, tags, opts).map(tagPair),
    allRows: new Map(allRows.filter((row) => row.scope === "all").map((row) => [tagKey(row), tagPair(row)])),
  };
}

// ─── copy_performance / copy_features ────────────────────────────────────────

const copyKey = (row: Pick<CopyPerformanceRow, "template_key" | "field" | "stage" | "voice">) => `${row.template_key}|${row.field}|${row.stage}|${row.voice}`;

function copyPair(row: CopyPerformanceRow): PairRow {
  return { key: copyKey(row), index: row.index_vs_event, confidence: row.confidence, eventsN: row.events_n };
}

/**
 * Genre rows for the copy jobs: the library's ads on events with a family,
 * the family in the vertical's place, scored against the whole library's
 * baselines. The vertical-scope rows that come back are the genre rows.
 */
export function copyGenreRows(
  ads: readonly ScoreAd[],
  baselineAds: readonly ScoreAd[],
  labels: ReadonlyMap<string, GenrePoolKey>,
  keep?: (key: string) => boolean,
): CopyPerformanceRow[] {
  const relabelled: ScoreAd[] = [];
  for (const ad of ads) {
    const family = labels.get(ad.eventId);
    if (family) relabelled.push({ ...ad, vertical: family });
  }
  return scoreTemplates(relabelled, COPY_SHRINK_K, { keep, baselineAds, scopes: ["vertical"] });
}

function copyJobData(ads: readonly ScoreAd[], families: ReadonlyMap<string, GenrePoolKey>, allRows: readonly CopyPerformanceRow[], keep?: (key: string) => boolean): JobData {
  const kept = ads.filter((ad) => families.has(ad.eventId));
  const events = new Map<string, { showId: string; clientId: string }>();
  for (const ad of kept) if (!events.has(ad.eventId)) events.set(ad.eventId, { showId: ad.showId, clientId: ad.clientId });
  return {
    events,
    families,
    rowsFor: (labels) => copyGenreRows(kept, ads, labels, keep).map(copyPair),
    allRows: new Map(allRows.filter((row) => row.scope === "all").map((row) => [copyKey(row), copyPair(row)])),
  };
}

export function copyPerformanceJobData(library: CopyLibrary, families: ReadonlyMap<string, GenrePoolKey>, allRows: readonly CopyPerformanceRow[]): JobData {
  return copyJobData(library.ads, families, allRows);
}

/**
 * copy_features' all rows, as scored rows (the feature key in template_key),
 * so they pair with the genre rows on the same key.
 */
export function copyFeaturesJobData(library: CopyLibrary, families: ReadonlyMap<string, GenrePoolKey>): JobData {
  const ads = featureAds(library);
  const keep = (key: string) => parseFeatureKey(key) != null;
  const allRows = scoreTemplates(ads, COPY_SHRINK_K, { keep, scopes: ["all"] });
  return copyJobData(ads, families, allRows, keep);
}

// ─── The run ─────────────────────────────────────────────────────────────────

export type GenreShadowResult = {
  /** False when events.genre_family couldn't be read. */
  read: boolean;
  /** Events with a pooling family. */
  events: number;
  jobs: GenreJobStatus[];
};

export function computeGenreShadow(input: {
  families: GenreFamilies;
  facts: readonly LearningFact[];
  tags: ReadonlyMap<string, CreativeTag>;
  shows: ReadonlyMap<string, string>;
  tagRows: readonly TagPerformanceRow[];
  library: CopyLibrary | null;
  copyRows: readonly CopyPerformanceRow[];
  now: Date;
  shuffles?: number;
  budgetMs?: number;
  clock?: () => number;
}): GenreShadowResult {
  const families = input.families.byEvent;
  const control = { shuffles: input.shuffles, budgetMs: input.budgetMs, clock: input.clock };
  const jobs: GenreJobStatus[] = [
    runControl("tag_performance", tagJobData(input.facts, families, input.tags, input.tagRows, { now: input.now, shows: input.shows }), control),
  ];
  const library = input.library ?? { ads: [], droppedNameOnly: 0 };
  jobs.push(runControl("copy_performance", copyPerformanceJobData(library, families, input.copyRows), control));
  jobs.push(runControl("copy_features", copyFeaturesJobData(library, families), control));
  return { read: input.families.read, events: families.size, jobs };
}

// ─── The run log ─────────────────────────────────────────────────────────────

export function genreRunDetail(result: GenreShadowResult): GenreRunDetail {
  return {
    read: result.read,
    events: result.events,
    jobs: result.jobs.map(({ job, families, pairs, separating, shuffles, beats, on }) => ({
      job,
      families,
      pairs,
      separating,
      shuffles,
      beats: beats == null ? null : Math.round(beats * 1000) / 1000,
      on,
    })),
  };
}

