/**
 * GK3's operator status lines (frame G4) and the genre pool's rules, apart
 * from the shadow computation so the learning-refresh report and the frames
 * load only this. Pure; relative imports only.
 */

import { genreLabel, genreLabelInSentence, isGenrePoolKey, type GenrePoolKey } from "./families.ts";

/** A pool needs this many shows … */
export const GENRE_POOL_MIN_SHOWS = 5;
/** … across this many clients, so a genre can't stand in for one client. */
export const GENRE_POOL_MIN_CLIENTS = 2;
/** … and the real grouping must beat this share of shuffles. */
export const GENRE_POOL_MIN_BEATS = 0.9;

export type GenreJob = "tag_performance" | "copy_performance" | "copy_features";
export const GENRE_JOBS: readonly GenreJob[] = ["tag_performance", "copy_performance", "copy_features"];

export type GenreFamilyCount = { family: GenrePoolKey; shows: number; clients: number };

/** The compact form kept on `cron_runs.detail.genre`: what the status line needs, nothing more. */
export type GenreRunDetail = {
  read: boolean;
  events: number;
  jobs: { job: GenreJob; families: GenreFamilyCount[]; pairs: number; separating: number; shuffles: number; beats: number | null; on: GenrePoolKey[] }[];
};

// ─── The status line (GK3) ───────────────────────────────────────────────────

const NEEDS = `Needs ${GENRE_POOL_MIN_SHOWS} shows across ${GENRE_POOL_MIN_CLIENTS} clients, and to beat ${Math.round(GENRE_POOL_MIN_BEATS * 100)} % of shuffles.`;

function shows(n: number): string {
  return n === 1 ? "show" : "shows";
}

function clients(n: number): string {
  return `${n} ${n === 1 ? "client" : "clients"}`;
}

/** Whole percent, rounded down so a pool just under the bar never reads as at it. */
export function beatsPercent(beats: number): number {
  return Math.floor(beats * 100 + 1e-9);
}

/**
 * GK3's operator status lines for one job: one "on" line per family whose
 * pool is on, else one "off" line naming the leading family.
 */
export function genreStatusLines(status: { job: GenreJob; families: readonly GenreFamilyCount[]; beats: number | null; on: readonly GenrePoolKey[] }, read = true): string[] {
  if (!read) return [`Genre pool off · ${status.job}: genres couldn't be read this run.`];
  const on = status.families.filter((count) => status.on.includes(count.family));
  if (on.length && status.beats != null) {
    return on.map(
      (count) =>
        `Genre pool on · ${status.job} · ${genreLabel(count.family)}: ${count.shows} ${shows(count.shows)} across ${clients(count.clients)}, beats ${beatsPercent(status.beats!)} % of shuffles.`,
    );
  }
  const lead = status.families[0];
  if (!lead) return [`Genre pool off · ${status.job}: no shows have a genre yet. ${NEEDS}`];
  const today = status.beats == null ? "Today: not tested." : `Today: ${beatsPercent(status.beats)} %.`;
  return [`Genre pool off · ${status.job}: ${lead.shows} ${genreLabelInSentence(lead.family)} ${shows(lead.shows)} across ${clients(lead.clients)}. ${NEEDS} ${today}`];
}

/** Lines from a stored run detail. Anything malformed reads as nothing. */
export function genreStatusLinesFromDetail(detail: unknown): string[] {
  if (!detail || typeof detail !== "object") return [];
  const genre = (detail as { genre?: unknown }).genre as Partial<GenreRunDetail> | undefined;
  if (!genre || !Array.isArray(genre.jobs)) return [];
  const lines: string[] = [];
  for (const job of genre.jobs) {
    if (!job || !GENRE_JOBS.includes(job.job)) continue;
    const families = (Array.isArray(job.families) ? job.families : []).filter((f) => f && isGenrePoolKey(f.family));
    lines.push(...genreStatusLines({ job: job.job, families, beats: typeof job.beats === "number" ? job.beats : null, on: Array.isArray(job.on) ? job.on : [] }, genre.read !== false));
  }
  return lines;
}
