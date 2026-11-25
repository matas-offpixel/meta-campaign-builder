/**
 * lib/artist-library/match.ts — which ads are an artist's (AL2).
 *
 * An ad is the artist's when, in this order:
 *   lab            it ran a Lab render of the artist's clip;
 *   ad_name        the artist's full name is in its ad, ad set or campaign name;
 *   tag            a creative_tag_assignments row names the artist in its creative name;
 *   event_artists  its event is linked to the artist and one of the name's
 *                  words (4+ letters) is in the ad or ad set name: "Lineup
 *                  Push - Enzo" on a show Enzo is linked to.
 * Spend is only ever the matched ads' (AL2), never the whole show's.
 *
 * Stage is the tree's (RC14, stageOfCampaign over the campaign name and
 * objective). Only Signup and On sale are ranked; an Unsorted ad isn't.
 *
 * Pure.
 */
import { stageOfCampaign } from "../campaign-tree/tree.ts";
import type { RankedStage } from "./words.ts";

export type MatchedBy = "lab" | "drive" | "event_artists" | "ad_name" | "tag";

/** Lower case, accents dropped, everything but letters and digits a space, single-spaced. */
export function fold(text: string | null | undefined): string {
  return ` ${(text ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
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

/** The words of a name that can stand for it on its own linked show: 4+ letters, not a common word. */
const COMMON = new Set(["the", "and", "dj", "live", "band", "club", "night", "show", "presents", "with", "more", "friends", "b2b"]);
export function nameWords(artistName: string): string[] {
  return fold(artistName)
    .trim()
    .split(" ")
    .filter((w) => w.length >= 4 && !COMMON.has(w));
}

export function hasNameWord(text: string | null | undefined, artistName: string): boolean {
  const folded = fold(text);
  return nameWords(artistName).some((w) => folded.includes(` ${w} `));
}

export interface AdNames {
  ad_name: string | null;
  adset_name: string | null;
  campaign_name: string | null;
}

/**
 * How an ad (not a Lab one) is the artist's, or null. `linked` says the
 * ad's event is in the artist's event_artists; `tagged` that a tag
 * assignment's creative name carries the full name.
 */
export function matchAd(ad: AdNames, artistName: string, opts: { linked: boolean; tagged: boolean }): MatchedBy | null {
  if (hasFullName(ad.ad_name, artistName) || hasFullName(ad.adset_name, artistName) || hasFullName(ad.campaign_name, artistName)) return "ad_name";
  if (opts.tagged) return "tag";
  if (opts.linked && (hasNameWord(ad.ad_name, artistName) || hasNameWord(ad.adset_name, artistName))) return "event_artists";
  return null;
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
