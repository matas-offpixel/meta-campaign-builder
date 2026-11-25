/**
 * lib/artist-library/library-tree.ts — the Drive library's names (AL1, AL4).
 *
 *   00 Artist Library / {artist} / Clips · Statics · Renders · Captions · Insights
 *
 * at the Off / Pixel shared drive's root. The artist folder is named exactly
 * as artists.name: never trimmed, case-folded or tidied. Renders holds Drive
 * shortcuts, never copies, named "{rank} · {code} · {stage} · {cost} · {file
 * name}", rank two digits per stage, counting shareable renders only, top
 * five per stage.
 *
 * Pure: no Drive, no database.
 */
import { AL_WORDS, alWord, STAGE_LABEL, type RankedStage } from "./words.ts";

export const LIBRARY_ROOT_KEY = "root";
export const LIBRARY_ARTIST_KEY = "artist";

export const LIBRARY_CHILDREN = [
  { key: "clips", name: AL_WORDS["al.drive.clips"] },
  { key: "statics", name: AL_WORDS["al.drive.statics"] },
  { key: "renders", name: AL_WORDS["al.drive.renders"] },
  { key: "captions", name: AL_WORDS["al.drive.captions"] },
  { key: "insights", name: AL_WORDS["al.drive.insights"] },
] as const;

export type LibraryChildKey = (typeof LIBRARY_CHILDREN)[number]["key"];
export type LibraryKey = typeof LIBRARY_ROOT_KEY | typeof LIBRARY_ARTIST_KEY | LibraryChildKey;

/** The folders a drop turns into an artist asset (AL1): Clips → clip, Statics → static. */
export const DROP_KINDS: Readonly<Partial<Record<LibraryKey, "clip" | "static">>> = { clips: "clip", statics: "static" };

export function libraryRootName(): string {
  return AL_WORDS["al.drive.root"];
}

/** The artist's folder: the name as stored, verbatim. An empty name has no folder. */
export function artistFolderName(name: string): string {
  if (!name.trim()) throw new Error("artist has no name");
  return alWord("al.drive.artist", { artist: name });
}

/** The file's name without its extension: "Enzo Siragusa - UGC 2.mp4" → "Enzo Siragusa - UGC 2". */
export function stem(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 && fileName.length - dot <= 6 ? fileName.slice(0, dot) : fileName;
}

/** "01 · P26-BDAY · Signup · £2.10 per signup · Enzo Siragusa - UGC 2" (al.drive.render). */
export function renderShortcutName(input: { rank: number; code: string; stage: RankedStage; cost: string; fileName: string }): string {
  return alWord("al.drive.render", {
    rank: String(input.rank).padStart(2, "0"),
    code: input.code,
    stage: STAGE_LABEL[input.stage],
    cost: input.cost,
    "file name": stem(input.fileName),
  });
}

export const SHORTCUTS_PER_STAGE = 5;

/** One shareable render ranked at a stage. */
export interface RankedRender {
  /** The render's file in the event folder: the shortcut's target. */
  targetId: string;
  fileName: string;
  code: string;
  stage: RankedStage;
  cost: string;
  shareable: boolean;
}

/** A shortcut the library already has in Renders. */
export interface ExistingShortcut {
  id: string;
  name: string;
  targetId: string | null;
  /** The stage it was made for (appProperties), so a render ranked at two stages has two shortcuts. */
  stage: string | null;
}

export type ShortcutPlan = {
  create: { name: string; targetId: string; stage: RankedStage }[];
  rename: { id: string; from: string; to: string }[];
  /**
   * Shortcuts no longer in a stage's top five. Listed, never removed here:
   * the export never deletes, so the weekly run (PR 2) decides. Removing a
   * shortcut would never touch its target in the event folder.
   */
  dropped: { id: string; name: string }[];
};

/**
 * What Renders should hold: per stage, the first five shareable renders in
 * rank order, ranked 01–05 among shareable renders only. A held render is
 * never in the library (AL4), whatever its rank on the artist page.
 */
export function planShortcuts(ranked: Readonly<Record<RankedStage, readonly RankedRender[]>>, existing: readonly ExistingShortcut[]): ShortcutPlan {
  const plan: ShortcutPlan = { create: [], rename: [], dropped: [] };
  const kept = new Set<string>();
  for (const stage of Object.keys(ranked) as RankedStage[]) {
    const shareable = ranked[stage].filter((r) => r.shareable).slice(0, SHORTCUTS_PER_STAGE);
    shareable.forEach((render, i) => {
      const name = renderShortcutName({ rank: i + 1, code: render.code, stage, cost: render.cost, fileName: render.fileName });
      const have = existing.find((s) => s.targetId === render.targetId && s.stage === stage && !kept.has(s.id));
      if (!have) {
        plan.create.push({ name, targetId: render.targetId, stage });
        return;
      }
      kept.add(have.id);
      if (have.name !== name) plan.rename.push({ id: have.id, from: have.name, to: name });
    });
  }
  for (const s of existing) if (!kept.has(s.id)) plan.dropped.push({ id: s.id, name: s.name });
  return plan;
}
