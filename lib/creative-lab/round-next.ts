/**
 * What the card draws once a round is judged: the judged round's column
 * (kept, killed struck through with its verdict) and the next round's
 * plan, from nextRoundPlan. Pure; the card passes in what it already has.
 */

import { nextRoundPlan } from "./round-plan.ts";
import { itemVerdict } from "./surface.ts";

export type RoundForPlan = {
  id: string;
  roundNo: number;
  status: string;
  ads: readonly { clipId: string; captionId: string; verdict: string | null; cost: number | null; results: number | null }[];
};

export type ColumnItem = { id: string; verdict: string | null; killed: boolean };
export type PlanItem = { id: string; kind: "kept" | "new" };

export type NextRound = {
  roundNo: number;
  judged: RoundForPlan;
  /** The judged round, pooled: total spend over total results. */
  pooledCost: number | null;
  column: { clips: ColumnItem[]; captions: ColumnItem[] };
  plan: { clips: PlanItem[]; captions: PlanItem[] };
};

const VERDICTS = new Set(["untested", "thin", "loser", "winner", "flagged"]);

function asVerdict(value: string | null): "untested" | "thin" | "loser" | "winner" | "flagged" | null {
  return value && VERDICTS.has(value) ? (value as "untested") : null;
}

function unique(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

/**
 * The newest round, when it is judged and nothing newer exists. Usable
 * clips and approved captions that the judged round never ran come in
 * as new. Order follows the card's own lists.
 */
export function nextRoundView(args: {
  rounds: readonly RoundForPlan[];
  usableClipIds: readonly string[];
  approvedCaptionIds: readonly string[];
}): NextRound | null {
  const latest = [...args.rounds].sort((a, b) => b.roundNo - a.roundNo)[0];
  if (!latest || latest.status !== "judged") return null;
  const plan = nextRoundPlan(
    latest.ads.map((ad) => ({ clipId: ad.clipId, captionId: ad.captionId, verdict: asVerdict(ad.verdict), confirmed: false })),
  );
  const ranClips = unique(latest.ads.map((ad) => ad.clipId));
  const ranCaptions = unique(latest.ads.map((ad) => ad.captionId));
  const column = (ids: string[], key: "clipId" | "captionId", drop: readonly string[]): ColumnItem[] =>
    ids.map((id) => ({
      id,
      verdict: itemVerdict(latest.ads.filter((ad) => ad[key] === id).map((ad) => ad.verdict)),
      killed: drop.includes(id),
    }));
  const next = (usable: readonly string[], keep: readonly string[], ran: readonly string[]): PlanItem[] => [
    ...usable.filter((id) => keep.includes(id)).map((id) => ({ id, kind: "kept" as const })),
    ...usable.filter((id) => !ran.includes(id)).map((id) => ({ id, kind: "new" as const })),
  ];
  const spend = latest.ads.reduce((sum, ad) => sum + (ad.cost ?? 0) * (ad.results ?? 0), 0);
  const results = latest.ads.reduce((sum, ad) => sum + (ad.results ?? 0), 0);
  return {
    roundNo: latest.roundNo + 1,
    judged: latest,
    pooledCost: results > 0 && spend > 0 ? spend / results : null,
    column: {
      clips: column(ranClips, "clipId", plan.dropClips),
      captions: column(ranCaptions, "captionId", plan.dropCaptions),
    },
    plan: {
      clips: next(args.usableClipIds, plan.keepClips, ranClips),
      captions: next(args.approvedCaptionIds, plan.keepCaptions, ranCaptions),
    },
  };
}
