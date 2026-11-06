"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { CreativeLabCardData } from "@/lib/db/creative-lab";
import { firstPairings, groupClips, roundMatrix, styleLabel } from "@/lib/creative-lab/surface";
import { CaptionOverlay } from "@/components/dashboard/events/creative-lab/caption-overlay";

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
  const clips = [...groupClips(lab.clips).keeping, ...groupClips(lab.clips).fresh];
  const captions = lab.captions.filter((caption) => caption.status === "approved");
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const matrix = roundMatrix({ clips, captions, excluded });
  const narrow = firstPairings(matrix.cells);
  const reason = proposeReason(lab, clips.length, captions.length);
  const latest = lab.rounds.find((round) => round.status === "draft" || round.status === "approved");
  const launchReason = !latest
    ? null
    : !lab.launchesEnabled
      ? "Lab launches are switched off"
      : latest.rendersPending
        ? "Renders are still pending"
        : null;

  function toggle(key: string) {
    setExcluded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <section id="lab-round" className="space-y-3">
      <h3 className="font-medium">Round</h3>
      {clips.length > 0 && captions.length > 0 ? (
        <>
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
                    <th className="py-1 pr-2 text-left font-normal">{clip.artistName} #{clip.clipNo}</th>
                    {captions.map((caption) => {
                      const cell = matrix.cells.find((item) => item.clipId === clip.id && item.captionId === caption.id);
                      return (
                        <td key={caption.id}>
                          <button type="button" className={`w-16 rounded border p-1 ${cell?.on ? "border-foreground bg-card" : "border-dashed border-border text-muted-foreground"}`} onClick={() => toggle(`${clip.id}:${caption.id}`)}>
                            <CaptionOverlay lines={[]} src={clip.previewUrl} compact />
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
                    <span className="w-10 shrink-0"><CaptionOverlay lines={[]} src={clip?.previewUrl} compact /></span>
                    <span>{clip?.artistName} #{clip?.clipNo} · {caption ? styleLabel(caption.style) : "caption"} · {cell.on ? "On" : "Off"}</span>
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
          Propose
        </Button>
        {reason || matrix.on === 0 ? <span className="text-sm text-muted-foreground">{reason || "Turn at least one pairing on."}</span> : null}
      </div>
      {lab.rounds.length > 0 ? (
        <div className="space-y-3 sm:grid sm:grid-cols-2 sm:gap-3 sm:space-y-0">
          {lab.rounds.map((round) => (
            <div key={round.id}>
              <p className="text-xs tracking-wide text-muted-foreground uppercase">Round {round.roundNo}</p>
              <ul>
                {round.ads.map((ad) => {
                  const clip = lab.clips.find((row) => row.id === ad.clipId);
                  const caption = lab.captions.find((row) => row.id === ad.captionId);
                  return (
                    <li key={ad.id} className="flex items-center gap-2 py-1">
                      <span className="w-10 shrink-0"><CaptionOverlay lines={[]} src={clip?.previewUrl} compact /></span>
                      <span className="min-w-0 flex-1">{clip ? `${clip.artistName} #${clip.clipNo}` : "Clip"} × {caption ? styleLabel(caption.style) : "caption"}</span>
                      <span className="text-muted-foreground">{ad.launchState === "ready" ? "Ready" : ad.launchState === "pending" ? "Rendering" : ad.verdict ?? ad.launchState}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
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

function proposeReason(lab: CreativeLabCardData, clips: number, captions: number): string | null {
  if (captions === 0) return "Approve at least 1 caption to propose round 1.";
  if (clips === 0) return "No usable clips.";
  if (lab.adSets.length === 0) return "No ad set on this event.";
  return null;
}
