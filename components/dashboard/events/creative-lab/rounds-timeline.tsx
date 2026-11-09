import type { CreativeLabCardData } from "@/lib/db/creative-lab";
import type { NextRound } from "@/lib/creative-lab/round-next";
import { adPairingName, captionCopy, metricUnit, money, resultsLabel, styleLabel } from "@/lib/creative-lab/surface";
import { VerdictChip } from "@/components/dashboard/events/creative-lab/verdict-chip";

type Round = CreativeLabCardData["rounds"][number];

function pooled(round: Round): string | null {
  const spend = round.ads.reduce((sum, ad) => sum + (ad.cost ?? 0) * (ad.results ?? 0), 0);
  const results = round.ads.reduce((sum, ad) => sum + (ad.results ?? 0), 0);
  if (!(spend > 0 && results > 0)) return null;
  const metric = round.ads.find((ad) => ad.metric)?.metric ?? null;
  return `${money(spend / results)} / ${metricUnit(metric)}`;
}

/**
 * Rounds timeline (design rules): a column per round. A round that ran
 * lists its ads, "{artist} #{n} × {angle}", each with its verdict chip and
 * cost; an ad whose clip or caption is killed is struck through. The plan
 * column carries kept clips and captions across and enters new ones
 * dashed. At 393 rounds stack, newest first.
 */
export function RoundsTimeline({ lab, rounds, next }: { lab: CreativeLabCardData; rounds: readonly Round[]; next: NextRound | null }) {
  const killedClips = new Set(next?.column.clips.filter((item) => item.killed).map((item) => item.id) ?? []);
  const killedCaptions = new Set(next?.column.captions.filter((item) => item.killed).map((item) => item.id) ?? []);
  const captionOf = (id: string) => lab.captions.find((row) => row.id === id);
  const clipOf = (id: string) => lab.clips.find((row) => row.id === id);
  return (
    <div className="flex flex-col-reverse gap-3 sm:grid sm:grid-flow-col sm:auto-cols-fr">
      {rounds.map((round) => {
        const judgedHere = next?.judged.id === round.id;
        return (
          <div key={round.id} className="rounded border border-border bg-card p-2">
            <p className="mb-2 text-xs tracking-wide text-muted-foreground uppercase">
              {[`Round ${round.roundNo}`, round.status === "judged" ? "judged" : "running", pooled(round)].filter(Boolean).join(" · ")}
            </p>
            <ul className="space-y-2">
              {round.ads.map((ad) => {
                const killed = judgedHere && (killedClips.has(ad.clipId) || killedCaptions.has(ad.captionId));
                return (
                  <li key={ad.id} className="text-sm">
                    <p className="flex items-center justify-between gap-2">
                      <span className={killed ? "text-muted-foreground line-through" : ""}>{adPairingName(clipOf(ad.clipId), captionOf(ad.captionId)?.style)}</span>
                      <VerdictChip verdict={ad.verdict} />
                    </p>
                    {ad.cost != null && ad.results ? (
                      <p className="tabular-nums text-muted-foreground">{money(ad.cost)} / {metricUnit(ad.metric)} · {resultsLabel(ad.results, ad.metric)}</p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
      {next ? (
        <div className="rounded border border-dashed border-border p-2">
          <p className="mb-2 text-xs tracking-wide text-muted-foreground uppercase">Round {next.roundNo} · plan</p>
          <ul className="space-y-1">
            {next.plan.clips.map((item) => {
              const clip = clipOf(item.id);
              return (
                <li key={item.id} className="flex items-center justify-between gap-2 text-sm">
                  <span>{clip ? `${clip.artistName} #${clip.clipNo}` : "Clip"}</span>
                  <VerdictChip kind={item.kind} />
                </li>
              );
            })}
            {next.plan.captions.map((item) => {
              const caption = captionOf(item.id);
              return (
                <li key={item.id} className="flex items-center justify-between gap-2 text-sm">
                  <span>{caption ? `${styleLabel(caption.style)} · “${captionCopy(caption.lines).split("\n")[0]}”` : "Caption"}</span>
                  <VerdictChip kind={item.kind} />
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
