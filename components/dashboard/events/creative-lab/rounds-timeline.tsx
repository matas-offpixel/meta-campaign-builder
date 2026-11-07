import type { CreativeLabCardData } from "@/lib/db/creative-lab";
import type { NextRound } from "@/lib/creative-lab/round-next";
import { captionCopy, itemVerdict, metricUnit, money } from "@/lib/creative-lab/surface";
import { VerdictChip } from "@/components/dashboard/events/creative-lab/verdict-chip";

type Round = CreativeLabCardData["rounds"][number];

type Column = {
  key: string;
  title: string;
  clips: { id: string; verdict?: string | null; kind?: "kept" | "new"; killed?: boolean }[];
  captions: { id: string; verdict?: string | null; kind?: "kept" | "new"; killed?: boolean }[];
};

function pooled(round: Round): string | null {
  const spend = round.ads.reduce((sum, ad) => sum + (ad.cost ?? 0) * (ad.results ?? 0), 0);
  const results = round.ads.reduce((sum, ad) => sum + (ad.results ?? 0), 0);
  if (!(spend > 0 && results > 0)) return null;
  const metric = round.ads.find((ad) => ad.metric)?.metric ?? null;
  return `${money(spend / results)} / ${metricUnit(metric)}`;
}

/**
 * Rounds timeline (design rules): a column per round. A kept clip or
 * caption carries across; a killed one ends struck through with its
 * verdict; a new one enters dashed. At 393 rounds stack, newest first.
 */
export function RoundsTimeline({ lab, rounds, next }: { lab: CreativeLabCardData; rounds: readonly Round[]; next: NextRound | null }) {
  const columns: Column[] = rounds.map((round) => {
    const fromPlan = next && next.judged.id === round.id ? next.column : null;
    const unique = (ids: string[]) => [...new Set(ids)];
    const of = (key: "clipId" | "captionId", id: string) => itemVerdict(round.ads.filter((ad) => ad[key] === id).map((ad) => ad.verdict));
    return {
      key: round.id,
      title: [`Round ${round.roundNo}`, round.status === "judged" ? "judged" : "running", pooled(round)].filter(Boolean).join(" · "),
      clips: fromPlan ? fromPlan.clips : unique(round.ads.map((ad) => ad.clipId)).map((id) => ({ id, verdict: of("clipId", id) })),
      captions: fromPlan ? fromPlan.captions : unique(round.ads.map((ad) => ad.captionId)).map((id) => ({ id, verdict: of("captionId", id) })),
    };
  });
  if (next) {
    columns.push({ key: "plan", title: `Round ${next.roundNo} · plan`, clips: next.plan.clips, captions: next.plan.captions });
  }
  const clipName = (id: string) => {
    const clip = lab.clips.find((row) => row.id === id);
    return clip ? `${clip.artistName} #${clip.clipNo}` : "Clip";
  };
  const captionName = (id: string) => {
    const caption = lab.captions.find((row) => row.id === id);
    return caption ? `“${captionCopy(caption.lines).split("\n")[0]}”` : "Caption";
  };
  return (
    <div className="flex flex-col-reverse gap-3 sm:grid sm:grid-flow-col sm:auto-cols-fr">
      {columns.map((column) => (
        <div key={column.key} className={`rounded border p-2 ${column.key === "plan" ? "border-dashed border-foreground/40" : "border-border bg-card"}`}>
          <p className="mb-2 text-xs tracking-wide text-muted-foreground uppercase">{column.title}</p>
          <ul className="space-y-1">
            {[...column.clips.map((item) => ({ ...item, name: clipName(item.id) })), ...column.captions.map((item) => ({ ...item, name: captionName(item.id) }))].map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-2 text-sm">
                <span className={item.killed ? "text-muted-foreground line-through" : ""}>{item.name}</span>
                {item.kind ? <VerdictChip kind={item.kind} /> : <VerdictChip verdict={item.verdict ?? null} />}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
