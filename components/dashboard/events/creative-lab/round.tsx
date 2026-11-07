"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { CreativeLabCardData } from "@/lib/db/creative-lab";
import { nextRoundView } from "@/lib/creative-lab/round-next";
import { adPairingName, firstPairings, groupClips, roundHasRun, roundMatrix, styleLabel } from "@/lib/creative-lab/surface";
import { CaptionOverlay } from "@/components/dashboard/events/creative-lab/caption-overlay";
import { RoundsTimeline } from "@/components/dashboard/events/creative-lab/rounds-timeline";
import { VerdictChip } from "@/components/dashboard/events/creative-lab/verdict-chip";

type Save = (body: Record<string, unknown>) => Promise<{ ok: boolean; json: Record<string, unknown> } | undefined>;

export function LabRound({
  lab,
  busy,
  onSave,
  onLaunch,
}: {
  lab: CreativeLabCardData;
  busy: boolean;
  onSave: Save;
  onLaunch: (roundId: string) => Promise<void>;
}) {
  const groups = groupClips(lab.clips);
  const usable = [...groups.keeping, ...groups.fresh];
  const approved = lab.captions.filter((caption) => caption.status === "approved");
  const rounds = [...lab.rounds].sort((a, b) => a.roundNo - b.roundNo);
  const next = nextRoundView({
    rounds,
    usableClipIds: usable.map((clip) => clip.id),
    approvedCaptionIds: approved.map((caption) => caption.id),
  });
  const roundNo = next?.roundNo ?? (rounds.filter((round) => roundHasRun(round.status)).at(-1)?.roundNo ?? 0) + 1;
  const clips = next ? next.plan.clips.map((item) => usable.find((clip) => clip.id === item.id)!).filter(Boolean) : usable;
  const captions = next ? next.plan.captions.map((item) => approved.find((caption) => caption.id === item.id)!).filter(Boolean) : approved;
  const keptClips = new Set(next?.plan.clips.filter((item) => item.kind === "kept").map((item) => item.id) ?? []);
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const matrix = roundMatrix({ clips, captions, excluded });
  const narrow = firstPairings(matrix.cells);
  const reason = proposeReason(lab, clips.length, captions.length, roundNo);
  const pending = rounds.filter((round) => round.status === "draft" || round.status === "approved" || round.status === "rendering");
  const ran = rounds.filter((round) => roundHasRun(round.status));
  const latest = pending.at(-1);
  const launchReason = !latest
    ? null
    : !lab.launchesEnabled
      ? "Lab launches are switched off"
      : latest.rendersPending
        ? "Renders are still pending"
        : null;
  const showMatrix = clips.length > 0 && captions.length > 0;

  function toggle(key: string) {
    setExcluded((current) => {
      const nextSet = new Set(current);
      if (nextSet.has(key)) nextSet.delete(key);
      else nextSet.add(key);
      return nextSet;
    });
  }

  return (
    <section id="lab-round" className="space-y-3">
      <h3 className="font-medium">Round</h3>
      {ran.length > 0 ? <RoundsTimeline lab={lab} rounds={ran} next={next} /> : null}
      {showMatrix ? (
        <>
          {next ? <p className="text-sm">Round {roundNo} keeps round {next.judged.roundNo}&apos;s winners and anything still untested.</p> : null}
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th />
                  {captions.map((caption) => <th key={caption.id} className="px-2 text-left font-normal">{styleLabel(caption.style)}</th>)}
                </tr>
              </thead>
              <tbody>
                {clips.map((clip) => (
                  <tr key={clip.id}>
                    <th className="py-1 pr-2 text-left font-normal">
                      {clip.artistName} #{clip.clipNo}
                      {next ? <span className="ml-2"><VerdictChip kind={keptClips.has(clip.id) ? "kept" : "new"} /></span> : null}
                    </th>
                    {captions.map((caption) => {
                      const cell = matrix.cells.find((item) => item.clipId === clip.id && item.captionId === caption.id);
                      return (
                        <td key={caption.id}>
                          <button type="button" className={`w-16 rounded border p-1 ${cell?.on ? "border-foreground bg-card" : "border-dashed border-border text-muted-foreground"}`} onClick={() => toggle(`${clip.id}:${caption.id}`)}>
                            <CaptionOverlay lines={[]} src={clip.previewUrl} poster={clip.thumbnailUrl} compact />
                            <span className="mt-1 block text-xs">{cell?.on ? "On" : "Off"}</span>
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="space-y-1 sm:hidden">
            {narrow.shown.map((cell) => {
              const clip = clips.find((row) => row.id === cell.clipId);
              const caption = captions.find((row) => row.id === cell.captionId);
              return (
                <li key={`${cell.clipId}:${cell.captionId}`}>
                  <button type="button" className="flex items-center gap-2 text-left text-sm" onClick={() => toggle(`${cell.clipId}:${cell.captionId}`)}>
                    <span className="w-10 shrink-0"><CaptionOverlay lines={[]} src={clip?.previewUrl} poster={clip?.thumbnailUrl ?? null} compact /></span>
                    <span>{adPairingName(clip, caption?.style)} · {cell.on ? "On" : "Off"}</span>
                  </button>
                </li>
              );
            })}
            {narrow.more > 0 ? <li className="text-muted-foreground">+ {narrow.more} more</li> : null}
          </ul>
          <p className="tabular-nums">{matrix.line}</p>
        </>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            disabled={busy || Boolean(reason) || matrix.on === 0}
            onClick={() => onSave({
              action: "propose",
              adsetMetaId: lab.adSets[0]?.metaAdSetId ?? "",
              pairs: matrix.cells.filter((cell) => cell.on).map((cell) => ({ clipId: cell.clipId, captionId: cell.captionId })),
            })}
          >
            Propose round {roundNo}
          </Button>
          {reason || matrix.on === 0 ? <span className="text-sm text-muted-foreground">{reason || "Turn at least one pairing on."}</span> : null}
      </div>
      {pending.map((round) => (
        <div key={round.id}>
          <p className="text-xs tracking-wide text-muted-foreground uppercase">Round {round.roundNo} · {round.status === "approved" ? "approved" : "draft"}</p>
          <ul>
            {round.ads.map((ad) => {
              const clip = lab.clips.find((row) => row.id === ad.clipId);
              const caption = lab.captions.find((row) => row.id === ad.captionId);
              return (
                <li key={ad.id} className="flex items-center gap-2 py-1">
                  <span className="w-10 shrink-0"><CaptionOverlay lines={[]} src={clip?.previewUrl} poster={clip?.thumbnailUrl ?? null} compact /></span>
                  <span className="min-w-0 flex-1">{adPairingName(clip, caption?.style)}</span>
                  <span className="text-muted-foreground">{ad.launchState === "ready" ? "Ready" : ad.launchState === "render_failed" ? "Render failed" : "Rendering"}</span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {latest ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" disabled={busy || Boolean(launchReason)} onClick={() => void onLaunch(latest.id)}>
            Approve & launch
          </Button>
          {launchReason ? <span className="text-sm text-muted-foreground">{launchReason}</span> : null}
        </div>
      ) : null}
    </section>
  );
}

function proposeReason(lab: CreativeLabCardData, clips: number, captions: number, roundNo: number): string | null {
  if (captions === 0) return `Approve at least 1 caption to propose round ${roundNo}.`;
  if (clips === 0) return "No usable clips.";
  if (lab.adSets.length === 0) return "No ad set on this event.";
  return null;
}
