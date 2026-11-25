/**
 * lib/artist-library/match.ts — which ads are an artist's (AL2).
 *
 * Matas, 25 Nov: an ad counts for an artist only when its ad name or ad set
 * name contains one of the artist's names, matched exactly: the name in
 * `artists`, or an alias someone recorded (aliases.ts, and the Lab's own
 * name for the artist). Case, accents and punctuation are folded; nothing
 * else is. No prefix, no first-name guess, no fuzzy match.
 *
 *   1. The ad name decides when it names anyone on the roster: those
 *      artists, and only them ("Dr Banana" in an "Enzo Siragusa Interest
 *      Targeting" ad set is Dr Banana's).
 *   2. Otherwise the ad set name, unless it is only the campaign's own name
 *      (Ads Manager's quick create copies it down), which labels the
 *      campaign, not the creative.
 *   3. Otherwise no artist: the ad is the show's own (the general bucket).
 *
 * A name inside a longer name of another artist on the roster gives way to
 * the longer one. The campaign name, tag assignments and "the artist is on
 * the bill" never make an ad an artist's. Lab clips and renders keep their
 * own owner link (backfill.ts).
 *
 * Stage is the tree's (RC14, stageOfCampaign over the campaign name and
 * objective). Only Signup and On sale are ranked; an Unsorted ad isn't.
 *
 * Pure.
 */
import { stageOfCampaign } from "../campaign-tree/tree.ts";
import type { RankedStage } from "./words.ts";

/** Migration 269's CHECK. A match on the ad set name is still "ad_name"; the dry run says which field. */
export type MatchedBy = "lab" | "drive" | "event_artists" | "ad_name" | "tag";

/** Lower case, accents dropped, everything but letters and digits a space, single-spaced. */
export function fold(text: string | null | undefined): string {
  return ` ${(text ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;
}

/** The artist's whole name, as whole words. */
export function hasFullName(text: string | null | undefined, artistName: string): boolean {
  const name = fold(artistName).trim();
  if (!name) return false;
  return fold(text).includes(` ${name} `);
}

/** One artist and every name that stands for them: their own, then recorded aliases. */
export interface RosterEntry {
  id: string;
  names: readonly string[];
}

/** A roster ready to match: folded names, longest first. */
export interface Roster {
  names: { artistId: string; folded: string }[];
}

export function buildRoster(entries: readonly RosterEntry[]): Roster {
  const seen = new Set<string>();
  const names: Roster["names"] = [];
  for (const e of entries) {
    for (const n of e.names) {
      const folded = fold(n).trim();
      if (!folded || seen.has(`${e.id}\u0000${folded}`)) continue;
      seen.add(`${e.id}\u0000${folded}`);
      names.push({ artistId: e.id, folded });
    }
  }
  names.sort((a, b) => b.folded.length - a.folded.length || a.folded.localeCompare(b.folded));
  return { names };
}

/**
 * The artists a text names, as whole words. A hit inside a longer hit of
 * another artist ("Luke" inside "Luke Dean") is dropped.
 */
export function artistsNamedIn(text: string | null | undefined, roster: Roster): string[] {
  const folded = fold(text);
  if (folded.trim() === "") return [];
  const spans: { artistId: string; start: number; end: number }[] = [];
  for (const n of roster.names) {
    const needle = ` ${n.folded} `;
    for (let at = folded.indexOf(needle); at !== -1; at = folded.indexOf(needle, at + 1)) {
      const start = at + 1;
      const end = start + n.folded.length;
      if (spans.some((s) => s.artistId !== n.artistId && s.start <= start && end <= s.end)) continue;
      spans.push({ artistId: n.artistId, start, end });
    }
  }
  return [...new Set(spans.map((s) => s.artistId))].sort();
}

export interface AdNames {
  ad_name: string | null;
  adset_name: string | null;
  campaign_name: string | null;
}

export type NamedField = "ad" | "adset";

/** Who an ad names, and where: the ad name first, then an ad set name that isn't just the campaign's. Empty: no one. */
export function artistsOfAd(ad: AdNames, roster: Roster): { artistIds: string[]; field: NamedField | null } {
  const byAd = artistsNamedIn(ad.ad_name, roster);
  if (byAd.length) return { artistIds: byAd, field: "ad" };
  if (ad.adset_name && fold(ad.adset_name) !== fold(ad.campaign_name)) {
    const bySet = artistsNamedIn(ad.adset_name, roster);
    if (bySet.length) return { artistIds: bySet, field: "adset" };
  }
  return { artistIds: [], field: null };
}

/** "x – Copy", "x - Copy 2", "x – Copy – Copy": the duplicate suffixes Ads Manager adds, folded off. */
export function withoutCopySuffix(folded: string): string {
  let out = folded.trim();
  for (;;) {
    const next = out.replace(/ copy(?: \d+)?$/, "");
    if (next === out) return out;
    out = next;
  }
}

/**
 * A source file's clip identity in an ad name: "{Client} - {Artist} {clip}"
 * or "{Artist} - {clip}", copies included. True when the folded ad name,
 * less its copy suffix and a leading client name, is exactly one of the
 * artist's names followed by the clip label. "Enzo - UGC 1", "Puzzle -
 * Enzo UGC 1" and "Enzo - UGC 1 – Copy" are UGC 1; "Enzo - UGC 12" isn't.
 */
export function isClipIdentity(adName: string | null | undefined, clip: string, artistNames: readonly string[], clientName: string | null | undefined): boolean {
  if (!adName) return false;
  let id = withoutCopySuffix(fold(adName));
  const client = fold(clientName).trim();
  if (client && id.startsWith(`${client} `)) id = id.slice(client.length + 1);
  const label = fold(clip).trim();
  return artistNames.some((n) => {
    const name = fold(n).trim();
    return Boolean(name && label) && id === `${name} ${label}`;
  });
}

/** The tree's stage for an ad's campaign, when it's one the library ranks. */
export function rankedStageOf(campaignName: string | null | undefined, metaObjective: string | null | undefined): RankedStage | null {
  const stage = stageOfCampaign({ name: campaignName, metaObjective });
  return stage === "signup" || stage === "on_sale" ? stage : null;
}

/** The result a stage is counted in: signups (registrations) at Signup, purchases at On sale. */
export function stageResult(stage: RankedStage, row: { registrations?: number | null; purchases?: number | null }): number {
  return stage === "signup" ? Number(row.registrations) || 0 : Number(row.purchases) || 0;
}

/** A still or a video, when no launched_ads media type says: a still's name says so. */
export function kindFromAd(mediaType: string | null | undefined, adName: string | null | undefined): "clip" | "static" {
  const media = (mediaType ?? "").toLowerCase();
  if (media.includes("image") || media === "photo") return "static";
  if (media.includes("video")) return "clip";
  return /\b(static|still|artwork|poster|jpe?g|png|image|card)\b/i.test(adName ?? "") ? "static" : "clip";
}

/** The first [CODE] in a campaign name, as written. */
export function codeInName(campaignName: string | null | undefined): string | null {
  const m = /\[([A-Za-z0-9][A-Za-z0-9_-]{1,40})\]/.exec(campaignName ?? "");
  return m ? m[1]! : null;
}
