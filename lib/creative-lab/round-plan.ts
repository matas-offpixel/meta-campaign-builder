/**
 * Round n+1 from round n's verdicts (roadmap M3): keep winners and
 * anything undecided, drop what only lost or was flagged, put new
 * captions on winning clips and new clips with winning captions. Pure,
 * so the card can draw the plan without loading the judge.
 */

import type { Verdict } from "./judge.ts";

export type RoundPlanInput = { clipId: string; captionId: string; verdict: Verdict | null; confirmed: boolean };

export type RoundPlan = {
  /** Clips with a winner, or not yet decided (untested, thin, between bands). */
  keepClips: string[];
  keepCaptions: string[];
  /** Winning clips: pair each with new captions. */
  newCaptionsOn: string[];
  /** Winning captions: pair each with new clips. */
  newClipsWith: string[];
  /** Winners not yet confirmed: run once more as controls. */
  retest: { clipId: string; captionId: string }[];
  /** Every decided ad lost or was flagged, and none won. */
  dropClips: string[];
  dropCaptions: string[];
};

const UNDECIDED = new Set<Verdict | null>(["untested", "thin", null]);

/** Winning clip + new captions, winning caption + new clips (roadmap M3). */
export function nextRoundPlan(ads: readonly RoundPlanInput[]): RoundPlan {
  const plan = (key: "clipId" | "captionId") => {
    const keep: string[] = [];
    const drop: string[] = [];
    const winners: string[] = [];
    for (const id of [...new Set(ads.map((a) => a[key]))]) {
      const mine = ads.filter((a) => a[key] === id);
      const won = mine.some((a) => a.verdict === "winner");
      if (won) winners.push(id);
      if (won || mine.some((a) => UNDECIDED.has(a.verdict))) keep.push(id);
      else drop.push(id);
    }
    return { keep, drop, winners };
  };
  const clips = plan("clipId");
  const captions = plan("captionId");
  return {
    keepClips: clips.keep,
    keepCaptions: captions.keep,
    newCaptionsOn: clips.winners,
    newClipsWith: captions.winners,
    retest: ads.filter((a) => a.verdict === "winner" && !a.confirmed).map(({ clipId, captionId }) => ({ clipId, captionId })),
    dropClips: clips.drop,
    dropCaptions: captions.drop,
  };
}
