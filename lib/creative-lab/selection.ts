/**
 * Which clips a round and a generate may use. The mode lives on the event.
 * Rows are written only once the operator picks — mode "all" means every
 * usable clip, including one imported later.
 */

import { TOO_SMALL_FOR_916 } from "./import-quality.ts";
import { cantRunReason, clipBucket, CLIP_TRIM_SECONDS, type ClipForGroup } from "./surface.ts";

export type SelectionMode = "all" | "chosen";

export type SelectionRow = { clipId: string; selected: boolean };

export type ClipSelection = {
  mode: SelectionMode;
  rows: readonly SelectionRow[];
};

export type PairMode = "spread" | "best" | "each";

export const CLIPS_NOTE = "Selected clips become ads when a round pairs them with an approved caption";

export const NO_CLIP_SELECTED = "No clip selected — select clips to see the captions on them.";

/** Each selected, before the first write. The count above it is what Write will make. */
export const EACH_BEFORE_WRITE = "Write to see these on the clips.";

export const OFF_CARD_CLIP = "This preview's clip isn't on the event any more — write it again on a clip that is.";

export function captionsNote(roundNo: number): string {
  return `✓ a caption, then Propose round ${roundNo} renders it on the selected clips`;
}

export function noSelectedClipsSentence(roundNo: number): string {
  return `Select at least 1 clip to propose round ${roundNo}.`;
}

export function eachPreviewLine(captions: number, clips: number): string {
  return `${captions} captions × ${clips} clips = ${captions * clips} previews`;
}

/** The clips Each selected actually draws. A skipped clip drops out of the count. */
export function eachPreviewClips<T extends { id: string }>(selected: readonly T[], skipped: ReadonlySet<string> = new Set()): T[] {
  return selected.filter((clip) => !skipped.has(clip.id));
}

export function emptySelection(): ClipSelection {
  return { mode: "all", rows: [] };
}

export function usableClips<T extends ClipForGroup>(clips: readonly T[]): T[] {
  return clips.filter((clip) => {
    if (clip.tripleFitSourceId) return false;
    const bucket = clipBucket(clip);
    return bucket === "keeping" || bucket === "new";
  });
}

/** The clips a generate and a round may use. Can't-run tiles are never in it. */
export function effectiveSelection<T extends ClipForGroup>(selection: ClipSelection, clips: readonly T[]): T[] {
  const usable = usableClips(clips);
  if (selection.mode === "all") return usable;
  const on = new Set(selection.rows.filter((row) => row.selected).map((row) => row.clipId));
  return usable.filter((clip) => on.has(clip.id));
}

export function selectedIdSet(selection: ClipSelection, usableIds: readonly string[]): Set<string> {
  if (selection.mode === "all") return new Set(usableIds);
  const on = new Set(selection.rows.filter((row) => row.selected).map((row) => row.clipId));
  return new Set(usableIds.filter((id) => on.has(id)));
}

/** A clip that arrived after the operator chose, and has not been ticked. */
export function newUnselectedCount(selection: ClipSelection, usableIds: readonly string[]): number {
  if (selection.mode !== "chosen") return 0;
  const known = new Set(selection.rows.map((row) => row.clipId));
  return usableIds.filter((id) => !known.has(id)).length;
}

export function selectionCount(selection: ClipSelection, clips: readonly ClipForGroup[]): { n: number; m: number; fresh: number } {
  const usable = usableClips(clips);
  return {
    n: effectiveSelection(selection, clips).length,
    m: usable.length,
    fresh: newUnselectedCount(selection, usable.map((clip) => clip.id)),
  };
}

/** Ticking while everything is selected writes a row per usable clip and leaves "all". */
export function selectionAfterToggle(selection: ClipSelection, usableIds: readonly string[], clipId: string): ClipSelection {
  const current = selectedIdSet(selection, usableIds);
  if (current.has(clipId)) current.delete(clipId);
  else current.add(clipId);
  return {
    mode: "chosen",
    rows: usableIds.map((id) => ({ clipId: id, selected: current.has(id) })),
  };
}

export function selectionAfterAll(): ClipSelection {
  return { mode: "all", rows: [] };
}

export function selectionAfterNone(usableIds: readonly string[]): ClipSelection {
  return { mode: "chosen", rows: usableIds.map((clipId) => ({ clipId, selected: false })) };
}

export function leftSelectionNote(selection: ClipSelection, clips: readonly (ClipForGroup & { id: string })[]): string | null {
  if (selection.mode !== "chosen") return null;
  const left = clips.find((clip) => clipBucket(clip) === "cant" && selection.rows.some((row) => row.clipId === clip.id && row.selected));
  if (!left) return null;
  const why = (left.durationSeconds ?? 0) > CLIP_TRIM_SECONDS
    ? "too long"
    : cantRunReason(left) === TOO_SMALL_FOR_916
      ? "too small for 9:16"
      : "can't run";
  return `${left.artistName} #${left.clipNo} left the selection — ${why}`;
}

/** Caption i lands on selected clip i, wrapping in display order. */
export function spreadClipIds(count: number, clipIds: readonly string[]): string[] {
  if (!clipIds.length || count <= 0) return [];
  return Array.from({ length: count }, (_, index) => clipIds[index % clipIds.length] as string);
}

/** Lowest cost per result among selected clips that have one. Before any round, the first selected clip. */
export function bestOfSelected<T extends { judged: { cost: number | null } | null }>(clips: readonly T[]): T | null {
  if (!clips.length) return null;
  const priced = clips.filter((clip) => clip.judged?.cost != null && clip.judged.cost > 0);
  if (!priced.length) return clips[0] ?? null;
  return [...priced].sort((a, b) => (a.judged?.cost ?? 0) - (b.judged?.cost ?? 0))[0] ?? null;
}

export function notSelectedNames(names: readonly string[]): string | null {
  if (!names.length) return null;
  const shown = names.slice(0, 5);
  const rest = names.length - shown.length;
  const list = rest > 0 ? `${shown.join(", ")} +${rest}` : shown.join(", ");
  return `Not selected: ${list} · change on Clips`;
}

export function notSelectedCount(artist: string, missing: number, usable: number): string {
  return `${missing} of ${artist}'s ${usable} clips not selected`;
}

export function winnerNotSelected(name: string, roundNo: number): string {
  return `${name}, round ${roundNo}'s winner, is not selected`;
}

export function roundBar(on: number, clips: number, captions: number, off: number): string {
  return `${on} ads · ${clips} clips × ${captions} captions, ${off} left out`;
}

/** A render is queued only for a pairing the operator left on. */
export function renderPairs<T extends { on: boolean }>(cells: readonly T[]): T[] {
  return cells.filter((cell) => cell.on);
}

export function previewPlate(
  clipId: string | null | undefined,
  clips: readonly { id: string }[],
  selectedCount: number,
): "missing" | "none" | "clip" {
  if (clipId && !clips.some((clip) => clip.id === clipId)) return "missing";
  if (!clipId && selectedCount === 0) return "none";
  return "clip";
}

/** The Clips cell keeps the usable count. The state line names a choice only after one is made. */
export function clipSelectionStrip(mode: SelectionMode, selected: number, blocked: number, total: number): { line: string; short: string } {
  if (total <= 0 && blocked <= 0) return { line: "none yet", short: "none" };
  if (total <= 0) {
    const line = `${blocked} blocked`;
    return { line, short: line };
  }
  if (mode === "chosen") {
    const line = `${selected} selected`;
    return { line, short: line };
  }
  if (blocked <= 0) return { line: "ready", short: "ready" };
  const line = `${blocked} blocked`;
  return { line, short: line };
}
