"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import type { CreativeLabCardData } from "@/lib/db/creative-lab";
import { nextRoundView } from "@/lib/creative-lab/round-next";
import { effectiveSelection, emptySelection, noSelectedClipsSentence, notSelectedCount, notSelectedNames, renderPairs, roundBar, winnerNotSelected } from "@/lib/creative-lab/selection";
import { adPairingName, firstPairings, groupClips, roundHasRun, roundMatrix, styleLabel } from "@/lib/creative-lab/surface";
import { CaptionOverlay } from "@/components/dashboard/events/creative-lab/caption-overlay";
import { FACE_CHECK_FAILED, FACE_CHECKING } from "@/lib/creative-lab/caption-placement";
import { RoundsTimeline } from "@/components/dashboard/events/creative-lab/rounds-timeline";
import { VerdictChip } from "@/components/dashboard/events/creative-lab/verdict-chip";

type Save = (body: Record<string, unknown>) => Promise<{ ok: boolean; json: Record<string, unknown> } | undefined>;

export function LabRound({
  lab,
  busy,
  onSave,
  onLaunch,
  initialOff = [],
}: {
  lab: CreativeLabCardData;
  busy: boolean;
  onSave: Save;
  onLaunch: (roundId: string) => Promise<void>;
  /** Frame only: pairings that start knocked out, "clipId:captionId". */
  initialOff?: readonly string[];
}) {
  const router = useRouter();
  const [faceRetry, setFaceRetry] = useState<string | null>(null);
  async function retryFaces(clipId: string) {
    setFaceRetry(clipId);
    try {
      await fetch(`/api/creative-lab/clips/${clipId}/face-retry`, { method: "POST" });
      router.refresh();
    } finally {
      setFaceRetry(null);
    }
  }
  const groups = groupClips(lab.clips);
  const usable = [...groups.keeping, ...groups.fresh];
  const selection = lab.clipSelection ?? emptySelection();
  const selectedClips = effectiveSelection(selection, usable);
  const approved = lab.captions.filter((caption) => caption.status === "approved");
  const rounds = [...lab.rounds].sort((a, b) => a.roundNo - b.roundNo);
  const next = nextRoundView({
    rounds,
    usableClipIds: selectedClips.map((clip) => clip.id),
    approvedCaptionIds: approved.map((caption) => caption.id),
  });
  const roundNo = next?.roundNo ?? (rounds.filter((round) => roundHasRun(round.status)).at(-1)?.roundNo ?? 0) + 1;
  const planned = next ? next.plan.clips.map((item) => usable.find((clip) => clip.id === item.id)!).filter(Boolean) : selectedClips;
  const selectedIds = new Set(selectedClips.map((clip) => clip.id));
  const droppedWinners = next
    ? next.plan.clips.filter((item) => item.kind === "kept" && !selectedIds.has(item.id)).map((item) => usable.find((clip) => clip.id === item.id)).filter((clip): clip is NonNullable<typeof clip> => Boolean(clip))
    : [];
  const clips = planned.filter((clip) => selectedIds.has(clip.id));
  const captions = next ? next.plan.captions.map((item) => approved.find((caption) => caption.id === item.id)!).filter(Boolean) : approved;
  const keptClips = new Set(next?.plan.clips.filter((item) => item.kind === "kept").map((item) => item.id) ?? []);
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set(initialOff));
  const matrix = roundMatrix({ clips, captions, excluded });
  const narrow = firstPairings(matrix.cells);
  const moreOn = matrix.on - narrow.shown.filter((cell) => cell.on).length;
  const artistId = clips[0]?.artistId;
  const artistClips = artistId ? usable.filter((clip) => clip.artistId === artistId) : [];
  const missing = artistClips.filter((clip) => !selectedIds.has(clip.id));
  const gap = artistClips.length && missing.length ? notSelectedCount(artistClips[0]?.artistName ?? "This artist", missing.length, artistClips.length) : null;
  const missingLine = notSelectedNames(missing.map((clip) => `${clip.artistName} #${clip.clipNo}`));
  const reason = proposeReason(lab, clips.length, captions.length, roundNo, usable.length);
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
      <h3 className="font-medium">Round {roundNo}{clips[0] ? ` · ${clips[0].artistName}` : ""}</h3>
      {ran.length > 0 ? <RoundsTimeline lab={lab} rounds={ran} next={next} /> : null}
      {showMatrix ? (
        <>
          {next ? <p className="text-sm">Round {roundNo} keeps round {next.judged.roundNo}&apos;s winners and anything still untested.</p> : <p className="text-sm text-muted-foreground">the selected clips × the approved captions</p>}
          {droppedWinners.map((clip) => (
            <p key={clip.id} className="text-sm text-warning">{winnerNotSelected(`${clip.artistName} #${clip.clipNo}`, next?.judged.roundNo ?? roundNo - 1)}</p>
          ))}
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th />
                  {captions.map((caption) => <th key={caption.id} className="px-2 text-left font-normal">{captionHead(caption)}</th>)}
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
                          <button type="button" className={`w-16 rounded border p-1 ${cell?.on ? "border-border bg-card" : "border-dashed border-border text-muted-foreground"}`} onClick={() => toggle(`${clip.id}:${caption.id}`)}>
                            <CaptionOverlay lines={[]} src={clip.previewUrl} poster={clip.thumbnailUrl} compact />
                            <span className="mt-1 block text-xs">{cell?.on ? "On" : "Off — tap to include"}</span>
                          </button>
                          {cell?.on ? <PlacementLine note={placementNoteFor(lab, clip.id, caption.id)} busy={faceRetry === clip.id} onRetry={() => void retryFaces(clip.id)} /> : null}
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
                    <span>{pairingLabel(clip, caption)} · {cell.on ? "On" : "Off"}</span>
                  </button>
                  {cell.on && clip && caption ? <PlacementLine note={placementNoteFor(lab, clip.id, caption.id)} busy={faceRetry === clip.id} onRetry={() => void retryFaces(clip.id)} /> : null}
                </li>
              );
            })}
            {moreOn > 0 || matrix.off > 0 ? <li className="text-muted-foreground">+ {moreOn} more · {matrix.off} off</li> : null}
          </ul>
          {missingLine ? <p className="hidden text-sm text-muted-foreground sm:block">{clipsLink(missingLine)}</p> : null}
          <p className="tabular-nums hidden sm:block">{roundBar(matrix.on, clips.length, captions.length, matrix.off)}{gap ? ` · ${gap}` : ""}</p>
          <div className="space-y-1 sm:hidden">
            <p className="font-medium tabular-nums">{matrix.on} ads</p>
            <p className="text-muted-foreground">{clips.length} clips × {captions.length} captions, {matrix.off} left out</p>
            {gap ? <p className="text-muted-foreground">{clipsLink(`${gap} · change on Clips`)}</p> : null}
          </div>
        </>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            disabled={busy || Boolean(reason) || matrix.on === 0}
            onClick={() => onSave({
              action: "propose",
              adsetMetaId: lab.adSets[0]?.metaAdSetId ?? "",
              pairs: renderPairs(matrix.cells).map((cell) => ({ clipId: cell.clipId, captionId: cell.captionId })),
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

function clipsLink(text: string) {
  const mark = "change on Clips";
  const at = text.lastIndexOf(mark);
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <a href="#lab-clips" className="underline">{mark}</a>
      {text.slice(at + mark.length)}
    </>
  );
}

function proposeReason(lab: CreativeLabCardData, clips: number, captions: number, roundNo: number, usable: number): string | null {
  if (clips === 0 && usable > 0) return noSelectedClipsSentence(roundNo);
  if (captions === 0) return `Approve at least 1 caption to propose round ${roundNo}.`;
  if (clips === 0) return "No usable clips.";
  if (lab.adSets.length === 0) return "No ad set on this event.";
  return null;
}

function placementNoteFor(lab: CreativeLabCardData, clipId: string, captionId: string): { text: string; failed: boolean } | null {
  const clip = lab.clips.find((row) => row.id === clipId);
  if (!clip?.faceCheck) {
    const stored = lab.renders.find((row) => row.clipId === clipId && row.captionId === captionId)?.placementNote ?? null;
    return stored ? { text: stored, failed: false } : null;
  }
  if (clip.faceCheck === "failed") return { text: FACE_CHECK_FAILED, failed: true };
  if (clip.faceCheck !== "ready") return { text: FACE_CHECKING, failed: false };
  const line = clip.faceByCaption?.[captionId];
  return line ? { text: line, failed: false } : null;
}

function PlacementLine({ note, busy, onRetry }: { note: { text: string; failed: boolean } | null; busy?: boolean; onRetry?: () => void }) {
  if (!note) return null;
  return (
    <p className={`mt-1 font-mono text-[11px] ${note.failed ? "text-destructive" : "text-muted-foreground"}`}>
      {note.text}
      {note.failed && onRetry ? (
        <button type="button" className="ml-1 underline" disabled={busy} onClick={onRetry}>Retry</button>
      ) : null}
    </p>
  );
}

function captionHead(caption: { style: string; lines: string[] }): string {
  const words = caption.lines[0]?.trim() ?? "";
  return words && words.length <= 24 ? `${styleLabel(caption.style)} · "${words}"` : styleLabel(caption.style);
}

function pairingLabel(clip: { artistName: string; clipNo: number } | undefined, caption: { style: string; lines: string[] } | undefined): string {
  const words = caption?.lines[0]?.trim() ?? "";
  if (words && words.length <= 24) return `${clip ? `${clip.artistName} #${clip.clipNo}` : "Clip"} × "${words}"`;
  return adPairingName(clip, caption?.style);
}
